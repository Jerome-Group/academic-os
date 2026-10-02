import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConfiguredModule } from "../../src/config/index.js";
import {
  MORNING_ISSUE_LABELS,
  type ModulePassOutcome,
  type ModulePassReport,
  type MorningIssue,
  type MorningIssuePort,
  type MorningPreludePort,
  morningIssueMarker,
  type PreludeStepReport,
  type RoutineArtifactStore,
  runMorningRoutine,
} from "../../src/routine/index.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";

const date = "2026-08-23";
const cohort: ConfiguredModule[] = [
  { semester: "Y2S1", module: "AB1234" },
  { semester: "Y2S1", module: "CD5678" },
  { semester: "Y2S1", module: "EF9012" },
];

const quietPass: ModulePassOutcome = {
  maintenance: syntheticMaintenanceCoverage(),
  curated: [],
  rederived: [],
  superseded: [],
  withdrawn: [],
  parked: [],
  docWrites: [],
  failures: [],
  noted: [],
};

function syntheticMorning(overrides: {
  calls?: string[];
  prelude?: Partial<
    Record<"imports" | "shelf" | "tasks", PreludeStepReport | (() => never)>
  >;
  passes?: Record<string, ModulePassOutcome | (() => never)>;
  sessionDates?: string[];
  reportDates?: string[];
  artifacts?: Partial<RoutineArtifactStore>;
  issue?: Partial<MorningIssuePort>;
}) {
  const calls = overrides.calls ?? [];
  const rendered: string[] = [];
  const removed: string[] = [];
  const raised: Array<{
    title: string;
    body: string;
    labels: readonly string[];
  }> = [];
  const updated: Array<{ number: number; body: string }> = [];
  const reopened: number[] = [];
  const closed: number[] = [];
  const prelude: MorningPreludePort = {
    inspectImports: async () => {
      calls.push("prelude:imports");
      return step("import-status", overrides.prelude?.imports);
    },
    catchUpShelf: async () => {
      calls.push("prelude:shelf");
      return step("textbook-shelf-catch-up", overrides.prelude?.shelf);
    },
    pullTaskRegisters: async () => {
      calls.push("prelude:tasks");
      return step("task-register-pull", overrides.prelude?.tasks);
    },
  };
  const session = {
    run: async (module: ConfiguredModule): Promise<ModulePassReport> => {
      calls.push(`session:${module.module}`);
      const pass = overrides.passes?.[module.module] ?? quietPass;
      if (typeof pass === "function") return pass();
      return {
        ...module,
        artifacts: `/state/routine/sessions/${date}/${module.module}`,
        ...pass,
      };
    },
  };
  const artifacts: RoutineArtifactStore = {
    writeReport: async (input) => {
      calls.push("report");
      rendered.push(input.text);
      if (overrides.artifacts?.writeReport !== undefined) {
        return await overrides.artifacts.writeReport(input);
      }
      return `/state/routine/reports/${input.date}.md`;
    },
    listSessionDates: async () => overrides.sessionDates ?? [],
    listReportDates: async () => overrides.reportDates ?? [],
    removeSession: async (day) => {
      calls.push("purge:session");
      removed.push(`session:${day}`);
    },
    removeReport: async (day) => {
      calls.push("purge:report");
      removed.push(`report:${day}`);
    },
  };
  const issueState = new Map<number, MorningIssue>();
  const issue: MorningIssuePort = {
    read: async (number) => {
      calls.push("issue:read");
      const found = issueState.get(number);
      if (found === undefined) throw new Error("missing synthetic issue");
      return { ...found };
    },
    list: async () => {
      calls.push("issue:list");
      return await (overrides.issue?.list?.() ?? Promise.resolve([]));
    },
    raise: async (input) => {
      calls.push("issue:raise");
      if (overrides.issue?.raise !== undefined) {
        return await overrides.issue.raise(input);
      }
      raised.push(input);
      issueState.set(900, {
        number: 900,
        title: input.title,
        body: input.body,
        state: "OPEN",
      });
      return 900;
    },
    update: async (input) => {
      calls.push("issue:update");
      updated.push(input);
      await overrides.issue?.update?.(input);
    },
    reopen: async (number) => {
      calls.push("issue:reopen");
      reopened.push(number);
      await overrides.issue?.reopen?.(number);
    },
    close: async (number) => {
      calls.push("issue:close");
      closed.push(number);
      await overrides.issue?.close?.(number);
    },
  };
  return {
    calls,
    rendered,
    removed,
    raised,
    updated,
    reopened,
    closed,
    cohort: "Y2S1",
    prelude,
    session,
    artifacts,
    issue,
  };
}

