import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AcademicConfig,
  loadLocalConfig,
  resolveRoutineConfig,
  resolveStateRoot,
} from "../config/index.js";
import { planCohortAudit } from "../cohort/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createCodexModuleSession,
  createCohortPrelude,
  createFileRoutineArtifactStore,
  createRetainedRoutineRoot,
  validateMorningSessionOverride,
  MORNING_SESSION_MODEL,
  MORNING_SESSION_REASONING_EFFORT,
  type MorningSessionSettings,
  createGhMorningIssue,
  type MorningRoutineReport,
  type MorningRunEvidence,
  offeringCalendarDay,
  type PreludeStepReport,
  runMorningRoutine,
} from "../routine/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { renderModulePassSummary } from "./render-module-pass-summary.js";
import { createFileWeeklyEvidenceStore } from "../routine/file-weekly-evidence.js";
import { runRepositoryRepair } from "../routine/repository-repair.js";
import { createGhWeeklyRepositoryHistory } from "../routine/gh-weekly-repository-history.js";

const usage =
  "Usage: academic-os routine morning --config <path> [--retain-artifacts] [--modules-only] [--model gpt-6.1-sol --reasoning-effort <effort>] [--json]";

export async function runRoutineMorningCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const options = parseOptions(arguments_);
  const config = await loadCohortConfig(options.configPath);
  const routine = resolveRoutineConfig(config);
  const modules = planCohortAudit(config).selection.included;
  const stateRoot = await resolveStateRoot(config);
  const artifactStateRoot = options.retainArtifacts
    ? await createRetainedRoutineRoot(stateRoot)
    : stateRoot;
  const date = offeringCalendarDay(new Date());
  const run: MorningRunEvidence = {
    artifactStateRoot,
    retention: options.retainArtifacts ? "retained" : "ordinary",
    scope: options.modulesOnly ? "modules-only" : "monitoring-cohort",
    requestedModel: options.sessionSettings?.model ?? MORNING_SESSION_MODEL,
    requestedReasoningEffort:
      options.sessionSettings?.reasoningEffort ??
      MORNING_SESSION_REASONING_EFFORT,
    sandbox: "workspace-write",
    modelAttestation: "unverified",
  };
  if (options.retainArtifacts)
    await writeFile(
      join(artifactStateRoot, "run.json"),
      `${JSON.stringify({ schemaVersion: 1, date, modules, run }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  const report = await runMorningRoutine({
    date,
    cohort: config.activeSemester,
    modules,
    prelude: createCohortPrelude(config, { modulesOnly: options.modulesOnly }),
    session: createCodexModuleSession({
      config,
      codexPath: routine.codexPath,
      date,
      artifactStateRoot,
      ...(options.sessionSettings === undefined
        ? {}
        : { sessionSettings: options.sessionSettings }),
    }),
    artifacts: createFileRoutineArtifactStore(artifactStateRoot, {
      exclusiveReports: options.retainArtifacts,
    }),
    run,
    issue: createGhMorningIssue(routine.ghPath),
    weeklyEvidence: createFileWeeklyEvidenceStore(stateRoot),
    weeklyRepositoryHistory: createGhWeeklyRepositoryHistory(routine.ghPath),
    ...(options.modulesOnly
      ? {}
      : {
          repositoryRepair: () =>
            runRepositoryRepair({
              repositoryRoot: fileURLToPath(
                new URL("../../../", import.meta.url),
              ),
              privateStateRoot: stateRoot,
              codexPath: routine.codexPath,
              ghPath: routine.ghPath,
            }),
        }),
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

function parseOptions(arguments_: string[]): {
  configPath: string;
  retainArtifacts: boolean;
  modulesOnly: boolean;
  sessionSettings?: MorningSessionSettings;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "morning",
    valueFlags: ["--config", "--model", "--reasoning-effort"],
    booleanFlags: ["--json", "--retain-artifacts", "--modules-only"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  const model = values.get("--model");
  const reasoningEffort = values.get("--reasoning-effort");
  if ((model === undefined) !== (reasoningEffort === undefined))
    throw new OperationalError(
      "invalid-arguments",
      "--model and --reasoning-effort must be supplied together.",
    );
  const sessionSettings =
    model === undefined || reasoningEffort === undefined
      ? undefined
      : validateMorningSessionOverride({ model, reasoningEffort });
  return {
    configPath,
    retainArtifacts: flags.has("--retain-artifacts"),
    modulesOnly: flags.has("--modules-only"),
    ...(sessionSettings === undefined ? {} : { sessionSettings }),
  };
}

function renderHuman(report: MorningRoutineReport): string {
  return [
    `Morning routine ${report.date}: ${report.outcome}`,
    ...report.prelude.map(renderPreludeStep),
    ...report.modules.map(renderModulePassSummary),
    report.run?.retention === "retained"
      ? "Artifacts retained; ordinary retention purge skipped."
      : `Purged ${report.purge.sessions.length} session days and ${report.purge.reports.length} reports`,
    `Report: ${report.report ?? "not written"}`,
    `Issue: ${report.issue.outcome}${
      report.issue.numbers !== undefined
        ? ` (#${report.issue.numbers.join(", #")})`
        : report.issue.number === null
          ? ""
          : ` (#${report.issue.number})`
    }`,
  ].join("\n");
}

function renderPreludeStep(step: PreludeStepReport): string {
  return `${step.step}: ${step.outcome}; ${step.parked} parked${
    step.failure === undefined ? "" : `; ${step.failure.code}`
  }`;
}
