import {
  type AcademicConfig,
  loadLocalConfig,
  resolveRoutineConfig,
} from "../config/index.js";
import { planCohortAudit } from "../cohort/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createCodexModuleSession,
  createCohortPrelude,
  createFileRoutineArtifactStore,
  createGhMorningIssue,
  type ModulePassReport,
  type MorningRoutineReport,
  offeringCalendarDay,
  type PreludeStepReport,
  runMorningRoutine,
} from "../routine/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage = "Usage: academic-os routine morning --config <path> [--json]";

export async function runRoutineMorningCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const config = await loadCohortConfig(parseConfigPath(arguments_));
  const routine = resolveRoutineConfig(config);
  const date = offeringCalendarDay(new Date());
  const report = await runMorningRoutine({
    date,
    modules: planCohortAudit(config).selection.included,
    prelude: createCohortPrelude(config),
    session: createCodexModuleSession({
      config,
      codexPath: routine.codexPath,
      date,
    }),
    artifacts: createFileRoutineArtifactStore(config.stateRoot),
    issue: createGhMorningIssue(routine.ghPath),
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome === "unreported") process.exitCode = 2;
}

async function loadCohortConfig(configPath: string): Promise<AcademicConfig> {
  const config = await loadLocalConfig(configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "The morning routine requires the cohort configuration.",
    );
  }
  return config;
}

function parseConfigPath(arguments_: string[]): string {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "morning",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return configPath;
}

function renderHuman(report: MorningRoutineReport): string {
  return [
    `Morning routine ${report.date}: ${report.outcome}`,
    ...report.prelude.map(renderPreludeStep),
    ...report.modules.map(renderModule),
    `Purged ${report.purge.sessions.length} session days and ${report.purge.reports.length} reports`,
    `Report: ${report.report}`,
    `Issue: ${report.issue.outcome}${report.issue.number === null ? "" : ` (#${report.issue.number})`}`,
  ].join("\n");
}

function renderPreludeStep(step: PreludeStepReport): string {
  return `${step.step}: ${step.outcome}; ${step.parked} parked${
    step.failure === undefined ? "" : `; ${step.failure.code}`
  }`;
}

function renderModule(module: ModulePassReport): string {
  return `${module.module} (${module.semester}): ${module.curated.length} curated, ${module.rederived.length} rederived, ${module.superseded.length} superseded, ${module.parked.length} parked, ${module.docWrites.length} doc writes, ${module.failures.length} failures`;
}
