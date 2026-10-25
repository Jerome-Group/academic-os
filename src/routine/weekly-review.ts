import { createHash, randomUUID } from "node:crypto";
import { isCalendarDay } from "./offering-calendar-day.js";
import { offeringWeekStart } from "./offering-week-start.js";
import { createFileWeeklyEvidenceStore } from "./file-weekly-evidence.js";
import {
  bindPublisher,
  anchorBindings,
  rememberAnchor,
  intent,
  intents,
  knownAnchors,
  knownComments,
  ownWeeklyJournal,
  parseBasis,
  receipt,
  rememberComment,
  requireBasis,
  publicationJournalBytes,
  admitReceipt,
  type PublicationJournal,
  type PublicationOperation,
  type WeeklyBasis,
} from "./weekly-publication-journal.js";
import {
  digest,
  parseObservation,
  parsePublication,
  reduceWeekly,
  renderPublication,
  repositoryHeads,
  scopeHeads,
  validateHistory,
  type PublishedObservation,
} from "./weekly-review-state.js";
import { routineFailure } from "./routine-failure.js";
import {
  planWeeklyResolution,
  renderResolution,
  type WeeklyResolutionProof,
} from "./weekly-resolution.js";
import type {
  MorningIssueReport,
  MorningRunEvidence,
  WeeklyComment,
  WeeklyDiscussionIdentity,
  WeeklyDiscussionPort,
  WeeklyIssue,
  WeeklyRepositorySummary,
  WeeklyScopeSummary,
} from "./types.js";

