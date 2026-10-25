import assert from "node:assert/strict";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import {
  beginWeeklyObservation,
  offeringWeekStart,
  reconcileWeeklyIssue,
  weeklyScopeId,
} from "../../src/routine/weekly-review.js";
import { weeklyRepairSummary } from "../../src/routine/run-morning-routine.js";
import type {
  WeeklyRepositorySummary,
  WeeklyScopeSummary,
} from "../../src/routine/types.js";
import { weeklyFixture } from "../fixtures/weekly-discussion.js";
import { parsePublication } from "../../src/routine/weekly-review-state.js";

const summary: WeeklyScopeSummary = {
  targets: 1,
  preludePending: 0,
  parked: 0,
  failures: 0,
  verifiedMaintenance: 0,
  checkedMaintenance: 9,
  verifiedControlWrites: 0,
  awaitingMaintenance: 0,
};
const scope = {
  date: "2026-10-23",
  cohort: "private-cohort",
  moduleCodes: ["PRIVATE1234"],
  scope: "monitoring-cohort" as const,
};
async function publish(
  f: ReturnType<typeof weeklyFixture>,
  changes: {
    date?: string;
    moduleCodes?: string[];
    summary?: WeeklyScopeSummary;
    needsOwner?: boolean;
    repository?: WeeklyRepositorySummary;
  } = {},
) {
  const observation = await beginWeeklyObservation({
    ...scope,
    ...changes,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  return reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation,
    summary: changes.summary ?? summary,
    needsOwner: changes.needsOwner ?? false,
    ...(changes.repository === undefined
      ? {}
      : { repository: changes.repository }),
  });
}
function last(f: ReturnType<typeof weeklyFixture>): string {
  return f.appended.at(-1)?.body ?? "";
}

const resolvedRepository: WeeklyRepositorySummary = {
  merged: [],
  unresolved: 0,
  awaiting: 0,
};

it("resolution closes a complete quiet anchor, preserves Owner bytes and reopens for later work", async () => {
  const f = weeklyFixture();
  const result = await publish(f, { repository: resolvedRepository });
  assert.equal(result.outcome, "closed");
  assert.equal(f.issues.get(900)?.state, "CLOSED");
  assert.match(
    last(f),
    /Resolution applies only to the machine evidence observed/u,
  );
  const issue = f.issues.get(900);
  assert.ok(issue);
  issue.body += "\nOWNER  whitespace\t\n";
  const bytes = issue.body;
  assert.equal(
    (await publish(f, { repository: resolvedRepository })).outcome,
    "not-needed",
  );
  assert.equal(f.appended.length, 1);
  assert.equal(f.states.length, 1);
  assert.equal(
    (await publish(f, { repository: resolvedRepository, needsOwner: true }))
      .outcome,
    "reopened",
  );
  assert.equal(issue.state, "OPEN");
  assert.equal(issue.body, bytes);
  const journal = (
    await readFile(
      join(f.stateRoot, "weekly-publication/publication.jsonl"),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const close = journal.find(
    (entry) => entry.kind === "intent" && entry.operation.kind === "resolution",
  );
  assert.ok(close);
  assert.equal(close.operation.anchorId, issue.id);
  assert.equal(close.operation.publicationId, result.publicationId);
  assert.ok(
    journal.some((entry) => entry.kind === "receipt" && entry.id === close.id),
  );
});

it("resolution requires a fresh complete cohort and explicit repository evidence", async () => {
  for (const changes of [
    {},
    { repository: { ...resolvedRepository, unresolved: 1 } },
    { repository: { ...resolvedRepository, pendingIssueNumbers: [17] } },
    { repository: { ...resolvedRepository, pendingPullRequestNumbers: [19] } },
    {
      repository: {
        ...resolvedRepository,
        merged: [
          {
            pullRequest: 19,
            commit: "a".repeat(40),
            verification: "verified" as const,
            rollout: "awaiting" as const,
          },
        ],
      },
    },
    {
      repository: resolvedRepository,
      summary: { ...summary, preludePending: 1 },
    },
    {
      repository: resolvedRepository,
      summary: { ...summary, awaitingMaintenance: 1 },
    },
  ]) {
    const f = weeklyFixture();
    await publish(f, changes);
    assert.equal(f.issues.get(900)?.state, "OPEN");
    assert.equal(f.states.length, 0);
  }
  const f = weeklyFixture();
  const observation = await beginWeeklyObservation({
    ...scope,
    scope: "modules-only",
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation,
    summary,
    needsOwner: false,
  });
  assert.equal(f.issues.get(900)?.state, "OPEN");
  const stale = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  await publish(f, { repository: resolvedRepository });
  const anchor = f.issues.get(900);
  assert.ok(anchor);
  anchor.state = "OPEN";
  await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: stale,
    summary,
    needsOwner: false,
    repository: resolvedRepository,
  });
  assert.equal(f.states.length, 1);
  assert.equal(anchor.state, "OPEN");
});

