import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConfiguredModule } from "../../src/config/index.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";
import {
  MORNING_ISSUE_LABELS,
  type ModulePassOutcome,
  type ModulePassReport,
  type MorningIssuePort,
  morningIssueMarker,
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
  const issue: MorningIssuePort = {
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
    assert.match(morning.raised[0]?.body ?? "", /unread announcements/u);
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
    assert.equal(report.issue.outcome, "not-needed");
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
    assert.deepEqual(report.issue, { outcome: "created", number: 900 });
    assert.equal(morning.raised.length, 1);
    assert.equal(morning.raised[0]?.title, "Morning report 2026-08-23");
    assert.deepEqual(morning.raised[0]?.labels, MORNING_ISSUE_LABELS);
    assert.ok(
      morning.raised[0]?.body.startsWith(
        morningIssueMarker(
          "Y2S1",
          cohort.map(({ module }) => module),
        ),
      ),
    );
    assert.ok(morning.raised[0]?.body.endsWith(morning.rendered[0] ?? ""));
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
    assert.deepEqual(report.issue, { outcome: "not-needed", number: null });
    assert.equal(morning.raised.length, 0);
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
    assert.deepEqual(report.issue, { outcome: "created", number: 900 });
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

    assert.equal(docWrite.issue.outcome, "not-needed");
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

  it("updates the same managed morning issue rather than raising a second", async () => {
    const marker = morningIssueMarker(
      "Y2S1",
      cohort.map(({ module }) => module),
    );
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: {
        list: async () => [
          {
            number: 42,
            title: "Morning report 2026-08-23",
            body: `${marker}\n\nold report`,
            state: "OPEN",
          },
        ],
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(report.issue, { outcome: "updated", number: 42 });
    assert.equal(morning.calls.includes("issue:raise"), false);
    assert.deepEqual(
      morning.updated.map(({ number }) => number),
      [42],
    );
  });

  it("updates and reopens a closed same-day managed issue", async () => {
    const marker = morningIssueMarker(
      "Y2S1",
      cohort.map(({ module }) => module),
    );
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: {
        list: async () => [
          {
            number: 43,
            title: "Morning report 2026-08-23",
            body: `${marker}\n\nold report`,
            state: "CLOSED",
          },
        ],
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(report.issue, { outcome: "reopened", number: 43 });
    assert.deepEqual(
      morning.updated.map(({ number }) => number),
      [43],
    );
    assert.deepEqual(morning.reopened, [43]);
    assert.equal(morning.raised.length, 0);
  });

  it("leaves a legacy same-title issue untouched and creates a managed issue", async () => {
    const morning = syntheticMorning({
      passes: { CD5678: parkedPass },
      issue: {
        list: async () => [
          {
            number: 39,
            title: "Morning report 2026-08-23",
            body: "legacy report without marker",
            state: "OPEN",
          },
        ],
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.deepEqual(report.issue, { outcome: "created", number: 900 });
    assert.equal(morning.updated.length, 0);
    assert.equal(morning.reopened.length, 0);
    assert.equal(morning.raised.length, 1);
  });

  it("closes only open managed issues for the exact rechecked cohort and Module set", async () => {
    const marker = morningIssueMarker(
      "Y2S1",
      cohort.map(({ module }) => module),
    );
    const otherModules = morningIssueMarker("Y2S1", ["AB1234"]);
    const otherCohort = morningIssueMarker(
      "Y1S2",
      cohort.map(({ module }) => module),
    );
    const morning = syntheticMorning({
      issue: {
        list: async () => [
          {
            number: 40,
            title: "Morning report 2026-08-22",
            body: `${marker}\n\nunresolved`,
            state: "OPEN",
          },
          {
            number: 41,
            title: "Morning report 2026-08-21",
            body: `${marker}\n\nalready resolved`,
            state: "CLOSED",
          },
          {
            number: 42,
            title: "Morning report 2026-08-22",
            body: "legacy report without marker",
            state: "OPEN",
          },
          {
            number: 43,
            title: "Morning report 2026-08-22",
            body: `${otherModules}\n\ndifferent Module set`,
            state: "OPEN",
          },
          {
            number: 44,
            title: "Morning report 2026-08-22",
            body: `${otherCohort}\n\ndifferent cohort`,
            state: "OPEN",
          },
          {
            number: 45,
            title: "Manual follow-up",
            body: `${marker}\n\nmanual issue`,
            state: "OPEN",
          },
          {
            number: 46,
            title: "Morning report 2026-08-24",
            body: `${marker}\n\nfuture report`,
            state: "OPEN",
          },
          {
            number: 47,
            title: "Morning report 2026-02-31",
            body: `${marker}\n\ninvalid date`,
            state: "OPEN",
          },
          {
            number: 48,
            title: "Morning report 2026-08-20",
            body: `${marker}\n\nsecond unresolved report`,
            state: "OPEN",
          },
        ],
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "quiet");
    assert.deepEqual(report.issue, {
      outcome: "closed",
      number: 40,
      numbers: [40, 48],
    });
    assert.deepEqual(morning.closed, [40, 48]);
    assert.deepEqual(
      morning.updated.map(({ number }) => number),
      [40, 48],
    );
    assert.ok(morning.updated[0]?.body.startsWith(`${marker}\n\nunresolved`));
    assert.match(
      morning.updated[0]?.body ?? "",
      /Automatically resolved by verified morning 2026-08-23/u,
    );
    assert.ok(morning.updated[0]?.body.endsWith(morning.rendered[0] ?? ""));
    assert.ok(
      morning.calls.indexOf("issue:update") <
        morning.calls.indexOf("issue:close"),
    );
  });

  it("reports completed closures when a later managed close fails", async () => {
    const marker = morningIssueMarker(
      "Y2S1",
      cohort.map(({ module }) => module),
    );
    const morning = syntheticMorning({
      issue: {
        list: async () =>
          [40, 41].map((number) => ({
            number,
            title: `Morning report 2026-08-${number === 40 ? "21" : "22"}`,
            body: `${marker}\n\nunresolved ${number}`,
            state: "OPEN" as const,
          })),
        close: async (number) => {
          if (number === 41) throw new Error("close failed");
        },
      },
    });

    const report = await runMorningRoutine({
      date,
      modules: cohort,
      ...morning,
    });

    assert.equal(report.outcome, "unreported");
    assert.deepEqual(report.issue.numbers, [40]);
    assert.equal(report.issue.number, 40);
    assert.equal(report.issue.failure?.message, "close failed");
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
    assert.ok(morning.raised[0]?.body.endsWith(morning.rendered[0] ?? ""));
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
