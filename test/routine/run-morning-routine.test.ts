import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConfiguredModule } from "../../src/config/index.js";
import {
  MORNING_ISSUE_LABELS,
  type ModulePassOutcome,
  type ModulePassReport,
  type MorningIssuePort,
  type MorningPreludePort,
  type PreludeStepReport,
  type RoutineArtifactStore,
  runMorningRoutine,
} from "../../src/routine/index.js";

const date = "2026-08-23";
const cohort: ConfiguredModule[] = [
  { semester: "Y2S1", module: "AB1234" },
  { semester: "Y2S1", module: "CD5678" },
  { semester: "Y2S1", module: "EF9012" },
];

const quietPass: ModulePassOutcome = {
  curated: [],
  rederived: [],
  superseded: [],
  parked: [],
  docWrites: [],
  failures: [],
};

function syntheticMorning(overrides: {
  calls?: string[];
  prelude?: Partial<
    Record<"shelf" | "tasks", PreludeStepReport | (() => never)>
  >;
  passes?: Record<string, ModulePassOutcome | (() => never)>;
  sessionDates?: string[];
  reportDates?: string[];
  issue?: Partial<MorningIssuePort>;
}) {
  const calls = overrides.calls ?? [];
  const written: string[] = [];
  const removed: string[] = [];
  const raised: Array<{
    title: string;
    body: string;
    labels: readonly string[];
  }> = [];
  const prelude: MorningPreludePort = {
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
    writeReport: async ({ date: day, text }) => {
      calls.push("report");
      written.push(text);
      return `/state/routine/reports/${day}.md`;
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
  const issue: MorningIssuePort = {
    find: async (title) => {
      calls.push("issue:find");
      return await (overrides.issue?.find?.(title) ??
        Promise.resolve(undefined));
    },
    raise: async (input) => {
      calls.push("issue:raise");
      if (overrides.issue?.raise !== undefined) {
        return await overrides.issue.raise(input);
      }
      raised.push(input);
      return 900;
    },
  };
  return {
    calls,
    written,
    removed,
    raised,
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
      outcome: "clean",
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

describe("one firing of the morning routine", () => {
  it("runs the prelude, then a session per cohort module in sequence, then reports", async () => {
    const morning = syntheticMorning({});

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(morning.calls, [
      "prelude:shelf",
      "prelude:tasks",
      "session:AB1234",
      "session:CD5678",
      "session:EF9012",
      "report",
    ]);
    assert.deepEqual(
      report.modules.map(({ module }) => module),
      ["AB1234", "CD5678", "EF9012"],
    );
    assert.deepEqual(
      report.prelude.map(({ step: name }) => name),
      ["textbook-shelf-catch-up", "task-register-pull"],
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

    assert.deepEqual(morning.calls.slice(2, 5), [
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

    assert.equal(report.prelude[0]?.outcome, "failed");
    assert.equal(
      report.prelude[0]?.failure?.message,
      "the shelf is unreadable",
    );
    assert.equal(report.prelude[1]?.outcome, "clean");
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
  it("raises one labelled issue carrying the report when something parked", async () => {
    const morning = syntheticMorning({ passes: { CD5678: parkedPass } });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "reported");
    assert.deepEqual(report.issue, { outcome: "created", number: 900 });
    assert.equal(morning.raised.length, 1);
    assert.equal(morning.raised[0]?.title, "Morning report 2026-08-23");
    assert.deepEqual(morning.raised[0]?.labels, MORNING_ISSUE_LABELS);
    assert.equal(morning.raised[0]?.body, morning.written[0]);
  });

  it("stays silent on a quiet morning, and still lands the report", async () => {
    const morning = syntheticMorning({});

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "quiet");
    assert.deepEqual(report.issue, { outcome: "not-needed", number: null });
    assert.equal(morning.raised.length, 0);
    assert.equal(morning.written.length, 1);
  });

  it("raises for a doc write nobody watched, and for a failure", async () => {
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

    assert.equal(docWrite.issue.outcome, "created");
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

  it("finds the morning's issue rather than raising a second", async () => {
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: { find: async () => 42 },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(report.issue, { outcome: "already-raised", number: 42 });
    assert.equal(morning.calls.includes("issue:raise"), false);
  });

  it("leaves the report on the mini when the tracker cannot be reached", async () => {
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: {
        find: async () => {
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
    assert.equal(morning.written.length, 1);
  });
});