it("incomplete full-cohort prelude stays actionable despite a false caller attention flag", async () => {
  const f = weeklyFixture();
  const result = await publish(f, {
    repository: resolvedRepository,
    summary: { ...summary, preludePending: 1 },
    needsOwner: false,
  });
  assert.equal(result.actionable, true);
  assert.equal(f.issues.get(900)?.state, "OPEN");
  assert.equal(f.states.length, 0);
  assert.equal(parsePublication(last(f))?.needsOwner, true);
});

it("resolution forces an immutable review before closing an already quiet open anchor", async () => {
  const f = weeklyFixture();
  await publish(f, { repository: resolvedRepository });
  const issue = f.issues.get(900);
  assert.ok(issue);
  issue.state = "OPEN";
  const closed = await publish(f, { repository: resolvedRepository });
  assert.equal(closed.outcome, "closed");
  assert.equal(f.appended.length, 2);
  assert.equal(issue.state, "CLOSED");
});

it("resolution retains an open anchor when trusted facts arrive immediately before close", async () => {
  const { observationMarker } = await import(
    "../../src/routine/weekly-review-state.js"
  );
  const f = weeklyFixture();
  const comments = f.issue.listComments;
  let scans = 0;
  f.issue.listComments = async (number) => {
    if (last(f).includes("academic-os-weekly-resolution") && ++scans === 2)
      f.comments.set(999, {
        id: 999,
        issueNumber: number,
        creatorId: 7,
        body: `${observationMarker({ scope: "c".repeat(64), date: scope.date, parents: [], repositoryParents: [], summary, needsOwner: true })}\nlate`,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        url: `https://github.com/fixture/repo/issues/${number}#issuecomment-999`,
      });
    return comments(number);
  };
  const result = await publish(f, { repository: resolvedRepository });
  assert.equal(result.outcome, "failed");
  assert.match(
    result.failure?.message ?? "",
    /facts changed before resolution/u,
  );
  assert.equal(f.issues.get(900)?.state, "OPEN");
  assert.equal(f.states.length, 0);
});

it("resolution requires exact closed readback and retains uncertain receipts until reconciliation", async () => {
  for (const mismatch of ["identity", "state"]) {
    const f = weeklyFixture();
    const read = f.issue.readIssue;
    f.issue.readIssue = async (number) => {
      const result = await read(number);
      return f.states.length === 0
        ? result
        : mismatch === "identity"
          ? { ...result, id: result.id + 1 }
          : { ...result, state: "OPEN" };
    };
    const result = await publish(f, { repository: resolvedRepository });
    assert.equal(result.outcome, "failed");
    const path = join(f.stateRoot, "weekly-publication/publication.jsonl");
    const entries = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const close = entries.find(
      (entry) =>
        entry.kind === "intent" && entry.operation.kind === "resolution",
    );
    assert.ok(close);
    assert.equal(
      entries.some(
        (entry) => entry.kind === "receipt" && entry.id === close.id,
      ),
      false,
    );
    f.issue.readIssue = read;
    assert.equal(
      (await publish(f, { repository: resolvedRepository })).outcome,
      "not-needed",
    );
    assert.equal(f.states.length, 1);
    assert.equal(f.appended.length, 1);
    assert.equal(f.issues.get(900)?.state, "CLOSED");
  }
});

it("resolution cannot erase incomplete coverage in another scope or a stale scope", async () => {
  for (const prior of [
    { moduleCodes: ["OTHER"], summary: { ...summary, preludePending: 1 } },
    { moduleCodes: ["OTHER"], date: "2026-10-16" },
  ]) {
    const f = weeklyFixture();
    await publish(f, prior);
    const result = await publish(f, { repository: resolvedRepository });
    assert.equal(result.actionable, true);
    assert.equal(f.issues.get(result.number ?? 0)?.state, "OPEN");
  }
});

