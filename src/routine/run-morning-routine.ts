import type { ConfiguredModule } from "../config/index.js";
import { isQuietMaintenanceCoverage } from "./maintenance-domains.js";
import { planRetentionPurge } from "./plan-retention-purge.js";
import { renderMorningReport } from "./render-morning-report.js";
import type { RepositoryRepairReport } from "./repository-repair-types.js";
import { failedModulePass, routineFailure } from "./routine-failure.js";
import type {
  ModulePassReport,
  ModuleSessionPort,
  MorningIssuePort,
  MorningIssueReport,
  MorningPreludePort,
  MorningRoutineReport,
  MorningRunEvidence,
  PreludeStepName,
  PreludeStepReport,
  RetentionPurge,
  RoutineArtifactStore,
  WeeklyIssueEvidenceStore,
  WeeklyRepositorySummary,
} from "./types.js";
import { offeringWeekStart, reconcileWeeklyIssue } from "./weekly-review.js";

export const MORNING_ISSUE_LABELS = ["ready-for-human", "decision"] as const;
export const MORNING_ISSUE_MARKER_VERSION = 1;

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
  weeklyEvidence?: WeeklyIssueEvidenceStore;
  weeklyRepository?: WeeklyRepositorySummary;
  repositoryRepair?: () => Promise<RepositoryRepairReport>;
  weeklyRepositoryHistory?: (
    weekStart: string,
  ) => Promise<WeeklyRepositorySummary>;
  run?: MorningRunEvidence;
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
  const repositoryRepair = await runRepositoryRepair(input.repositoryRepair);
  let repository =
    input.weeklyRepository ??
    (repositoryRepair === undefined
      ? undefined
      : weeklyRepairSummary(repositoryRepair));
  if (input.weeklyRepositoryHistory !== undefined) {
    try {
      const history = await input.weeklyRepositoryHistory(
        offeringWeekStart(input.date),
      );
      const merged = new Map(
        history.merged.map((fix) => [`${fix.pullRequest}:${fix.commit}`, fix]),
      );
      for (const fix of repository?.merged ?? [])
        merged.set(`${fix.pullRequest}:${fix.commit}`, fix);
      repository = {
        pendingIssueNumbers: [
          ...new Set([
            ...(history.pendingIssueNumbers ?? []),
            ...(repository?.pendingIssueNumbers ?? []),
          ]),
        ],
        pendingPullRequestNumbers: [
          ...new Set([
            ...(history.pendingPullRequestNumbers ?? []),
            ...(repository?.pendingPullRequestNumbers ?? []),
          ]),
        ],
        merged: [...merged.values()],
        unresolved: Math.max(history.unresolved, repository?.unresolved ?? 0),
        awaiting: Math.max(history.awaiting, repository?.awaiting ?? 0),
      };
    } catch {
      repository = {
        pendingIssueNumbers: repository?.pendingIssueNumbers ?? [],
        pendingPullRequestNumbers: repository?.pendingPullRequestNumbers ?? [],
        merged: repository?.merged ?? [],
        unresolved: Math.max(1, repository?.unresolved ?? 0),
        awaiting: Math.max(1, repository?.awaiting ?? 0),
      };
    }
  }
  const purge =
    input.run?.retention === "retained"
      ? { sessions: [], reports: [] }
      : await purgeExpiredArtifacts(input.artifacts, input.date);
  const text = renderMorningReport({
    date: input.date,
    prelude,
    modules,
    purge,
    ...(repositoryRepair === undefined ? {} : { repositoryRepair }),
  });
  const report = await writtenReport(input.artifacts, input.date, text);
  const issue = await reconcileWeeklyIssue({
    ...(input.weeklyEvidence === undefined
      ? {}
      : { evidence: input.weeklyEvidence }),
    issue: input.issue,
    date: input.date,
    cohort: input.cohort,
    moduleCodes: modules.map(({ module }) => module),
    ...(repository === undefined ? {} : { repository }),
    summary: {
      targets: modules.length,
      preludePending: prelude.filter(
        (step) =>
          step.parked > 0 ||
          step.failure !== undefined ||
          step.outcome === "skipped",
      ).length,
      parked: modules.reduce((n, module) => n + module.parked.length, 0),
      failures: modules.reduce((n, module) => n + module.failures.length, 0),
      verifiedMaintenance: modules.reduce(
        (n, module) =>
          n +
          module.maintenance.filter((entry) => entry.status === "maintained")
            .length,
        0,
      ),
      checkedMaintenance: modules.reduce(
        (n, module) =>
          n +
          module.maintenance.filter((entry) => entry.status === "checked")
            .length,
        0,
      ),
      verifiedControlWrites: modules.reduce(
        (n, module) => n + module.docWrites.length,
        0,
      ),
      awaitingMaintenance: modules.reduce(
        (n, module) =>
          n +
          module.maintenance.filter(
            (entry) =>
              entry.status !== "checked" &&
              entry.status !== "maintained" &&
              entry.status !== "not-applicable",
          ).length,
        0,
      ),
    },
    scope: input.run?.scope ?? "monitoring-cohort",
    needsOwner:
      report === null ||
      morningNeedsOwner(prelude, modules) ||
      (input.run?.scope !== "modules-only" &&
        prelude.some(({ outcome }) => outcome === "skipped")),
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
    ...(repositoryRepair === undefined ? {} : { repositoryRepair }),
    ...(input.run === undefined ? {} : { run: input.run }),
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

export function morningIssueMarker(
  cohort: string,
  moduleCodes: readonly string[],
  scope: MorningRunEvidence["scope"] = "monitoring-cohort",
): string {
  const modules = [...new Set(moduleCodes)].sort().join(",");
  return `<!-- academic-os-morning-issue:v${MORNING_ISSUE_MARKER_VERSION} cohort=${encodeURIComponent(cohort)} modules=${encodeURIComponent(modules)}${scope === "modules-only" ? " scope=modules-only" : ""} -->`;
}

function morningOutcome(
  issue: MorningIssueReport,
): MorningRoutineReport["outcome"] {
  if (issue.outcome !== "failed" && issue.actionable === false) {
    return "quiet";
  }
  return issue.outcome === "failed" ? "unreported" : "reported";
}

async function runRepositoryRepair(
  run: (() => Promise<RepositoryRepairReport>) | undefined,
): Promise<RepositoryRepairReport | undefined> {
  if (run === undefined) return undefined;
  try {
    return await run();
  } catch {
    return {
      schemaVersion: 1,
      outcome: "blocked",
      code: "repository-repair-unavailable",
      modelAttestation: "unverified",
    };
  }
}
export function weeklyRepairSummary(
  report: RepositoryRepairReport,
): WeeklyRepositorySummary {
  const merged: WeeklyRepositorySummary["merged"] = [];
  if (
    Number.isSafeInteger(report.pullRequest) &&
    (report.pullRequest ?? 0) > 0 &&
    report.mergeCommit !== undefined &&
    /^[a-f0-9]{40}$/u.test(report.mergeCommit)
  ) {
    merged.push({
      pullRequest: report.pullRequest as number,
      ...(Number.isSafeInteger(report.issue) && (report.issue ?? 0) > 0
        ? { originIssue: report.issue as number }
        : {}),
      commit: report.mergeCommit,
      verification:
        report.postmergeVerification === "passed"
          ? "verified"
          : report.postmergeVerification === "blocked"
            ? "failed"
            : "awaiting",
      rollout:
        report.rolloutVerification === "passed"
          ? "verified"
          : report.rolloutVerification === "blocked"
            ? "failed"
            : "awaiting",
    });
  }
  const pending =
    report.outcome !== "healthy" &&
    (report.outcome !== "merged" ||
      report.postmergeVerification !== "passed" ||
      report.rolloutVerification !== "passed");
  return {
    pendingIssueNumbers:
      pending && Number.isSafeInteger(report.issue) && (report.issue ?? 0) > 0
        ? [report.issue as number]
        : [],
    pendingPullRequestNumbers:
      pending &&
      Number.isSafeInteger(report.pullRequest) &&
      (report.pullRequest ?? 0) > 0
        ? [report.pullRequest as number]
        : [],
    merged,
    unresolved:
      report.outcome === "blocked" || report.outcome === "unchanged" ? 1 : 0,
    awaiting:
      report.outcome === "busy" ||
      (report.outcome === "merged" &&
        (merged.length === 0 ||
          merged.some(
            (fix) =>
              fix.verification !== "verified" || fix.rollout !== "verified",
          )))
        ? 1
        : 0,
  };
}
