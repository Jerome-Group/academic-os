import type { ConfiguredModule } from "../config/index.js";
import { planRetentionPurge } from "./plan-retention-purge.js";
import { renderMorningReport } from "./render-morning-report.js";
import { failedModulePass, routineFailure } from "./routine-failure.js";
import type {
  ModulePassReport,
  ModuleSessionPort,
  MorningIssuePort,
  MorningIssueReport,
  MorningPreludePort,
  MorningRoutineReport,
  PreludeStepName,
  PreludeStepReport,
  RetentionPurge,
  RoutineArtifactStore,
} from "./types.js";

export const MORNING_ISSUE_LABELS = ["ready-for-human", "decision"] as const;

function morningIssueTitle(date: string): string {
  return `Morning report ${date}`;
}

// One firing, in the one order that matters: the deterministic prelude, then a session per cohort
// module in sequence, then the purge, then the report. Nothing between the steps can end the run —
// a step that throws becomes a line the Owner reads, so one bad module never costs the cohort.
export async function runMorningRoutine(input: {
  date: string;
  modules: readonly ConfiguredModule[];
  prelude: MorningPreludePort;
  session: ModuleSessionPort;
  artifacts: RoutineArtifactStore;
  issue: MorningIssuePort;
}): Promise<MorningRoutineReport> {
  const prelude = [
    await preludeStep("textbook-shelf-catch-up", () =>
      input.prelude.catchUpShelf(),
    ),
    await preludeStep("task-register-pull", () =>
      input.prelude.pullTaskRegisters(),
    ),
  ];
  const modules: ModulePassReport[] = [];
  for (const module of input.modules) {
    modules.push(await modulePass(input.session, module));
  }
  const purge = await purgeExpiredArtifacts(input.artifacts, input.date);
  const text = renderMorningReport({
    date: input.date,
    prelude,
    modules,
    purge,
  });
  const report = await writtenReport(input.artifacts, input.date, text);
  const issue =
    report === null || morningNeedsOwner(prelude, modules)
      ? await raiseMorningIssue(input.issue, input.date, text)
      : { outcome: "not-needed" as const, number: null };
  return {
    schemaVersion: 1,
    command: "routine morning",
    outcome: morningOutcome(issue),
    date: input.date,
    prelude,
    modules,
    purge,
    report,
    issue,
  };
}

async function preludeStep(
  step: PreludeStepName,
  run: () => Promise<PreludeStepReport>,
): Promise<PreludeStepReport> {
  try {
    return await run();
  } catch (error) {
    return {
      step,
      outcome: "failed",
      parked: 0,
      detail: [],
      failure: routineFailure(error, "prelude-failed"),
    };
  }
}

async function modulePass(
  session: ModuleSessionPort,
  module: ConfiguredModule,
): Promise<ModulePassReport> {
  try {
    return await session.run(module);
  } catch (error) {
    return {
      ...module,
      artifacts: "none",
      ...failedModulePass(error, "session-failed"),
    };
  }
}

// The mini's copy is the record a quiet morning leaves, so losing it is itself something to raise:
// the text is already in hand, and the issue carries the morning whether or not the disk took it.
async function writtenReport(
  artifacts: RoutineArtifactStore,
  date: string,
  text: string,
): Promise<string | null> {
  try {
    return await artifacts.writeReport({ date, text });
  } catch {
    return null;
  }
}

async function purgeExpiredArtifacts(
  artifacts: RoutineArtifactStore,
  today: string,
): Promise<RetentionPurge> {
  const plan = planRetentionPurge({
    today,
    sessionDates: await listed(() => artifacts.listSessionDates()),
    reportDates: await listed(() => artifacts.listReportDates()),
  });
  return {
    sessions: await removed(plan.sessions, (date) =>
      artifacts.removeSession(date),
    ),
    reports: await removed(plan.reports, (date) =>
      artifacts.removeReport(date),
    ),
  };
}

async function listed(read: () => Promise<string[]>): Promise<string[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

// A removal that fails is left off the summary rather than reported as done; tomorrow's pass sees
// the same expired date and tries again, which is the routine's answer to every transient failure.
async function removed(
  dates: readonly string[],
  remove: (date: string) => Promise<void>,
): Promise<string[]> {
  const purged: string[] = [];
  for (const date of dates) {
    try {
      await remove(date);
      purged.push(date);
    } catch {
      continue;
    }
  }
  return purged;
}

function morningNeedsOwner(
  prelude: readonly PreludeStepReport[],
  modules: readonly ModulePassReport[],
): boolean {
  return (
    prelude.some((step) => step.parked > 0 || step.failure !== undefined) ||
    modules.some(
      (module) =>
        module.parked.length > 0 ||
        module.docWrites.length > 0 ||
        module.failures.length > 0,
    )
  );
}

async function raiseMorningIssue(
  issue: MorningIssuePort,
  date: string,
  body: string,
): Promise<MorningIssueReport> {
  const title = morningIssueTitle(date);
  try {
    const existing = await issue.find(title);
    if (existing !== undefined) {
      return { outcome: "already-raised", number: existing };
    }
    return {
      outcome: "created",
      number: await issue.raise({ title, body, labels: MORNING_ISSUE_LABELS }),
    };
  } catch (error) {
    return {
      outcome: "failed",
      number: null,
      failure: routineFailure(error, "issue-failed"),
    };
  }
}

function morningOutcome(
  issue: MorningIssueReport,
): MorningRoutineReport["outcome"] {
  if (issue.outcome === "not-needed") return "quiet";
  return issue.outcome === "failed" ? "unreported" : "reported";
}