it("legacy state intents retain their digest and transfer meaning through recovery", async () => {
  const { digest } = await import("../../src/routine/weekly-review-state.js");
  const f = weeklyFixture();
  await publish(f);
  const anchor = f.issues.get(900);
  assert.ok(anchor);
  anchor.state = "CLOSED";
  const operation = { kind: "state", number: 900, state: "CLOSED" };
  const id = "f".repeat(64);
  await appendFile(
    join(f.stateRoot, "weekly-publication/publication.jsonl"),
    `${JSON.stringify({ kind: "intent", id, semanticDigest: digest(operation), operation })}\n`,
  );
  assert.equal((await publish(f)).outcome, "not-needed");
  const journal = await readFile(
    join(f.stateRoot, "weekly-publication/publication.jsonl"),
    "utf8",
  );
  assert.ok(journal.includes(JSON.stringify(operation)));
  assert.ok(
    journal.includes(JSON.stringify({ kind: "receipt", id, remoteIds: [900] })),
  );
  assert.doesNotMatch(journal, /"kind":"resolution"/u);
  assert.equal((await publish(f, { needsOwner: true })).outcome, "reopened");
});

it("keeps Monday offering identity and exact private scope hashing", () => {
  assert.equal(offeringWeekStart("2026-10-25"), "2026-10-19");
  assert.equal(
    weeklyScopeId("p", ["B", "A", "A"], "modules-only"),
    weeklyScopeId("p", ["A", "B"], "modules-only"),
  );
  assert.notEqual(
    weeklyScopeId("p", ["A"], "modules-only"),
    weeklyScopeId("p", ["A"], "monitoring-cohort"),
  );
});
it("creates a static anchor, preserves body/comments and suppresses quiet same-week day churn", async () => {
  const f = weeklyFixture();
  assert.equal((await publish(f)).outcome, "created");
  const issue = f.issues.get(900);
  assert.ok(issue);
  issue.body += "\n OWNER  whitespace\t\n";
  const bytes = issue.body;
  const original = f.comments.get(100);
  assert.ok(original);
  assert.equal(
    (await publish(f, { date: "2026-10-24" })).outcome,
    "not-needed",
  );
  assert.equal(f.appended.length, 1);
  assert.equal(issue.body, bytes);
  assert.equal(f.comments.get(100)?.body, original.body);
  assert.match(last(f), /As of 2026-10-23/u);
  assert.doesNotMatch(last(f), /private-cohort|PRIVATE1234/u);
  for (const section of [
    "Overview/Coverage",
    "Merged repository fixes",
    "Verified maintenance",
    "Unresolved work",
    "Awaiting verification",
    "Verification limits",
  ])
    assert.ok(last(f).includes(`## ${section}`));
});
it("new positive daily receipts publish and same-day maxima retain verified work", async () => {
  const f = weeklyFixture();
  await publish(f, {
    summary: { ...summary, verifiedMaintenance: 3, verifiedControlWrites: 2 },
  });
  assert.equal((await publish(f, { summary })).outcome, "not-needed");
  await publish(f, {
    date: "2026-10-24",
    summary: { ...summary, verifiedMaintenance: 1 },
  });
  assert.match(last(f), /Verified maintenance entries: 4\./u);
  assert.match(last(f), /verified control writes: 2\./u);
});
it("incomparable same-scope results await fresh work naming both; different scopes combine", async () => {
  const f = weeklyFixture();
  const a = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  const b = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: a,
    summary,
    needsOwner: false,
  });
  const conflict = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: b,
    summary: { ...summary, parked: 1 },
    needsOwner: true,
  });
  assert.equal(conflict.actionable, true);
  assert.match(last(f), /Incomparable observations/u);
  await publish(f, { moduleCodes: ["OTHER"], summary });
  assert.match(last(f), /2 exact maintenance scopes/u);
  const fresh = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  assert.equal(fresh.parents.length, 2);
  const resolved = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: fresh,
    summary,
    needsOwner: false,
  });
  assert.equal(resolved.actionable, false);
  assert.doesNotMatch(last(f), /Incomparable observations/u);
});
it("missing repository verification retains positive exact receipts; contradictory receipts await fresh check", async () => {
  const f = weeklyFixture(),
    fix = {
      pullRequest: 19,
      originIssue: 17,
      commit: "a".repeat(40),
      verification: "verified" as const,
      rollout: "verified" as const,
    };
  const base = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  const concurrent = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: base,
    summary,
    needsOwner: false,
    repository: { merged: [fix], unresolved: 0, awaiting: 0 },
  });
  await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: concurrent,
    summary,
    needsOwner: false,
    repository: {
      merged: [{ ...fix, verification: "failed" }],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.match(last(f), /combined-main verification awaiting/u);
  await publish(f, {
    repository: {
      merged: [{ ...fix, verification: "awaiting", rollout: "awaiting" }],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.match(last(f), /combined-main verification awaiting/u);
  await publish(f, {
    repository: { merged: [fix], unresolved: 0, awaiting: 0 },
  });
  assert.match(
    last(f),
    /combined-main verification verified; rollout verified/u,
  );
  await publish(f, { repository: { merged: [], unresolved: 0, awaiting: 0 } });
  assert.match(
    last(f),
    /combined-main verification verified; rollout verified/u,
  );
});
it("unknown POST is durably fenced, exact committed response loss reuses without duplicate", async () => {
  const f = weeklyFixture();
  await publish(f);
  const append = f.issue.appendComment;
  f.issue.appendComment = async (input) => {
    await append(input);
    throw Error("response lost");
  };
  const basis = await beginWeeklyObservation({
    ...scope,
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  const result = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation: basis,
    summary: { ...summary, parked: 2 },
    needsOwner: true,
  });
  assert.equal(result.outcome, "failed");
  f.issue.appendComment = append;
  await publish(f, { summary: { ...summary, parked: 2 }, needsOwner: true });
  assert.equal(f.appended.length, 2);
  f.issue.appendComment = async () => {
    throw Error("not yet committed");
  };
  await publish(f, { summary: { ...summary, parked: 3 }, needsOwner: true });
  await assert.rejects(
    () =>
      beginWeeklyObservation({
        ...scope,
        issue: f.issue,
        stateRoot: f.stateRoot,
      }),
    /remains fenced/u,
  );
  assert.equal(f.appended.length, 2);
});
it("known edited/deleted publications retain private originals and refuse publication", async () => {
  for (const mutation of ["edit", "delete"]) {
    const f = weeklyFixture();
    await publish(f);
    const comment = f.comments.get(100);
    assert.ok(comment);
    if (mutation === "edit") comment.body += "Owner change";
    else f.comments.delete(100);
    await assert.rejects(
      () =>
        beginWeeklyObservation({
          ...scope,
          issue: f.issue,
          stateRoot: f.stateRoot,
        }),
      /integrity unknown|disappeared/u,
    );
    const journal = await readFile(
      join(f.stateRoot, "weekly-publication/publication.jsonl"),
      "utf8",
    );
    assert.ok(journal.includes("academic-os-weekly-observation:v2"));
    assert.equal(f.appended.length, 1);
  }
});
it("closed title-edited private-bound anchors stay closed when quiet and reopen when actionable", async () => {
  const f = weeklyFixture();
  await publish(f);
  const issue = f.issues.get(900);
  assert.ok(issue);
  issue.title = "Owner title";
  issue.body = "Owner body";
  issue.state = "CLOSED";
  assert.equal((await publish(f)).outcome, "not-needed");
  assert.equal(issue.state, "CLOSED");
  assert.equal((await publish(f, { needsOwner: true })).outcome, "reopened");
  assert.equal(issue.state, "OPEN");
  assert.equal(issue.body, "Owner body");
});
it("rollover snapshots complete bodies/comments, links notes and uses state-only retirement", async () => {
  const f = weeklyFixture();
  await publish(f, { needsOwner: true });
  const old = f.issues.get(900);
  assert.ok(old);
  old.body += "\nPRIVATE OWNER NOTES\t";
  const bytes = old.body;
  const result = await publish(f, { date: "2026-10-26" });
  assert.equal(result.outcome, "created");
  assert.equal(old.state, "CLOSED");
  assert.equal(old.body, bytes);
  assert.doesNotMatch(last(f), /PRIVATE OWNER NOTES/u);
  const snapshots = await readdir(join(f.stateRoot, "weekly-evidence"));
  const snapshot = JSON.parse(
    await readFile(
      join(f.stateRoot, "weekly-evidence", snapshots[0] ?? ""),
      "utf8",
    ),
  );
  assert.equal(snapshot.body, bytes);
  assert.equal(snapshot.comments[0].body, f.comments.get(100)?.body);
  assert.match(
    f.appended.at(-1)?.body ?? "",
    /Closure records transfer, not resolution/u,
  );
});
it("legacy markers without exact private receipts remain unknown and outsiders are never adopted", async () => {
  const f = weeklyFixture();
  f.issues.set(1, {
    id: 1,
    number: 1,
    creatorId: 99,
    title: "Weekly maintenance review 2026-10-19",
    body: "<!-- academic-os-weekly-issue:v2 week=2026-10-19 -->\n",
    state: "OPEN",
    url: "https://github.com/fixture/repo/issues/1",
  });
  f.issues.set(2, {
    id: 2,
    number: 2,
    creatorId: 7,
    title: "Weekly maintenance review 2026-10-12",
    body: "<!-- academic-os-weekly-issue:v1 week=2026-10-12 -->\nUNPROVEN POSITIVE 9000",
    state: "OPEN",
    url: "https://github.com/fixture/repo/issues/2",
  });
  const result = await publish(f);
  assert.equal(result.actionable, true);
  assert.equal(f.issues.get(1)?.state, "OPEN");
  const review = f.appended.find((a) => a.number !== 2)?.body ?? "";
  assert.match(review, /Evidence-unknown predecessor or publication: #2/u);
  assert.doesNotMatch(review, /UNPROVEN POSITIVE/u);
});
it("identity changes and malformed current counters refuse before remote mutations", async () => {
  const f = weeklyFixture();
  await publish(f);
  f.issue.identify = async () => ({ repositoryId: 9, publisherId: 88 });
  await assert.rejects(
    () =>
      beginWeeklyObservation({
        ...scope,
        issue: f.issue,
        stateRoot: f.stateRoot,
      }),
    /identity changed/u,
  );
  assert.equal(f.appended.length, 1);
  const g = weeklyFixture();
  const result = await publish(g, { summary: { ...summary, parked: -1 } });
  assert.equal(result.outcome, "failed");
  assert.equal(g.raised.length, 0);
});
it("projects exact repair outcomes without treating merge alone as verification", () => {
  const result = weeklyRepairSummary({
    schemaVersion: 1,
    outcome: "merged",
    pullRequest: 12,
    issue: 10,
    mergeCommit: "b".repeat(40),
    postmergeVerification: "passed",
    rolloutVerification: "blocked",
    modelAttestation: "unverified",
  });
  assert.equal(result.merged[0]?.verification, "verified");
  assert.equal(result.merged[0]?.rollout, "failed");
  assert.deepEqual(result.pendingIssueNumbers, [10]);
});
it("500-observation bound and dangling bases refuse before any remote mutation", async () => {
  const { observationMarker } = await import(
    "../../src/routine/weekly-review-state.js"
  );
  const f = weeklyFixture();
  f.issues.set(1, {
    id: 1,
    number: 1,
    creatorId: 7,
    title: "closed history",
    body: "<!-- academic-os-weekly-issue:v2 week=2026-10-19 -->\n",
    state: "CLOSED",
    url: "https://github.com/fixture/repo/issues/1",
  });
  for (let n = 1; n <= 501; n++)
    f.comments.set(n, {
      id: n,
      issueNumber: 1,
      creatorId: 7,
      body: `${observationMarker({
        scope: n.toString(16).padStart(64, "0"),
        date: scope.date,
        parents: [],
        repositoryParents: [],
        summary,
        needsOwner: false,
      })}\nfixture`,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      url: `https://github.com/fixture/repo/issues/1#issuecomment-${n}`,
    });
  await assert.rejects(
    () =>
      beginWeeklyObservation({
        ...scope,
        issue: f.issue,
        stateRoot: f.stateRoot,
      }),
    /exceeds 500/u,
  );
  assert.equal(f.raised.length, 0);
  assert.equal(f.appended.length, 0);
  const g = weeklyFixture();
  await publish(g);
  const basis = await beginWeeklyObservation({
    ...scope,
    issue: g.issue,
    stateRoot: g.stateRoot,
  });
  const result = await reconcileWeeklyIssue({
    issue: g.issue,
    stateRoot: g.stateRoot,
    observation: { ...basis, parents: ["0".repeat(64)] },
    summary,
    needsOwner: false,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(g.appended.length, 1);
});
it("observed trusted facts arriving during transfer retain the open predecessor", async () => {
  const f = weeklyFixture();
  await publish(f);
  const original = f.issue.listComments;
  let injected = false;
  f.issue.listComments = async (number) => {
    const comments = await original(number);
    if (number === 900 && !injected && f.issues.size === 2) {
      injected = true;
      const { observationMarker } = await import(
        "../../src/routine/weekly-review-state.js"
      );
      const id = 999;
      f.comments.set(id, {
        id,
        issueNumber: number,
        creatorId: 7,
        body: `${observationMarker({
          scope: "c".repeat(64),
          date: "2026-10-23",
          parents: [],
          repositoryParents: [],
          summary,
          needsOwner: true,
        })}\nlate`,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        url: `https://github.com/fixture/repo/issues/${number}#issuecomment-${id}`,
      });
    }
    return comments;
  };
  const result = await publish(f, { date: "2026-10-26" });
  assert.equal(result.outcome, "failed");
  assert.equal(f.issues.get(900)?.state, "OPEN");
});
it("module-only tickets cannot publish repository resets and missing repository input preserves pending work", async () => {
  const f = weeklyFixture();
  await publish(f, { repository: { merged: [], unresolved: 2, awaiting: 1 } });
  const observation = await beginWeeklyObservation({
    ...scope,
    scope: "modules-only",
    issue: f.issue,
    stateRoot: f.stateRoot,
  });
  const rejected = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation,
    summary,
    needsOwner: false,
    repository: { merged: [], unresolved: 0, awaiting: 0 },
  });
  assert.equal(rejected.outcome, "failed");
  assert.equal(f.appended.length, 1);
  const result = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.stateRoot,
    observation,
    summary,
    needsOwner: false,
  });
  assert.equal(result.actionable, true);
  assert.match(last(f), /repository work: 2/u);
});
it("a verified merge cannot discharge another unverified exact commit for the same pending reference", async () => {
  const f = weeklyFixture();
  await publish(f, {
    repository: {
      pendingIssueNumbers: [17],
      pendingPullRequestNumbers: [19],
      merged: [
        {
          pullRequest: 19,
          originIssue: 17,
          commit: "a".repeat(40),
          verification: "verified",
          rollout: "verified",
        },
        {
          pullRequest: 19,
          originIssue: 17,
          commit: "b".repeat(40),
          verification: "failed",
          rollout: "awaiting",
        },
      ],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.match(last(f), /Repository issue awaiting reconciliation: #17/u);
  assert.match(
    last(f),
    /Repository pull request awaiting reconciliation: #19/u,
  );
});
it("100 observed provider pages permit quiet reuse but require spare pages before adding records", async () => {
  const f = weeklyFixture();
  await publish(f);
  const issues = f.issue.listIssues,
    comments = f.issue.listComments;
  f.issue.listIssues = async () => ({ ...(await issues()), pages: 100 });
  assert.equal((await publish(f)).outcome, "not-needed");
  const rollover = await publish(f, { date: "2026-10-26" });
  assert.equal(rollover.outcome, "failed");
  assert.equal(f.raised.length, 1);
  f.issue.listIssues = issues;
  f.issue.listComments = async (number) => ({
    ...(await comments(number)),
    pages: 100,
  });
  const changed = await publish(f, { needsOwner: true });
  assert.equal(changed.outcome, "failed");
  assert.equal(f.appended.length, 1);
  f.issue.listComments = async (number) => ({
    ...(await comments(number)),
    pages: 99,
  });
  assert.equal((await publish(f, { needsOwner: true })).outcome, "updated");
  assert.equal(f.appended.length, 2);
});
it("a new anchor observed after admission waits for a fresh batch", async () => {
  const f = weeklyFixture(),
    create = f.issue.createIssue;
  f.issue.createIssue = async (input) => {
    const result = await create(input);
    f.issues.set(901, {
      ...result,
      id: 1901,
      number: 901,
      url: "https://github.com/fixture/repo/issues/901",
    });
    return result;
  };
  const interrupted = await publish(f);
  assert.equal(interrupted.outcome, "failed");
  assert.equal(f.appended.length, 0);
  assert.equal(f.states.length, 0);
  const recovered = await publish(f);
  assert.equal(recovered.outcome, "updated");
  assert.equal(f.issues.get(901)?.state, "CLOSED");
});