function step(
  name: PreludeStepReport["step"],
  override: PreludeStepReport | (() => never) | undefined,
): PreludeStepReport {
  if (typeof override === "function") return override();
  return (
    override ?? {
      step: name,
      outcome: name === "import-status" ? "current" : "caught-up",
      parked: 0,
      detail: [`${name} had nothing to do`],
    }
  );
}

const parkedPass: ModulePassOutcome = {
  ...quietPass,
  parked: [
    { item: "source/odd.zip", reason: "no precedent", evidence: "cited" },
  ],
};

const notedPass: ModulePassOutcome = {
  ...quietPass,
  noted: [
    {
      item: "source/worked-handout.pdf",
      note: "The placed copy has diverged from its source and holds its ground.",
    },
  ],
};

describe("one firing of the morning routine", () => {
  it("runs the prelude, then a session per cohort module in sequence, then reports", async () => {
    const morning = syntheticMorning({});

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(morning.calls, [
      "prelude:imports",
      "prelude:shelf",
      "prelude:tasks",
      "session:AB1234",
      "session:CD5678",
      "session:EF9012",
      "report",
      "issue:list",
      "issue:raise",
      "issue:read",
    ]);
    assert.deepEqual(
      report.modules.map(({ module }) => module),
      ["AB1234", "CD5678", "EF9012"],
    );
    assert.deepEqual(
      report.prelude.map(({ step: name }) => name),
      ["import-status", "textbook-shelf-catch-up", "task-register-pull"],
    );
    assert.equal(report.report, "/state/routine/reports/2026-08-23.md");
  });

  it("keeps a module whose session dies from costing the cohort", async () => {
    const morning = syntheticMorning({
      passes: {
        CD5678: () => {
          throw new Error("the mount went away");
        },
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(morning.calls.slice(3, 6), [
      "session:AB1234",
      "session:CD5678",
      "session:EF9012",
    ]);
    assert.deepEqual(report.modules[1]?.failures, [
      { code: "session-failed", message: "the mount went away" },
    ]);
    assert.deepEqual(report.modules[2]?.failures, []);
  });

  it("keeps a prelude step that fails from costing the morning", async () => {
    const morning = syntheticMorning({
      prelude: {
        shelf: () => {
          throw new Error("the shelf is unreadable");
        },
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.prelude[1]?.outcome, "failed");
    assert.equal(
      report.prelude[1]?.failure?.message,
      "the shelf is unreadable",
    );
    assert.equal(report.prelude[2]?.outcome, "caught-up");
    assert.equal(report.modules.length, 3);
  });

  it("purges its expired artifacts before the report names what it purged", async () => {
    const morning = syntheticMorning({
      sessionDates: ["2026-08-01", "2026-08-23"],
      reportDates: ["2026-06-01", "2026-08-23"],
    });

    const report = await runMorningRoutine({ date, modules: [], ...morning });

    assert.deepEqual(morning.removed, [
      "session:2026-08-01",
      "report:2026-06-01",
    ]);
    assert.deepEqual(report.purge, {
      sessions: ["2026-08-01"],
      reports: ["2026-06-01"],
    });
    assert.ok(
      morning.calls.indexOf("purge:session") < morning.calls.indexOf("report"),
    );
  });
});

describe("the morning's issue policy", () => {
  it("marks a canonical cohort and Module set without duplicate entries", () => {
    assert.equal(
      morningIssueMarker("Y2S1", ["CD5678", "AB1234", "CD5678"]),
      morningIssueMarker("Y2S1", ["AB1234", "CD5678"]),
    );
  });

  it("reports unhealthy imports even when every LLM reports a quiet pass", async () => {
    const morning = syntheticMorning({
      prelude: {
        imports: {
          step: "import-status",
          outcome: "attention",
          parked: 1,
          detail: ["AB1234/NTULearn: partial; unread announcements"],
        },
      },
    });
    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.outcome, "reported");
    assert.equal(report.modules.length, 3);
    assert.doesNotMatch(morning.raised[0]?.body ?? "", /unread announcements/u);
    assert.match(morning.rendered[0] ?? "", /unread announcements/u);
  });

  it("cannot call incomplete or failed maintenance quiet", async () => {
    for (const maintenance of [
      [],
      syntheticMaintenanceCoverage().map((entry, index) =>
        index === 0 ? { ...entry, status: "failed" as const } : entry,
      ),
    ]) {
      const morning = syntheticMorning({
        passes: { AB1234: { ...quietPass, maintenance } },
      });
      const report = await runMorningRoutine({
        date,
        modules: cohort,
        ...morning,
      });
      assert.equal(report.outcome, "reported");
    }
  });

  it("keeps evidenced completed maintenance in the report without waking the Owner", async () => {
    const maintenance = syntheticMaintenanceCoverage().map((entry, index) =>
      index === 0 ? { ...entry, status: "maintained" as const } : entry,
    );
    const morning = syntheticMorning({
      passes: { AB1234: { ...quietPass, maintenance } },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "quiet");
    assert.equal(report.issue.outcome, "created");
    assert.match(morning.rendered[0] ?? "", /maintained/u);
  });

  it("raises one labelled issue carrying the report when something parked", async () => {
    const morning = syntheticMorning({ passes: { CD5678: parkedPass } });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "reported");
    assert.equal(report.issue.outcome, "created");
    assert.equal(report.issue.number, 900);
    assert.equal(morning.raised.length, 1);
    assert.equal(
      morning.raised[0]?.title,
      "Weekly maintenance review 2026-08-17",
    );
    assert.deepEqual(morning.raised[0]?.labels, MORNING_ISSUE_LABELS);
    assert.ok(
      morning.raised[0]?.body.startsWith(
        "<!-- academic-os-weekly-issue:v1 week=2026-08-17 -->",
      ),
    );
    assert.match(morning.raised[0]?.body ?? "", /private daily evidence/u);
  });

  it("creates the first quiet weekly review and still lands the daily report", async () => {
    const morning = syntheticMorning({});

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "quiet");
    assert.equal(report.issue.outcome, "created");
    assert.equal(report.issue.actionable, false);
    assert.equal(morning.raised.length, 1);
    assert.equal(morning.rendered.length, 1);
  });

  it("leaves the morning quiet when a pass only noted something", async () => {
    const morning = syntheticMorning({ passes: { CD5678: notedPass } });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "quiet");
    assert.equal(report.issue.outcome, "created");
    assert.equal(report.issue.actionable, false);
    assert.equal(morning.raised.length, 1);
    assert.match(morning.rendered[0] ?? "", /- Noted — 1/u);
  });

  it("raises once for a pass that both noted and parked something", async () => {
    const morning = syntheticMorning({
      passes: { CD5678: { ...parkedPass, noted: notedPass.noted } },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "reported");
    assert.equal(report.issue.outcome, "created");
    assert.equal(report.issue.number, 900);
    assert.equal(morning.raised.length, 1);
  });

  it("keeps a verified doc write in the report but raises for a failure", async () => {
    const docWrite = await runMorningRoutine({
      date,
      modules: cohort,
      ...syntheticMorning({
        passes: {
          AB1234: {
            ...quietPass,
            docWrites: [{ file: "CONTEXT.md", summary: "minted a term" }],
          },
        },
      }),
    });
    const failed = await runMorningRoutine({
      date,
      modules: cohort,
      ...syntheticMorning({
        passes: {
          AB1234: {
            ...quietPass,
            failures: [
              { code: "read-failed", message: "the mirror went away" },
            ],
          },
        },
      }),
    });

    assert.equal(docWrite.issue.actionable, false);
    assert.equal(failed.issue.outcome, "created");
  });

  it("raises for a book the shelf catch-up parked", async () => {
    const morning = syntheticMorning({
      prelude: {
        shelf: {
          step: "textbook-shelf-catch-up",
          outcome: "requires-decision",
          parked: 1,
          detail: ["Parked a book — unparseable-name; the Owner settles it"],
        },
      },
    });

    const report = await runMorningRoutine({ date, modules: [], ...morning });

    assert.equal(report.issue.outcome, "created");
  });

  it("raises even a quiet morning the mini could not write down", async () => {
    const morning = syntheticMorning({
      artifacts: {
        writeReport: async () => {
          throw new Error("the state root is read-only");
        },
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.report, null);
    assert.equal(report.issue.outcome, "created");
    assert.match(morning.raised[0]?.body ?? "", /private daily evidence/u);
  });

  it("leaves the report on the mini when the tracker cannot be reached", async () => {
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: {
        list: async () => {
          throw new Error("github is unreachable");
        },
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "unreported");
    assert.equal(report.issue.outcome, "failed");
    assert.equal(report.issue.failure?.message, "github is unreachable");
    assert.equal(morning.rendered.length, 1);
  });
});

it("retained mode never lists or removes expired artifacts and reports requested settings", async () => {
  let touched = false;
  const refuse = async () => {
    touched = true;
    throw new Error("retention forbidden");
  };
  const morning = syntheticMorning({
    artifacts: {
      listSessionDates: refuse,
      listReportDates: refuse,
      removeSession: refuse,
      removeReport: refuse,
    },
  });
  // Override directly: the synthetic store's collection helpers otherwise return fixture arrays.
  morning.artifacts.listSessionDates = refuse;
  morning.artifacts.listReportDates = refuse;
  const run = {
    artifactStateRoot: "/private/synthetic-retained",
    retention: "retained" as const,
    scope: "modules-only" as const,
    requestedModel: "gpt-6.1-sol",
    requestedReasoningEffort: "medium",
    sandbox: "workspace-write" as const,
    modelAttestation: "unverified" as const,
  };
  const report = await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    run,
  });
  assert.equal(touched, false);
  assert.deepEqual(report.purge, { sessions: [], reports: [] });
  assert.deepEqual(report.run, run);
});

const scopedRun = {
  artifactStateRoot: "/private/synthetic-scoped-artifacts",
  retention: "retained" as const,
  scope: "modules-only" as const,
  requestedModel: "gpt-6.1-sol",
  requestedReasoningEffort: "medium",
  sandbox: "workspace-write" as const,
  modelAttestation: "unverified" as const,
};

it("public run summaries allowlist settings and keep private metadata out", async () => {
  const secret = "/private/synthetic-sensitive-metadata";
  const morning = syntheticMorning({ passes: { AB1234: parkedPass } });
  await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    run: {
      ...scopedRun,
      artifactStateRoot: secret,
      requestedModel: secret,
      requestedReasoningEffort: secret,
    },
  });
  assert.doesNotMatch(
    morning.raised[0]?.body ?? "",
    /synthetic-sensitive-metadata/u,
  );
  assert.match(morning.raised[0]?.body ?? "", /Backend identity/u);
});

it("runs repository repair after Modules and records private outcomes before weekly projection", async () => {
  const secret = "/private/synthetic-repair/diagnostics.json";
  const morning = syntheticMorning({});
  const report = await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    repositoryRepair: async () => {
      morning.calls.push("repository:repair");
      return {
        schemaVersion: 1,
        outcome: "blocked",
        pullRequest: 12,
        mergeCommit: "a".repeat(40),
        postmergeVerification: "passed",
        rolloutVerification: "blocked",
        evidence: secret,
        modelAttestation: "unverified",
      };
    },
  });
  assert.ok(
    morning.calls.indexOf("session:EF9012") <
      morning.calls.indexOf("repository:repair"),
  );
  assert.ok(
    morning.calls.indexOf("repository:repair") <
      morning.calls.indexOf("report"),
  );
  assert.equal(report.repositoryRepair?.outcome, "blocked");
  assert.ok(morning.rendered[0]?.includes(secret));
  assert.ok(!morning.raised[0]?.body.includes(secret));
  assert.match(morning.raised[0]?.body ?? "", /PR #12 merged as/u);
  assert.match(morning.raised[0]?.body ?? "", /rollout failed/u);
});