export { offeringWeekStart } from "./offering-week-start.js";
export type { WeeklyBasis } from "./weekly-publication-journal.js";
export const WEEKLY_ISSUE_LABELS = ["ready-for-human", "decision"] as const;
export function weeklyIssueMarker(week: string): string {
  return `<!-- academic-os-weekly-issue:v2 week=${week} -->`;
}
export function weeklyScopeId(
  cohort: string,
  modules: readonly string[],
  scope: MorningRunEvidence["scope"],
): string {
  return createHash("sha256")
    .update(JSON.stringify([cohort, [...new Set(modules)].sort(), scope]))
    .digest("hex");
}
interface Discovery {
  issues: WeeklyIssue[];
  comments: WeeklyComment[];
  observations: PublishedObservation[];
  unknown: number[];
  issueCount: number;
  discussionBytes: number;
  issuePages: number;
  commentPages: Map<number, number>;
}
interface WeeklyBatch {
  anchor: Extract<PublicationOperation, { kind: "anchor" }> | undefined;
  publication: string | undefined;
  transition:
    | { kind: "retain" }
    | { kind: "reopen" }
    | { kind: "resolve"; proof: WeeklyResolutionProof };
  predecessors: { number: number; transfer: string | undefined }[];
}
function transferBody(successor: number, predecessor: number): string {
  return `<!-- academic-os-weekly-transfer:v2 successor=${successor} -->\nTransferred observed facts to weekly review #${successor}. Owner notes remain in #${predecessor}. Closure records transfer, not resolution.`;
}
function admitBatch(
  found: Discovery,
  batch: WeeklyBatch,
  journal: PublicationJournal,
  number: number,
): void {
  const operations: PublicationOperation[] = [];
  let issueCount = found.issueCount;
  let commentCount = found.comments.length;
  let discussionBytes = found.discussionBytes;
  if (batch.anchor !== undefined) {
    operations.push(batch.anchor);
    issueCount += 1;
    discussionBytes += Buffer.byteLength(batch.anchor.body);
  }
  if (batch.publication !== undefined)
    operations.push({ kind: "comment", number, body: batch.publication });
  if (batch.transition.kind === "reopen")
    operations.push({ kind: "state", number, state: "OPEN" });
  if (batch.transition.kind === "resolve")
    operations.push({
      kind: "resolution",
      number,
      anchorId: Number.MAX_SAFE_INTEGER,
      publicationId: Number.MAX_SAFE_INTEGER,
      proof: batch.transition.proof,
    });
  for (const previous of batch.predecessors) {
    if (previous.transfer !== undefined)
      operations.push({
        kind: "comment",
        number: previous.number,
        body: previous.transfer,
      });
    operations.push({
      kind: "state",
      number: previous.number,
      state: "CLOSED",
    });
  }
  for (const operation of operations) {
    if (operation.kind !== "comment") continue;
    commentCount += 1;
    discussionBytes += Buffer.byteLength(operation.body);
    if (
      found.comments.filter(
        (comment) => comment.issueNumber === operation.number,
      ).length +
        operations.filter(
          (planned) =>
            planned.kind === "comment" && planned.number === operation.number,
        ).length >
      10_000
    )
      throw new Error(
        "Weekly publication would exceed 10000 comments per issue.",
      );
  }
  if (issueCount > 10_000 || commentCount > 10_000)
    throw new Error(
      "Weekly publication would exceed 10000 issues or comments.",
    );
  if (
    found.issuePages + (batch.anchor === undefined ? 0 : 1) > 100 ||
    [
      ...new Set(
        operations.flatMap((op) => (op.kind === "comment" ? [op.number] : [])),
      ),
    ].some(
      (number) =>
        (found.commentPages.get(number) ?? 0) +
          operations.filter(
            (op) => op.kind === "comment" && op.number === number,
          ).length >
        100,
    )
  )
    throw new Error(
      "Weekly publication requires headroom within 100 provider pages.",
    );
  if (discussionBytes > 32 * 1024 * 1024)
    throw new Error("Weekly publication would exceed 32 MiB discussion text.");
  journal.requireCapacity(
    operations.reduce(
      (bytes, operation) => bytes + publicationJournalBytes(operation),
      0,
    ),
  );
}
function anchorWeek(issue: WeeklyIssue): string | undefined {
  const week =
    /^<!-- academic-os-weekly-issue:v[12] week=(\d{4}-\d{2}-\d{2}) -->\n/u.exec(
      issue.body,
    )?.[1];
  return week !== undefined &&
    isCalendarDay(week) &&
    offeringWeekStart(week) === week
    ? week
    : undefined;
}
function boundWeek(
  journal: PublicationJournal,
  issue: WeeklyIssue,
): string | undefined {
  const known = anchorBindings(journal).find(
    (entry) => entry.number === issue.number,
  );
  if (known !== undefined) {
    if (known.id !== issue.id)
      throw new Error("Known weekly anchor identity changed.");
    return known.week;
  }
  return anchorWeek(issue);
}
function legacyDay(issue: WeeklyIssue): string | undefined {
  const date =
    /^Morning report (\d{4}-\d{2}-\d{2})(?: \(modules-only\))?$/u.exec(
      issue.title,
    )?.[1];
  return date !== undefined &&
    isCalendarDay(date) &&
    /^<!-- academic-os-morning-issue:v1 cohort=\S+ modules=\S*(?: scope=modules-only)? -->\n/u.test(
      issue.body,
    )
    ? date
    : undefined;
}
async function discover(
  port: WeeklyDiscussionPort,
  journal: PublicationJournal,
  identity: WeeklyDiscussionIdentity,
  date: string,
  retention: "retain" | "defer" = "retain",
): Promise<Discovery> {
  const listing = await port.listIssues(),
    all = listing.issues;
  if (
    listing.totalCount > 10_000 ||
    new Set(all.map((i) => i.number)).size !== all.length
  )
    throw new Error("Incomplete or oversized weekly issue enumeration.");
  const known = knownAnchors(journal);
  for (const number of known)
    if (!all.some((i) => i.number === number))
      throw new Error("Known weekly anchor disappeared.");
  for (const issue of all) {
    if (
      issue.creatorId !== identity.publisherId ||
      known.includes(issue.number)
    )
      continue;
    if (
      (issue.body.startsWith("<!-- academic-os-weekly-issue:") &&
        anchorWeek(issue) === undefined) ||
      (issue.body.startsWith("<!-- academic-os-morning-issue:") &&
        legacyDay(issue) === undefined)
    )
      throw new Error(
        "Malformed weekly or legacy ownership requires reconciliation.",
      );
  }
  const week = offeringWeekStart(date);
  const issues = all.filter(
    (issue) =>
      issue.creatorId === identity.publisherId &&
      ((boundWeek(journal, issue) ?? "9999") <= week ||
        (legacyDay(issue) ?? "9999") <= date),
  );
  for (const issue of issues) {
    const week = anchorWeek(issue);
    if (
      week !== undefined &&
      retention === "retain" &&
      issue.body.startsWith("<!-- academic-os-weekly-issue:v2 ")
    )
      await rememberAnchor(journal, {
        number: issue.number,
        id: issue.id,
        week,
      });
  }
  let observedBytes = listing.bodyBytes;
  if (observedBytes > 32 * 1024 * 1024)
    throw new Error("Weekly discussion text exceeds 32 MiB.");
  const comments: WeeklyComment[] = [],
    commentPages = new Map<number, number>(),
    observations = new Map<string, PublishedObservation>(),
    unknown: number[] = [];
  for (const issue of issues) {
    const listing = await port.listComments(issue.number),
      listed = listing.comments;
    commentPages.set(issue.number, listing.pages);
    if (
      new Set(listed.map((c) => c.id)).size !== listed.length ||
      listed.some((c) => c.issueNumber !== issue.number)
    )
      throw new Error("Incomplete comment identities.");
    observedBytes += listed.reduce(
      (size, c) => size + Buffer.byteLength(c.body),
      0,
    );
    if (observedBytes > 32 * 1024 * 1024)
      throw new Error("Weekly discussion text exceeds 32 MiB.");
    comments.push(...listed);
    if (comments.length > 10_000)
      throw new Error("Weekly history exceeds 10000 comments.");
    if (
      !issue.body.startsWith("<!-- academic-os-weekly-issue:v2 ") &&
      !known.includes(issue.number)
    )
      unknown.push(issue.number);
    for (const comment of listed) {
      if (comment.creatorId !== identity.publisherId) continue;
      const original = knownComments(journal).find((c) => c.id === comment.id);
      if (
        original !== undefined &&
        (original.body !== comment.body ||
          original.updatedAt !== comment.updatedAt ||
          original.issueNumber !== comment.issueNumber)
      )
        throw new Error(
          "Known weekly publication integrity unknown; private original retained.",
        );
      const observation = parsePublication(comment.body);
      if (observation === undefined) continue;
      if (comment.createdAt !== comment.updatedAt && original === undefined)
        throw new Error(
          "Edited weekly publication requires private reconciliation.",
        );
      if (retention === "retain") await rememberComment(journal, comment);
      const id = digest(observation);
      if (!observations.has(id))
        observations.set(id, {
          id,
          observation,
          issueNumber: issue.number,
          commentId: comment.id,
          url: comment.url,
        });
    }
  }
  for (const original of knownComments(journal))
    if (
      !comments.some(
        (c) => c.id === original.id && c.creatorId === original.creatorId,
      )
    )
      throw new Error(
        "Known weekly publication disappeared; private original retained.",
      );
  const records = [...observations.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  validateHistory(records, date);
  return {
    issues,
    comments,
    observations: records,
    unknown,
    issueCount: listing.totalCount,
    discussionBytes: observedBytes,
    issuePages: listing.pages,
    commentPages,
  };
}
async function recover(
  port: WeeklyDiscussionPort,
  journal: PublicationJournal,
  identity: WeeklyDiscussionIdentity,
  found: Discovery,
): Promise<void> {
  for (const pending of intents(journal)) {
    const op = pending.operation;
    if (op.kind === "anchor") {
      const matches = found.issues.filter(
        (i) => i.creatorId === identity.publisherId && i.body === op.body,
      );
      if (matches.length > 0) {
        const anchors: { number: number; id: number; week: string }[] = [];
        for (const match of matches) {
          const exact = await port.readIssue(match.number);
          if (
            exact.id !== match.id ||
            exact.creatorId !== identity.publisherId ||
            exact.body !== op.body
          )
            throw new Error(
              "Unknown anchor readback changed; intent retained.",
            );
          anchors.push({
            number: exact.number,
            id: exact.id,
            week: op.week,
          });
        }
        admitReceipt(
          journal,
          pending.id,
          matches.map((i) => i.number),
          [],
          anchors,
        );
        for (const anchor of anchors) await rememberAnchor(journal, anchor);
        await receipt(
          journal,
          pending.id,
          matches.map((i) => i.number),
        );
        continue;
      }
    } else if (op.kind === "comment") {
      const matches = found.comments.filter(
        (c) =>
          c.issueNumber === op.number &&
          c.creatorId === identity.publisherId &&
          c.body === op.body &&
          c.createdAt === c.updatedAt,
      );
      if (matches.length > 0) {
        const exactComments: WeeklyComment[] = [];
        for (const comment of matches) {
          const exact = await port.readComment(comment.id);
          if (
            exact.issueNumber !== op.number ||
            exact.creatorId !== identity.publisherId ||
            exact.body !== op.body ||
            exact.createdAt !== exact.updatedAt
          )
            throw new Error(
              "Unknown comment readback changed; intent retained.",
            );
          exactComments.push(exact);
        }
        admitReceipt(
          journal,
          pending.id,
          matches.map((c) => c.id),
          exactComments,
          [],
        );
        for (const comment of exactComments)
          await rememberComment(journal, comment);
        await receipt(
          journal,
          pending.id,
          matches.map((c) => c.id),
        );
        continue;
      }
    } else {
      if (op.kind === "resolution") requireResolutionPublication(journal, op);
      const issue = await port.readIssue(op.number);
      if (
        issue.creatorId === identity.publisherId &&
        issue.number === op.number &&
        (op.kind === "resolution"
          ? issue.id === op.anchorId && issue.state === "CLOSED"
          : issue.state === op.state)
      ) {
        admitReceipt(journal, pending.id, [issue.number], [], []);
        await receipt(journal, pending.id, [issue.number]);
        continue;
      }
    }
    throw new Error(
      "Unknown weekly mutation remains fenced; negative enumeration does not authorize a repost.",
    );
  }
}
function requireResolutionPublication(
  journal: PublicationJournal,
  operation: Extract<PublicationOperation, { kind: "resolution" }>,
): void {
  if (
    !knownComments(journal).some(
      (comment) =>
        comment.id === operation.publicationId &&
        comment.issueNumber === operation.number &&
        comment.body.endsWith(renderResolution(operation.proof)),
    )
  )
    throw new Error("Resolution requires its exact immutable publication.");
}
async function context(
  port: WeeklyDiscussionPort,
  journal: PublicationJournal,
  date: string,
): Promise<{ identity: WeeklyDiscussionIdentity; found: Discovery }> {
  const identity = await port.identify();
  await bindPublisher(journal, identity);
  const pending = intents(journal).length > 0;
  let found = await discover(
    port,
    journal,
    identity,
    date,
    pending ? "defer" : "retain",
  );
  if (pending) {
    await recover(port, journal, identity, found);
    found = await discover(port, journal, identity, date);
  }
  return { identity, found };
}
export async function beginWeeklyObservation(input: {
  issue: WeeklyDiscussionPort;
  stateRoot: string;
  date: string;
  cohort: string;
  moduleCodes: readonly string[];
  scope: MorningRunEvidence["scope"];
}): Promise<WeeklyBasis> {
  return ownWeeklyJournal(input.stateRoot, async (journal) => {
    const { found } = await context(input.issue, journal, input.date);
    const scope = weeklyScopeId(input.cohort, input.moduleCodes, input.scope);
    const basis: WeeklyBasis = {
      ticket: digest(randomUUID()),
      coverage: input.scope,
      scope,
      date: input.date,
      parents: scopeHeads(found.observations, scope),
      repositoryParents: repositoryHeads(found.observations),
    };
    await journal.append({ kind: "basis", basis: parseBasis(basis) });
    return basis;
  });
}
async function dispatch(
  port: WeeklyDiscussionPort,
  journal: PublicationJournal,
  identity: WeeklyDiscussionIdentity,
  operation: PublicationOperation,
): Promise<WeeklyIssue | WeeklyComment> {
  journal.requireCapacity(publicationJournalBytes(operation));
  if (operation.kind === "resolution")
    requireResolutionPublication(journal, operation);
  const id = await intent(journal, operation);
  try {
    if (operation.kind === "comment") {
      const result = await port.appendComment({
        number: operation.number,
        body: operation.body,
      });
      const readback = await port.readComment(result.id);
      if (
        readback.id !== result.id ||
        readback.issueNumber !== operation.number ||
        readback.creatorId !== identity.publisherId ||
        readback.body !== operation.body ||
        readback.createdAt !== readback.updatedAt
      )
        throw new Error("Immutable weekly comment readback mismatch.");
      await rememberComment(journal, readback);
      await receipt(journal, id, [readback.id]);
      return readback;
    }
    const result =
      operation.kind === "anchor"
        ? await port.createIssue({
            title: operation.title,
            body: operation.body,
            labels: WEEKLY_ISSUE_LABELS,
          })
        : await port.setState({
            number: operation.number,
            state: operation.kind === "resolution" ? "CLOSED" : operation.state,
          });
    const readback = await port.readIssue(result.number);
    if (
      readback.creatorId !== identity.publisherId ||
      readback.id !== result.id ||
      (operation.kind === "resolution" &&
        (readback.number !== operation.number ||
          readback.id !== operation.anchorId)) ||
      (operation.kind === "anchor"
        ? readback.body !== operation.body
        : readback.state !==
          (operation.kind === "resolution" ? "CLOSED" : operation.state))
    )
      throw new Error("Weekly issue readback mismatch.");
    if (operation.kind === "anchor")
      await rememberAnchor(journal, {
        number: readback.number,
        id: readback.id,
        week: operation.week,
      });
    await receipt(journal, id, [readback.number]);
    return readback;
  } catch {
    throw new Error(
      "Weekly mutation outcome unknown; durable intent retained for exact reconciliation.",
    );
  }
}
export async function reconcileWeeklyIssue(input: {
  issue: WeeklyDiscussionPort;
  stateRoot: string;
  observation: WeeklyBasis;
  summary: WeeklyScopeSummary;
  needsOwner: boolean;
  repository?: WeeklyRepositorySummary;
}): Promise<MorningIssueReport> {
  let number: number | null = null;
  try {
    return await ownWeeklyJournal(input.stateRoot, async (journal) => {
      const basis = parseBasis(input.observation);
      requireBasis(journal, basis);
      if (basis.coverage === "modules-only" && input.repository !== undefined)
        throw new Error(
          "Module-only publication cannot replace repository observations.",
        );
      const { identity, found } = await context(
        input.issue,
        journal,
        basis.date,
      );
      const weekStart = offeringWeekStart(basis.date);
      const observation = parseObservation({
        scope: basis.scope,
        date: basis.date,
        parents: basis.parents,
        repositoryParents:
          input.repository === undefined ? [] : basis.repositoryParents,
        summary: input.summary,
        needsOwner:
          input.needsOwner ||
          (basis.coverage === "monitoring-cohort" &&
            input.summary.preludePending > 0),
        ...(input.repository === undefined
          ? {}
          : { repository: input.repository }),
      });
      const observationId = digest(observation);
      const before = reduceWeekly(found.observations, weekStart, found.unknown);
      let current = found.issues
        .filter(
          (i) =>
            boundWeek(journal, i) === weekStart &&
            (knownAnchors(journal).includes(i.number) ||
              i.body.startsWith(weeklyIssueMarker(weekStart))),
        )
        .sort((a, b) => a.number - b.number)[0];
      const prospective: PublishedObservation = {
        id: observationId,
        observation,
        issueNumber: current?.number ?? 0,
        commentId: 0,
        url: "",
      };
      const records = [
        ...new Map(
          [...found.observations, prospective].map((r) => [r.id, r]),
        ).values(),
      ].sort((a, b) => a.id.localeCompare(b.id));
      validateHistory(records, basis.date);
      const view = reduceWeekly(records, weekStart, found.unknown);
      const resolution = planWeeklyResolution({
        basis,
        observation,
        before: found.observations,
        records,
        view,
      });
      const transition: WeeklyBatch["transition"] =
        current?.state === "CLOSED" && view.actionable
          ? { kind: "reopen" }
          : current?.state !== "CLOSED" && resolution !== undefined
            ? { kind: "resolve", proof: resolution }
            : { kind: "retain" };
      const publish =
        transition.kind === "resolve" ||
        current === undefined ||
        !found.observations.some((r) => r.issueNumber === current?.number) ||
        JSON.stringify(before) !== JSON.stringify(view) ||
        found.issues.some(
          (i) => i.number !== current?.number && i.state === "OPEN",
        );
      const body =
        renderPublication(
          observation,
          found.observations,
          view,
          found.issues
            .filter((i) => i.number !== current?.number)
            .map((i) => i.number),
        ) +
        (transition.kind === "resolve"
          ? renderResolution(transition.proof)
          : "");
      const batch: WeeklyBatch = {
        anchor:
          current === undefined
            ? {
                kind: "anchor",
                week: weekStart,
                title: `Weekly maintenance review ${weekStart}`,
                body: `${weeklyIssueMarker(weekStart)}\nImmutable as-of reviews are appended below. Owner notes and comments stay here. Prior notes remain linked at their source. A resolution review closes observed machine work. A transfer comment records predecessor retirement, not resolution.\n\n## Owner notes\n\n`,
              }
            : undefined,
        publication: publish ? body : undefined,
        transition,
        predecessors: found.issues
          .filter(
            (issue) =>
              issue.number !== current?.number && issue.state === "OPEN",
          )
          .map((issue) => {
            const transfer = transferBody(
              current?.number ?? Number.MAX_SAFE_INTEGER,
              issue.number,
            );
            return {
              number: issue.number,
              transfer: found.comments.some(
                (comment) =>
                  comment.issueNumber === issue.number &&
                  comment.creatorId === identity.publisherId &&
                  comment.body === transfer &&
                  comment.createdAt === comment.updatedAt,
              )
                ? undefined
                : transfer,
            };
          }),
      };
      admitBatch(
        found,
        batch,
        journal,
        current?.number ?? Number.MAX_SAFE_INTEGER,
      );
      const plannedAnchors = new Set(found.issues.map((issue) => issue.number));
      let outcome: MorningIssueReport["outcome"] = "not-needed";
      if (batch.anchor !== undefined) {
        const created = await dispatch(
          input.issue,
          journal,
          identity,
          batch.anchor,
        );
        if (!("number" in created))
          throw new Error("Invalid weekly anchor response.");
        const refreshed = await discover(
          input.issue,
          journal,
          identity,
          basis.date,
        );
        plannedAnchors.add(created.number);
        if (refreshed.issues.some((issue) => !plannedAnchors.has(issue.number)))
          throw new Error(
            "Weekly anchors changed after admission; fresh reconciliation required.",
          );
        current = refreshed.issues
          .filter(
            (i) =>
              boundWeek(journal, i) === weekStart &&
              (knownAnchors(journal).includes(i.number) ||
                i.body.startsWith(weeklyIssueMarker(weekStart))),
          )
          .sort((a, b) => a.number - b.number)[0];
        if (current === undefined)
          throw new Error("Created weekly anchor enumeration incomplete.");
        if (current.number !== created.number)
          throw new Error("Weekly anchor selection changed after admission.");
        admitBatch(
          refreshed,
          { ...batch, anchor: undefined },
          journal,
          current.number,
        );
        outcome = "created";
      }
      if (current === undefined)
        throw new Error("Missing admitted weekly anchor.");
      number = current.number;
      let publication: WeeklyComment | undefined;
      if (batch.publication !== undefined) {
        const result = await dispatch(input.issue, journal, identity, {
          kind: "comment",
          number,
          body: batch.publication,
        });
        if (!("issueNumber" in result))
          throw new Error("Invalid weekly publication response.");
        publication = result;
        if (outcome !== "created") outcome = "updated";
      }
      const after = await discover(input.issue, journal, identity, basis.date);
      const expectedIds =
        batch.publication !== undefined
          ? records.map((r) => r.id)
          : found.observations.map((r) => r.id);
      if (
        after.issues.some((issue) => !plannedAnchors.has(issue.number)) ||
        JSON.stringify(after.observations.map((r) => r.id)) !==
          JSON.stringify(expectedIds)
      )
        throw new Error(
          "Weekly facts changed during publication; fresh reconciliation required before transfer.",
        );
      if (batch.transition.kind === "reopen") {
        await dispatch(input.issue, journal, identity, {
          kind: "state",
          number,
          state: "OPEN",
        });
        outcome = "reopened";
      }
      if (batch.transition.kind === "resolve") {
        if (publication === undefined)
          throw new Error("Resolution requires a fresh immutable review.");
        const latest = await discover(
          input.issue,
          journal,
          identity,
          basis.date,
        );
        const anchor = latest.issues.find((issue) => issue.number === number);
        const proof = batch.transition.proof;
        if (
          anchor?.id !== current.id ||
          latest.issues.some((issue) => !plannedAnchors.has(issue.number)) ||
          JSON.stringify(latest.observations.map((record) => record.id)) !==
            JSON.stringify(proof.observationIds) ||
          JSON.stringify(latest.unknown) !== JSON.stringify(proof.unknown) ||
          digest(
            reduceWeekly(latest.observations, weekStart, latest.unknown),
          ) !== proof.viewDigest
        )
          throw new Error(
            "Weekly facts changed before resolution; anchor retained for fresh reconciliation.",
          );
        await dispatch(input.issue, journal, identity, {
          kind: "resolution",
          number,
          anchorId: current.id,
          publicationId: publication.id,
          proof,
        });
        outcome = "closed";
      }
      const retired: number[] = [];
      for (const [index, previous] of batch.predecessors.entries()) {
        const remaining = await discover(
          input.issue,
          journal,
          identity,
          basis.date,
        );
        if (remaining.issues.some((issue) => !plannedAnchors.has(issue.number)))
          throw new Error(
            "Weekly anchors changed after admission; predecessor retained.",
          );
        admitBatch(
          remaining,
          {
            anchor: undefined,
            publication: undefined,
            transition: { kind: "retain" },
            predecessors: batch.predecessors.slice(index),
          },
          journal,
          number,
        );
        const fresh = await input.issue.readIssue(previous.number),
          comments = (await input.issue.listComments(previous.number)).comments;
        await createFileWeeklyEvidenceStore(input.stateRoot).archiveIssue({
          number: fresh.number,
          title: fresh.title,
          body: fresh.body,
          comments,
          reason: "weekly-transfer",
        });
        const transfer = transferBody(number, previous.number);
        const transferred = comments.some(
          (c) =>
            c.creatorId === identity.publisherId &&
            c.body === transfer &&
            c.createdAt === c.updatedAt,
        );
        if (previous.transfer === undefined && !transferred)
          throw new Error(
            "Admitted transfer disappeared; predecessor retained.",
          );
        if (previous.transfer !== undefined && !transferred)
          await dispatch(input.issue, journal, identity, {
            kind: "comment",
            number: previous.number,
            body: transfer,
          });
        const beforeClose = await input.issue.readIssue(previous.number),
          beforeComments = (await input.issue.listComments(previous.number))
            .comments;
        if (
          !beforeComments.some(
            (c) =>
              c.creatorId === identity.publisherId &&
              c.body === transfer &&
              c.createdAt === c.updatedAt,
          )
        )
          throw new Error(
            "Verified transfer disappeared; predecessor retained.",
          );
        const latest = await discover(
          input.issue,
          journal,
          identity,
          basis.date,
        );
        if (
          latest.issues.some((issue) => !plannedAnchors.has(issue.number)) ||
          JSON.stringify(latest.observations.map((r) => r.id)) !==
            JSON.stringify(expectedIds) ||
          JSON.stringify(latest.unknown) !== JSON.stringify(after.unknown)
        )
          throw new Error(
            "Observed facts changed during transfer; predecessor retained for fresh reconciliation.",
          );
        await createFileWeeklyEvidenceStore(input.stateRoot).archiveIssue({
          number: beforeClose.number,
          title: beforeClose.title,
          body: beforeClose.body,
          comments: beforeComments,
          reason: "weekly-transfer",
        });
        await dispatch(input.issue, journal, identity, {
          kind: "state",
          number: previous.number,
          state: "CLOSED",
        });
        retired.push(previous.number);
      }
      const reused =
        publication ??
        after.comments
          .filter(
            (c) =>
              c.issueNumber === number &&
              c.creatorId === identity.publisherId &&
              parsePublication(c.body) !== undefined,
          )
          .sort((a, b) => b.id - a.id)[0];
      return {
        outcome,
        number,
        weekStart,
        actionable: view.actionable,
        ...(retired.length === 0 ? {} : { numbers: retired }),
        ...(reused === undefined
          ? {}
          : { publicationId: reused.id, publicationUrl: reused.url }),
      };
    });
  } catch (error) {
    return {
      outcome: "failed",
      number,
      failure: routineFailure(error, "weekly-issue-failed"),
    };
  }
}
