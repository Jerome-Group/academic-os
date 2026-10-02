import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { offeringCalendarDay } from "../../src/routine/offering-calendar-day.js";
import {
  morningIssueMarker,
  weeklyRepairSummary,
} from "../../src/routine/run-morning-routine.js";
import type {
  MorningIssue,
  MorningIssuePort,
  WeeklyIssueEvidenceStore,
} from "../../src/routine/types.js";
import {
  offeringWeekStart,
  reconcileWeeklyIssue,
  weeklyIssueMarker,
  weeklyScopeId,
} from "../../src/routine/weekly-review.js";

function fixture() {
  const issues = new Map<number, MorningIssue>();
  const events: string[] = [];
  const originals: MorningIssue[] = [];
  const issue: MorningIssuePort = {
    list: async () => [...issues.values()].map((value) => ({ ...value })),
    read: async (number) => {
      events.push(`read:${number}`);
      const value = issues.get(number);
      assert.ok(value);
      return { ...value };
    },
    raise: async (input) => {
      const number = Math.max(0, ...issues.keys()) + 1;
      issues.set(number, { ...input, number, state: "OPEN" });
      events.push(`create:${number}`);
      return number;
    },
    update: async ({ number, body }) => {
      const previous = issues.get(number);
      assert.ok(previous);
      issues.set(number, { ...previous, body });
      events.push(`update:${number}`);
    },
    reopen: async (number) => {
      const previous = issues.get(number);
      assert.ok(previous);
      issues.set(number, { ...previous, state: "OPEN" });
      events.push(`reopen:${number}`);
    },
    close: async (number, transferTo) => {
      const previous = issues.get(number);
      assert.ok(previous);
      issues.set(number, { ...previous, state: "CLOSED" });
      events.push(`close:${number}`);
      if (transferTo !== undefined)
        events.push(`transfer:${number}:${transferTo}`);
    },
  };
  const evidence: WeeklyIssueEvidenceStore = {
    archiveIssue: async (input) => {
      originals.push({ ...input, state: "OPEN" });
      events.push(`archive:${input.number}`);
    },
  };
  return { issue, evidence, issues, events, originals };
}
const summary = {
  targets: 2,
  preludePending: 0,
  parked: 0,
  failures: 0,
  verifiedMaintenance: 3,
  checkedMaintenance: 2,
  verifiedControlWrites: 1,
  awaitingMaintenance: 0,
};
const observation = {
  date: "2026-08-24",
  cohort: "synthetic-cohort",
  moduleCodes: ["AB1234", "CD5678"],
  scope: "monitoring-cohort" as const,
  summary,
  needsOwner: false,
};
function queueState(body: string) {
  const value = /<!-- academic-os-weekly-state:v1 (\S+) -->/u.exec(body)?.[1];
  assert.ok(value);
  return JSON.parse(decodeURIComponent(value));
}
async function run(
  f: ReturnType<typeof fixture>,
  changes: Partial<Parameters<typeof reconcileWeeklyIssue>[0]> = {},
) {
  return await reconcileWeeklyIssue({ ...observation, ...f, ...changes });
}
function body(f: ReturnType<typeof fixture>, number = 1) {
  const found = f.issues.get(number);
  assert.ok(found);
  return found.body;
}