it("repository dispatch failure preserves private daily report and actionable weekly review", async () => {
  const morning = syntheticMorning({});
  const report = await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    repositoryRepair: async () => {
      throw Error("private transport failed");
    },
  });
  assert.equal(report.repositoryRepair?.outcome, "blocked");
  assert.equal(report.outcome, "reported");
  assert.ok(morning.rendered[0]?.includes("repository-repair-unavailable"));
});

it("durable weekly history recovers an earlier merge despite current healthy repair", async () => {
  const morning = syntheticMorning({});
  let week = "";
  await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    repositoryRepair: async () => ({
      schemaVersion: 1,
      outcome: "healthy",
      modelAttestation: "unverified",
    }),
    weeklyRepositoryHistory: async (start) => {
      week = start;
      return {
        merged: [
          {
            pullRequest: 17,
            commit: "b".repeat(40),
            verification: "awaiting",
            rollout: "awaiting",
          },
        ],
        unresolved: 0,
        awaiting: 1,
      };
    },
  });
  assert.equal(week, "2026-08-17");
  assert.match(morning.raised[0]?.body ?? "", /PR #17 merged as/u);
  assert.match(
    morning.raised[0]?.body ?? "",
    /combined-main verification awaiting; rollout awaiting/u,
  );
});

it("missing weekly merge history cannot turn a healthy repair into verified completeness", async () => {
  const morning = syntheticMorning({});
  const report = await runMorningRoutine({
    ...morning,
    date,
    modules: cohort,
    repositoryRepair: async () => ({
      schemaVersion: 1,
      outcome: "healthy",
      modelAttestation: "unverified",
    }),
    weeklyRepositoryHistory: async () => {
      throw Error("history unavailable");
    },
  });
  assert.equal(report.issue.actionable, true);
  assert.match(morning.raised[0]?.body ?? "", /repository work: 1/u);
});
