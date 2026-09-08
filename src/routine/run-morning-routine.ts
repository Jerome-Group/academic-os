import type { ConfiguredModule } from "../config/index.js";
import { planRetentionPurge } from "./plan-retention-purge.js";
import { isQuietMaintenanceCoverage } from "./maintenance-domains.js";
import { renderMorningReport } from "./render-morning-report.js";
import { failedModulePass, routineFailure } from "./routine-failure.js";
import type {
  ModulePassReport,
  ModuleSessionPort,
  MorningIssue,
  MorningIssuePort,
  MorningIssueReport,
  MorningPreludePort,
  MorningRoutineReport,
  PreludeStepName,
  PreludeStepReport,
  RetentionPurge,
  RoutineArtifactStore,
} from "./types.js";
import { isCalendarDay } from "./offering-calendar-day.js";

export const MORNING_ISSUE_LABELS = ["ready-for-human", "decision"] as const;
export const MORNING_ISSUE_MARKER_VERSION = 1;

function morningIssueTitle(date: string): string {
  return `Morning report ${date}`;
}

// One firing, in the one order that matters: the deterministic prelude, then a session per cohort
// module in sequence, then the purge, then the report. Nothing between the steps can end the run —
// a step that throws becomes a line the Owner reads, so one bad module never costs the cohort.
export async function runMorningRoutine(input: {
  date: string;
  cohort: string;
  modules: readonly ConfiguredModule[];
  prelude: MorningPreludePort;
  session: ModuleSessionPort;
  artifacts: RoutineArtifactStore;
  issue: MorningIssuePort;
}): Promise<MorningRoutineReport> {
  const prelude = [
    await preludeStep("import-status", () => input.prelude.inspectImports()),
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
  const issue = await reconcileMorningIssue({
    issue: input.issue,
    date: input.date,
    cohort: input.cohort,
    moduleCodes: modules.map(({ module }) => module),
    body: text,
    needsOwner: report === null || morningNeedsOwner(prelude, modules),
  });
  return {
    schemaVersion: 2,
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
    } catch {}
  }
  return purged;
}

// A park is a question and a failure is work that did not happen. Completed maintenance and
// document updates remain in the local report; they do not make more work for the Owner.
function morningNeedsOwner(
  prelude: readonly PreludeStepReport[],
  modules: readonly ModulePassReport[],
): boolean {
  return (
    prelude.some((step) => step.parked > 0 || step.failure !== undefined) ||
    modules.some(
      (module) =>
        !isQuietMaintenanceCoverage(module.maintenance) ||
        module.parked.length > 0 ||
        module.failures.length > 0,
    )
  );
}

async function reconcileMorningIssue(input: {
  issue: MorningIssuePort;
  date: string;
  cohort: string;
  moduleCodes: readonly string[];
  body: string;
  needsOwner: boolean;
}): Promise<MorningIssueReport> {
  const title = morningIssueTitle(input.date);
  const marker = morningIssueMarker(input.cohort, input.moduleCodes);
  const body = `${marker}\n\n${input.body}`;
  const reconciled: number[] = [];
  try {
    const managed = [
      ...new Map(
        (await input.issue.list())
          .filter((candidate) =>
            isManagedMorningIssue(candidate, marker, input.date),
          )
          .map((candidate) => [candidate.number, candidate]),
      ).values(),
    ];
    if (!input.needsOwner) {
      const open = managed.filter(({ state }) => state === "OPEN");
      for (const candidate of open) {
        const resolutionMarker = `<!-- academic-os-morning-resolution:v1 date=${input.date} -->`;
        if (!candidate.body.includes(resolutionMarker)) {
          await input.issue.update({
            number: candidate.number,
            body: `${candidate.body}\n\n---\n\n${resolutionMarker}\nAutomatically resolved by verified morning ${input.date}.\n\n${input.body}`,
          });
        }
        await input.issue.close(candidate.number);
        reconciled.push(candidate.number);
      }
      return open.length === 0
        ? { outcome: "not-needed", number: null }
        : {
            outcome: "closed",
            number: reconciled[0] ?? null,
            numbers: reconciled,
          };
    }
    const existing = managed.find((candidate) => candidate.title === title);
    if (existing !== undefined) {
      await input.issue.update({ number: existing.number, body });
      if (existing.state === "CLOSED") {
        await input.issue.reopen(existing.number);
        return { outcome: "reopened", number: existing.number };
      }
      return { outcome: "updated", number: existing.number };
    }
    return {
      outcome: "created",
      number: await input.issue.raise({
        title,
        body,
        labels: MORNING_ISSUE_LABELS,
      }),
    };
  } catch (error) {
    return {
      outcome: "failed",
      number: reconciled[0] ?? null,
      ...(reconciled.length === 0 ? {} : { numbers: reconciled }),
      failure: routineFailure(error, "issue-failed"),
    };
  }
}

export function morningIssueMarker(
  cohort: string,
  moduleCodes: readonly string[],
): string {
  const modules = [...new Set(moduleCodes)].sort().join(",");
  return `<!-- academic-os-morning-issue:v${MORNING_ISSUE_MARKER_VERSION} cohort=${encodeURIComponent(cohort)} modules=${encodeURIComponent(modules)} -->`;
}

function isManagedMorningIssue(
  issue: MorningIssue,
  marker: string,
  currentDate: string,
): boolean {
  const issueDate = /^Morning report (.+)$/u.exec(issue.title)?.[1];
  return (
    issueDate !== undefined &&
    isCalendarDay(issueDate) &&
    issueDate <= currentDate &&
    issue.body.startsWith(`${marker}\n`)
  );
}

function morningOutcome(
  issue: MorningIssueReport,
): MorningRoutineReport["outcome"] {
  if (issue.outcome === "not-needed" || issue.outcome === "closed") {
    return "quiet";
  }
  return issue.outcome === "failed" ? "unreported" : "reported";
}
