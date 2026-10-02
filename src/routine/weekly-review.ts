import { createHash } from "node:crypto";
import { isCalendarDay } from "./offering-calendar-day.js";
import { offeringWeekStart } from "./offering-week-start.js";
import {
  count,
  counts,
  issueNumbers,
  mergeReceipts,
  mergeState,
  ownerText,
  type QueueState,
  render,
  repositorySummary,
  retainMergeEvidence,
  stateOf,
} from "./weekly-review-state.js";

export { offeringWeekStart } from "./offering-week-start.js";

import { routineFailure } from "./routine-failure.js";
import type {
  MorningIssue,
  MorningIssuePort,
  MorningIssueReport,
  MorningRunEvidence,
  WeeklyIssueEvidenceStore,
  WeeklyRepositorySummary,
  WeeklyScopeSummary,
} from "./types.js";

export const WEEKLY_ISSUE_LABELS = ["ready-for-human", "decision"] as const;
export function weeklyIssueMarker(week: string): string {
  return `<!-- academic-os-weekly-issue:v1 week=${week} -->`;
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
async function readIssue(
  port: MorningIssuePort,
  number: number,
): Promise<MorningIssue> {
  const found =
    port.read === undefined
      ? (await port.list()).find((issue) => issue.number === number)
      : await port.read(number);
  if (found === undefined || found.number !== number)
    throw new Error("Issue readback unavailable.");
  return found;
}
export async function reconcileWeeklyIssue(input: {
  issue: MorningIssuePort;
  date: string;
  cohort: string;
  moduleCodes: readonly string[];
  scope: MorningRunEvidence["scope"];
  summary: WeeklyScopeSummary;
  needsOwner: boolean;
  repository?: WeeklyRepositorySummary;
  evidence?: WeeklyIssueEvidenceStore;
}): Promise<MorningIssueReport> {
  let number: number | null = null;
  const retired: number[] = [];
  try {
    const weekStart = offeringWeekStart(input.date),
      marker = weeklyIssueMarker(weekStart);
    const all = [
      ...new Map(
        (await input.issue.list()).map((issue) => [issue.number, issue]),
      ).values(),
    ];
    const weekly = all.filter((issue) => {
      const week = /^Weekly maintenance review (\d{4}-\d{2}-\d{2})$/u.exec(
        issue.title,
      )?.[1];
      return (
        week !== undefined &&
        isCalendarDay(week) &&
        week === offeringWeekStart(week) &&
        week <= weekStart &&
        issue.body.startsWith(`${weeklyIssueMarker(week)}\n`)
      );
    });
    const current = weekly
      .filter((issue) => issue.body.startsWith(`${marker}\n`))
      .sort((a, b) => a.number - b.number)[0];
    const older = weekly.filter(
      (issue) => issue.state === "OPEN" && issue.number !== current?.number,
    );
    // Legacy managed bodies are private snapshots, never inputs to public prose.
    const legacy = all.filter((issue) => {
      const date =
        /^Morning report (\d{4}-\d{2}-\d{2})(?: \(modules-only\))?$/u.exec(
          issue.title,
        )?.[1];
      return (
        issue.state === "OPEN" &&
        date !== undefined &&
        isCalendarDay(date) &&
        date <= input.date &&
        /^<!-- academic-os-morning-issue:v1 cohort=\S+ modules=\S*(?: scope=modules-only)? -->\n/u.test(
          issue.body,
        )
      );
    });
    if ((legacy.length > 0 || older.length > 0) && input.evidence === undefined)
      throw new Error(
        "Weekly transfer requires private original-body snapshots.",
      );
    const state: QueueState = {
      scopes: {},
      unknown: [],
      repository: repositorySummary({ merged: [], unresolved: 0, awaiting: 0 }),
    };
    if (current !== undefined) mergeState(state, stateOf(current));
    for (const previous of older) {
      const carried = stateOf(previous);
      if (!previous.body.startsWith(`${marker}\n`))
        carried.repository.merged = carried.repository.merged.filter(
          (fix) =>
            fix.verification !== "verified" || fix.rollout !== "verified",
        );
      mergeState(state, carried);
      if (Object.values(carried.scopes).some((scope) => scope.needsOwner))
        state.unknown.push(previous.number);
    }
    for (const scope of Object.values(state.scopes))
      scope.receipts = Object.fromEntries(
        Object.entries(scope.receipts).filter(
          ([date]) => offeringWeekStart(date) === weekStart,
        ),
      );
    state.unknown = [
      ...new Set([...state.unknown, ...legacy.map((issue) => issue.number)]),
    ].sort((a, b) => a - b);
    const id = weeklyScopeId(input.cohort, input.moduleCodes, input.scope);
    if (state.scopes[id] !== undefined && state.scopes[id].date > input.date)
      throw new Error("Newer scope observation requires reconciliation.");
    if (!counts.every((key) => count(input.summary[key])))
      throw new Error("Invalid current scope counters.");
    const receipts = Object.fromEntries(
      Object.entries(state.scopes[id]?.receipts ?? {}).filter(
        ([date]) => offeringWeekStart(date) === weekStart,
      ),
    );
    state.scopes[id] = {
      receipts: mergeReceipts(receipts, {
        [input.date]: {
          verifiedMaintenance: input.summary.verifiedMaintenance,
          verifiedControlWrites: input.summary.verifiedControlWrites,
        },
      }),
      date: input.date,
      needsOwner: input.needsOwner,
      summary: Object.fromEntries(
        counts.map((key) => [key, input.summary[key]]),
      ) as unknown as WeeklyScopeSummary,
    };
    if (input.repository !== undefined) {
      const fresh = repositorySummary(input.repository);
      const merged = new Map(
        state.repository.merged.map((fix) => [
          `${fix.pullRequest}:${fix.commit}`,
          fix,
        ]),
      );
      for (const fix of fresh.merged)
        merged.set(
          `${fix.pullRequest}:${fix.commit}`,
          retainMergeEvidence(
            merged.get(`${fix.pullRequest}:${fix.commit}`),
            fix,
          ),
        );
      const pendingIssueNumbers = issueNumbers([
        ...(state.repository.pendingIssueNumbers ?? []),
        ...(fresh.pendingIssueNumbers ?? []),
      ]).filter(
        (n) =>
          ![...merged.values()].some(
            (fix) =>
              fix.originIssue === n &&
              fix.verification === "verified" &&
              fix.rollout === "verified",
          ),
      );
      const pendingPullRequestNumbers = issueNumbers([
        ...(state.repository.pendingPullRequestNumbers ?? []),
        ...(fresh.pendingPullRequestNumbers ?? []),
      ]).filter(
        (n) =>
          ![...merged.values()].some(
            (fix) =>
              fix.pullRequest === n &&
              fix.verification === "verified" &&
              fix.rollout === "verified",
          ),
      );
      state.repository = {
        ...fresh,
        merged: [...merged.values()],
        pendingIssueNumbers,
        pendingPullRequestNumbers,
      };
    }
    if (
      current !== undefined &&
      (await readIssue(input.issue, current.number)).body !== current.body
    )
      throw new Error(
        "Current weekly body changed; retry from fresh observation.",
      );
    let owner =
      current === undefined
        ? "\n\n## Owner notes\n\n"
        : ownerText(await readIssue(input.issue, current.number));
    for (const previous of older) {
      const notes = ownerText(previous);
      const ownerMarker = `<!-- academic-os-weekly-owner-carry:v1 issue=${previous.number} digest=${createHash("sha256").update(notes.trimEnd()).digest("hex")} -->`;
      if (notes.trim() !== "## Owner notes" && !owner.includes(ownerMarker))
        owner += `\n\n${ownerMarker}\nPreserved from #${previous.number}:\n${notes}`;
    }
    const actionable =
      Object.values(state.scopes).some(
        (s) => s.needsOwner || s.date < weekStart,
      ) ||
      state.unknown.length > 0 ||
      state.repository.unresolved > 0 ||
      state.repository.awaiting > 0 ||
      (state.repository.pendingIssueNumbers?.length ?? 0) > 0 ||
      (state.repository.pendingPullRequestNumbers?.length ?? 0) > 0 ||
      state.repository.merged.some(
        (f) => f.verification !== "verified" || f.rollout !== "verified",
      );
    const body = render(marker, state, owner, weekStart);
    let outcome: MorningIssueReport["outcome"];
    if (current === undefined) {
      number = await input.issue.raise({
        title: `Weekly maintenance review ${weekStart}`,
        body,
        labels: WEEKLY_ISSUE_LABELS,
      });
      outcome = "created";
    } else {
      number = current.number;
      await input.issue.update({ number, body });
      if (current.state === "CLOSED" && actionable) {
        await input.issue.reopen(number);
        outcome = "reopened";
      } else outcome = "updated";
    }
    const published = await readIssue(input.issue, number);
    if (
      published.body !== body ||
      published.state !==
        (current?.state === "CLOSED" && !actionable ? "CLOSED" : "OPEN")
    )
      throw new Error(
        "Weekly publication readback did not match; predecessors retained.",
      );
    for (const previous of [...older, ...legacy]) {
      const fresh = await readIssue(input.issue, previous.number);
      if (fresh.body !== previous.body || fresh.state !== "OPEN")
        throw new Error(
          "Predecessor changed; retirement requires reconciliation.",
        );
      await input.evidence?.archiveIssue({
        number: previous.number,
        title: previous.title,
        body: previous.body,
        reason: "weekly-transfer",
      });
      const beforeClose = await readIssue(input.issue, previous.number);
      if (beforeClose.body !== fresh.body || beforeClose.state !== "OPEN")
        throw new Error(
          "Predecessor changed after snapshot; transfer requires reconciliation.",
        );
      await input.issue.close(previous.number, number);
      const closed = await readIssue(input.issue, previous.number);
      if (closed.state !== "CLOSED" || closed.body !== fresh.body)
        throw new Error(
          "Predecessor closure/body preservation unverified; reconcile retained snapshot.",
        );
      retired.push(previous.number);
    }

    return {
      outcome,
      number,
      weekStart,
      actionable,
      ...(retired.length === 0 ? {} : { numbers: retired }),
    };
  } catch (error) {
    return {
      outcome: "failed",
      number,
      ...(retired.length === 0 ? {} : { numbers: retired }),
      failure: routineFailure(error, "weekly-issue-failed"),
    };
  }
}