describe("weekly maintenance queue", () => {
  it("uses offering Monday through missed Monday and year boundaries", () => {
    assert.equal(offeringWeekStart("2026-08-26"), "2026-08-24");
    assert.equal(offeringWeekStart("2026-01-01"), "2025-12-29");
    assert.equal(
      offeringWeekStart(offeringCalendarDay(new Date("2026-08-23T16:00:00Z"))),
      "2026-08-24",
    );
    assert.throws(() => offeringWeekStart("2026-02-31"));
  });
  it("creates the first quiet review and updates one issue for every day, cohort and scope", async () => {
    const f = fixture();
    const first = await run(f, { date: "2026-08-26" });
    assert.equal(first.outcome, "created");
    assert.equal(first.actionable, false);
    await run(f, {
      date: "2026-08-27",
      cohort: "different-cohort",
      moduleCodes: ["EF9012"],
      scope: "modules-only",
    });
    assert.equal(f.issues.size, 1);
    assert.equal(
      f.issues.get(1)?.title,
      "Weekly maintenance review 2026-08-24",
    );
    assert.equal(Object.keys(queueState(body(f)).scopes).length, 2);
    for (const heading of [
      "Overview/Coverage",
      "Merged repository fixes",
      "Verified maintenance",
      "Unresolved work",
      "Awaiting verification",
      "Owner notes",
      "Verification limits",
    ])
      assert.ok(body(f).includes(`## ${heading}`));
  });
  it("hashes the exact scope without publishing configured identities", () => {
    assert.equal(
      weeklyScopeId("private", ["B", "A", "A"], "modules-only"),
      weeklyScopeId("private", ["A", "B"], "modules-only"),
    );
    assert.notEqual(
      weeklyScopeId("private", ["A"], "modules-only"),
      weeklyScopeId("private", ["A"], "monitoring-cohort"),
    );
    assert.equal(
      weeklyIssueMarker("2026-08-24"),
      "<!-- academic-os-weekly-issue:v1 week=2026-08-24 -->",
    );
  });
  it("narrow clean observations cannot clear broader or different cohort work", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    const result = await run(f, {
      moduleCodes: ["AB1234"],
      scope: "modules-only",
    });
    assert.equal(result.actionable, true);
    await run(f, { cohort: "other", needsOwner: false });
    const state = queueState(body(f));
    assert.equal(
      state.scopes[
        weeklyScopeId(
          observation.cohort,
          observation.moduleCodes,
          observation.scope,
        )
      ].needsOwner,
      true,
    );
  });
  it("same exact fresh scope can clear its current-week pending observation", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    const result = await run(f, { date: "2026-08-25" });
    assert.equal(result.actionable, false);
    assert.equal(f.issues.size, 1);
  });
  it("quiet next-week observation retains unresolved predecessor as unknown", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    const result = await run(f, { date: "2026-08-31" });
    assert.equal(result.actionable, true);
    assert.equal(f.issues.get(1)?.state, "CLOSED");
    assert.ok(body(f, 2).includes("#1; not automatically resolved"));
    assert.equal(f.originals[0]?.number, 1);
    assert.ok(f.events.indexOf("read:2") < f.events.indexOf("close:1"));
    assert.ok(f.events.indexOf("archive:1") < f.events.indexOf("close:1"));
  });
  it("missing scopes retain prior-week awaiting status", async () => {
    const f = fixture();
    await run(f);
    const result = await run(f, {
      date: "2026-08-31",
      moduleCodes: ["AB1234"],
      scope: "modules-only",
    });
    assert.equal(result.actionable, true);
    assert.match(body(f, 2), /1 await this week's observation/u);
  });
  it("preserves Owner text outside the managed section on update and rollover", async () => {
    const f = fixture();
    await run(f);
    const previous = f.issues.get(1);
    assert.ok(previous);
    previous.body += "Exact Owner note: review Thursday.\n";
    await run(f, { date: "2026-08-25" });
    assert.ok(body(f).includes("Exact Owner note: review Thursday.\n"));
    await run(f, { date: "2026-08-31" });
    assert.ok(body(f, 2).includes("Exact Owner note: review Thursday.\n"));
  });
  it("keeps thirty unchanged same-week updates byte-stable with Owner text, merges and transferred unknowns", async () => {
    for (const note of [
      "",
      "\n\n  Exact Owner note: retain whitespace.  \n\n",
    ]) {
      const f = fixture();
      f.issues.set(7, {
        number: 7,
        title: "Morning report 2026-08-24",
        state: "OPEN",
        body: `${morningIssueMarker("legacy", ["ZZ0000"])}\nSynthetic unknown observation.`,
      });
      const repository = {
        merged: [
          {
            pullRequest: 12,
            commit: "a".repeat(40),
            verification: "verified" as const,
            rollout: "verified" as const,
          },
        ],
        unresolved: 0,
        awaiting: 0,
      };
      await run(f, { repository });
      const current = f.issues.get(8);
      assert.ok(current);
      current.body += note;
      const expected = current.body;
      for (let attempt = 0; attempt < 30; attempt++) {
        assert.equal((await run(f, { repository })).outcome, "updated");
        assert.equal(body(f, 8), expected);
      }
      assert.equal(f.issues.size, 2);
      assert.equal(
        f.events.filter((event) => event.startsWith("create:")).length,
        1,
      );
      assert.match(expected, /PR #12 merged as/u);
      assert.match(expected, /Transferred evidence-unknown work: #7/u);
      assert.ok(expected.endsWith(note));
    }
  });
  it("keeps the first quiet publication byte-stable when repository discovery is absent", async () => {
    const f = fixture();
    await run(f);
    const expected = body(f);
    for (let attempt = 0; attempt < 30; attempt++) {
      await run(f);
      assert.equal(body(f), expected);
    }
    assert.equal(f.issues.size, 1);
  });
  it("preserves a closed quiet current week and reopens only when work becomes pending", async () => {
    const f = fixture();
    await run(f);
    await f.issue.close(1);
    const quiet = await run(f);
    assert.equal(quiet.outcome, "updated");
    assert.equal(f.issues.get(1)?.state, "CLOSED");
    assert.ok(!f.events.includes("reopen:1"));
    const failed = await run(f, { needsOwner: true });
    assert.equal(failed.outcome, "reopened");
  });
  it("requires snapshots before transferring a legacy incident and never republishes its prose", async () => {
    const f = fixture();
    const secret = "/private/synthetic-course/source.pdf";
    f.issues.set(7, {
      number: 7,
      title: "Morning report 2026-08-23",
      state: "OPEN",
      body: `${morningIssueMarker("legacy", ["ZZ0000"])}\n\n${secret}`,
    });
    const result = await run(f);
    assert.equal(result.actionable, true);
    assert.equal(f.issues.get(7)?.state, "CLOSED");
    assert.equal(f.originals[0]?.body.includes(secret), true);
    assert.equal(body(f, 8).includes(secret), false);
    assert.match(body(f, 8), /#7; not automatically resolved/u);
    assert.equal(body(f, 7), f.originals[0]?.body);
    assert.ok(f.events.includes("transfer:7:8"));
    assert.ok(!f.events.includes("update:7"));
    assert.ok(f.events.indexOf("archive:7") < f.events.indexOf("close:7"));
  });
  it("snapshot failure and absence leave predecessors open", async () => {
    for (const missing of [true, false]) {
      const f = fixture();
      await run(f);
      const evidence = missing
        ? undefined
        : {
            archiveIssue: async () => {
              throw Error("private snapshot failed");
            },
          };
      const result = await reconcileWeeklyIssue({
        ...observation,
        issue: f.issue,
        date: "2026-08-31",
        ...(evidence === undefined ? {} : { evidence }),
      });
      assert.equal(result.outcome, "failed");
      assert.equal(f.issues.get(1)?.state, "OPEN");
    }
  });
  it("failed successor readback never retires predecessors", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    const read = f.issue.read;
    assert.ok(read);
    f.issue.read = async (number) => ({
      ...(await read(number)),
      ...(number === 2 ? { body: "stale readback" } : {}),
    });
    const result = await run(f, { date: "2026-08-31" });
    assert.equal(result.outcome, "failed");
    assert.equal(f.issues.get(1)?.state, "OPEN");
    assert.equal(f.originals.length, 0);
  });
  it("interrupted retirement repeats without losing evidence or duplicating Owner carry", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    const old = f.issues.get(1);
    assert.ok(old);
    old.body += "Owner note.\n";
    const close = f.issue.close;
    let fail = true;
    f.issue.close = async (n, transferTo) => {
      if (fail && n === 1) {
        fail = false;
        throw Error("interrupted close");
      }
      await close(n, transferTo);
    };
    assert.equal((await run(f, { date: "2026-08-31" })).outcome, "failed");
    assert.equal(f.issues.get(1)?.state, "OPEN");
    const repeated = await run(f, { date: "2026-08-31" });
    assert.equal(repeated.outcome, "updated");
    assert.equal(f.issues.size, 2);
    assert.equal(f.issues.get(1)?.state, "CLOSED");
    assert.equal(body(f, 2).split("Owner note.").length - 1, 1);
  });
  it("reconciles duplicate current-week issues after verified carry and snapshot", async () => {
    const f = fixture();
    await run(f, { needsOwner: true });
    f.issues.set(2, { ...(f.issues.get(1) as MorningIssue), number: 2 });
    const result = await run(f);
    assert.equal(result.number, 1);
    assert.equal(f.issues.get(2)?.state, "CLOSED");
    assert.equal(result.actionable, true);
  });
  it("refuses malformed weekly state, future observations and unmanaged legacy ownership", async () => {
    const f = fixture();
    await run(f);
    const old = f.issues.get(1);
    assert.ok(old);
    old.body = old.body.replace("academic-os-weekly-state:v1", "broken-state");
    assert.equal((await run(f)).outcome, "failed");
    assert.equal(f.events.filter((e) => e.startsWith("update:")).length, 0);
    const clean = fixture();
    clean.issues.set(4, {
      number: 4,
      title: "Morning report 2026-08-23",
      body: "unmanaged Owner issue",
      state: "OPEN",
    });
    await run(clean);
    assert.equal(clean.issues.get(4)?.state, "OPEN");
  });
  it("retains merged facts through quiet reports while rollout remains independently pending", async () => {
    const f = fixture();
    const merged = {
      pullRequest: 12,
      commit: "a".repeat(40),
      verification: "verified" as const,
      rollout: "awaiting" as const,
    };
    await run(f, {
      repository: { merged: [merged], unresolved: 0, awaiting: 1 },
    });
    const result = await run(f, {
      date: "2026-08-25",
      summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
      repository: { merged: [], unresolved: 0, awaiting: 0 },
    });
    assert.equal(result.actionable, true);
    assert.match(body(f), /PR #12 merged as/u);
    assert.match(
      body(f),
      /combined-main verification verified; rollout awaiting/u,
    );
    assert.match(body(f), /Verified maintenance entries: 3/u);
    const verified = await run(f, {
      date: "2026-08-25",
      summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
      repository: {
        merged: [{ ...merged, rollout: "verified" }],
        unresolved: 0,
        awaiting: 0,
      },
    });
    assert.equal(verified.actionable, false);
  });
  it("safe merge projection does not publish repair messages, paths or pretend a merged fix rolled out", () => {
    const projected = weeklyRepairSummary({
      schemaVersion: 1,
      outcome: "blocked",
      pullRequest: 12,
      mergeCommit: "a".repeat(40),
      postmergeVerification: "passed",
      rolloutVerification: "blocked",
      code: "/private/secret",
      evidence: "/private/secret",
      modelAttestation: "unverified",
    });
    assert.equal(projected.merged[0]?.rollout, "failed");
    assert.equal(projected.unresolved, 1);
    assert.ok(!JSON.stringify(projected).includes("private"));
    assert.equal(
      weeklyRepairSummary({
        schemaVersion: 1,
        outcome: "merged",
        pullRequest: 12,
        modelAttestation: "unverified",
      }).merged.length,
      0,
    );
  });
});

it("retains exact merge verification through missing collector receipts and accepts new evidenced failures", async () => {
  const f = fixture();
  const merged = {
    pullRequest: 12,
    commit: "a".repeat(40),
    verification: "verified" as const,
    rollout: "verified" as const,
  };
  await run(f, {
    repository: { merged: [merged], unresolved: 0, awaiting: 0 },
  });
  await run(f, {
    date: "2026-08-25",
    repository: {
      merged: [{ ...merged, verification: "awaiting", rollout: "awaiting" }],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.match(
    body(f),
    /combined-main verification verified; rollout verified/u,
  );
  await run(f, {
    date: "2026-08-25",
    repository: {
      merged: [{ ...merged, rollout: "failed" }],
      unresolved: 1,
      awaiting: 0,
    },
  });
  await run(f, {
    date: "2026-08-26",
    repository: {
      merged: [{ ...merged, verification: "awaiting", rollout: "awaiting" }],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.match(body(f), /combined-main verification verified; rollout failed/u);
});

it("accumulates weekly maintenance by exact day/scope and conservatively deduplicates reruns", async () => {
  const f = fixture();
  await run(f);
  await run(f);
  assert.match(body(f), /Verified maintenance entries: 3/u);
  await run(f, {
    date: "2026-08-25",
    summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
  });
  assert.match(body(f), /Verified maintenance entries: 3/u);
  assert.match(body(f), /verified control writes: 1/u);
  await run(f, {
    date: "2026-08-25",
    summary: { ...summary, verifiedMaintenance: 2, verifiedControlWrites: 2 },
  });
  await run(f, {
    date: "2026-08-25",
    summary: { ...summary, verifiedMaintenance: 1, verifiedControlWrites: 1 },
  });
  assert.match(body(f), /Verified maintenance entries: 5/u);
  assert.match(body(f), /verified control writes: 3/u);
  await run(f, {
    date: "2026-08-31",
    summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
  });
  assert.match(body(f, 2), /Verified maintenance entries: 0/u);
});

it("keeps safe pending issue/PR identities until corresponding exact merge is independently verified", async () => {
  const f = fixture();
  await run(f, {
    repository: {
      merged: [],
      unresolved: 1,
      awaiting: 0,
      pendingIssueNumbers: [17],
      pendingPullRequestNumbers: [12],
    },
  });
  await run(f, {
    date: "2026-08-25",
    repository: {
      merged: [],
      unresolved: 0,
      awaiting: 0,
      pendingIssueNumbers: [],
      pendingPullRequestNumbers: [],
    },
  });
  assert.match(body(f), /Repository issue awaiting reconciliation: #17/u);
  assert.match(
    body(f),
    /Repository pull request awaiting reconciliation: #12/u,
  );
  const result = await run(f, {
    date: "2026-08-25",
    repository: {
      merged: [
        {
          originIssue: 17,
          pullRequest: 12,
          commit: "a".repeat(40),
          verification: "verified",
          rollout: "verified",
        },
      ],
      unresolved: 0,
      awaiting: 0,
    },
  });
  assert.equal(result.actionable, false);
  assert.doesNotMatch(body(f), /Repository issue awaiting reconciliation/u);
  assert.deepEqual(
    weeklyRepairSummary({
      schemaVersion: 1,
      outcome: "unchanged",
      issue: 17,
      pullRequest: 12,
      modelAttestation: "unverified",
    }).pendingIssueNumbers,
    [17],
  );
});

it("duplicate scope receipts retain earlier maintenance even when the canonical observation is newer", async () => {
  const f = fixture();
  await run(f, {
    date: "2026-08-25",
    summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
  });
  const other = fixture();
  await run(other);
  f.issues.set(2, { ...(other.issues.get(1) as MorningIssue), number: 2 });
  await run(f, {
    date: "2026-08-25",
    summary: { ...summary, verifiedMaintenance: 0, verifiedControlWrites: 0 },
  });
  assert.match(body(f), /Verified maintenance entries: 3/u);
  assert.equal(f.issues.get(2)?.state, "CLOSED");
});

it("does not claim transfer when the close result or original-body preservation cannot be read back", async () => {
  const f = fixture();
  await run(f);
  const close = f.issue.close;
  f.issue.close = async (number, transferTo) => {
    await close(number, transferTo);
    const issue = f.issues.get(number);
    assert.ok(issue);
    issue.body += "Concurrent Owner note.";
  };
  const result = await run(f, { date: "2026-08-31" });
  assert.equal(result.outcome, "failed");
  assert.equal(result.numbers, undefined);
  assert.ok(f.originals.length > 0);
});

it("rollover leaves completed merges in their original week and carries only pending merge evidence", async () => {
  const f = fixture();
  await run(f, {
    repository: {
      merged: [
        {
          pullRequest: 11,
          commit: "a".repeat(40),
          verification: "verified",
          rollout: "verified",
        },
        {
          pullRequest: 12,
          commit: "b".repeat(40),
          verification: "verified",
          rollout: "awaiting",
        },
        {
          pullRequest: 13,
          commit: "c".repeat(40),
          verification: "failed",
          rollout: "failed",
        },
      ],
      unresolved: 1,
      awaiting: 1,
    },
  });
  const original = body(f);
  await run(f, { date: "2026-08-31" });
  assert.doesNotMatch(body(f, 2), /PR #11 merged as/u);
  assert.match(body(f, 2), /PR #12 merged as/u);
  assert.match(body(f, 2), /PR #13 merged as/u);
  assert.equal(body(f), original);
});

it("many weekly rollovers keep per-scope receipts bounded and leave predecessor bodies unchanged", async () => {
  const f = fixture();
  const date = new Date("2026-08-24T00:00:00Z");
  for (let week = 0; week < 60; week++) {
    const day = date.toISOString().slice(0, 10);
    await run(f, { date: day });
    const original = body(f, week + 1);
    const state = queueState(original);
    for (const scope of Object.values(state.scopes) as {
      receipts: Record<string, unknown>;
    }[]) {
      assert.ok(Object.keys(scope.receipts).length <= 7);
      assert.ok(
        Object.keys(scope.receipts).every(
          (d) => offeringWeekStart(d) === offeringWeekStart(day),
        ),
      );
    }
    date.setUTCDate(date.getUTCDate() + 7);
    if (week > 0)
      assert.equal(
        body(f, week),
        f.originals.find((x) => x.number === week)?.body,
      );
  }
  assert.equal(f.issues.size, 60);
});
