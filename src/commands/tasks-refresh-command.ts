import type { AcademicConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  activeResearchProjectTaskTargets,
  cohortTaskTargets,
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
  createGoogleTaskRefreshReader,
  refreshTaskRegisters,
  refreshTaskTargets,
  type TaskRefreshModuleReport,
  type TaskRefreshResearchProjectReport,
  type TaskRefreshReport,
  type TaskRefreshTarget,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";
import { renderTaskCounts } from "./render-task-counts.js";

const usage =
  "Usage: academic-os tasks refresh --config <path> [--semester <semester> --module <module> | --research-project <key>] [--json]";

export async function runTasksRefreshCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseTasksRefreshArguments(arguments_);
  const { config, tasks } = await loadCohortTasksConfig(parsed.configPath);
  const reader = createGoogleTaskRefreshReader(tasks.credentials.scheduledRead);
  const selected = refreshTargets(config, parsed);
  const moduleReport = await refreshTaskRegisters({
    targets: selected.modules,
    reader,
  });
  const researchProjects = (
    await refreshTaskTargets({ targets: selected.researchProjects, reader })
  ).map(researchProjectReport);
  const report: TaskRefreshReport = {
    ...moduleReport,
    outcome: combinedOutcome(moduleReport.modules, researchProjects),
    ...(selected.includeResearchProjects ? { researchProjects } : {}),
  };
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome !== "refreshed") process.exitCode = 2;
}

function refreshTargets(
  config: AcademicConfig,
  parsed: {
    semester?: string;
    module?: string;
    researchProject?: string;
  },
): {
  modules: TaskRefreshTarget[];
  researchProjects: ReturnType<typeof activeResearchProjectTaskTargets>;
  includeResearchProjects: boolean;
} {
  if (parsed.researchProject !== undefined) {
    return {
      modules: [],
      researchProjects: [
        configuredResearchProjectTaskTarget(config, parsed.researchProject, {
          requireActive: true,
        }),
      ],
      includeResearchProjects: true,
    };
  }
  if (parsed.semester === undefined || parsed.module === undefined) {
    const researchProjects = activeResearchProjectTaskTargets(config);
    return {
      modules: cohortTaskTargets(config),
      researchProjects,
      includeResearchProjects: researchProjects.length > 0,
    };
  }
  return {
    modules: [
      configuredTaskTarget(config, {
        semester: parsed.semester,
        module: parsed.module,
      }),
    ],
    researchProjects: [],
    includeResearchProjects: false,
  };
}

function parseTasksRefreshArguments(arguments_: string[]): {
  configPath: string;
  semester?: string;
  module?: string;
  researchProject?: string;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "refresh",
    valueFlags: ["--config", "--semester", "--module", "--research-project"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  const researchProject = values.get("--research-project");
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined) ||
    (researchProject !== undefined &&
      (semester !== undefined || module !== undefined))
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    ...(semester === undefined ? {} : { semester }),
    ...(module === undefined ? {} : { module }),
    ...(researchProject === undefined ? {} : { researchProject }),
  };
}

function renderHuman(report: TaskRefreshReport): string {
  return [
    `Tasks refresh: ${report.outcome}`,
    ...report.modules.map(renderModule),
    ...(report.researchProjects ?? []).map(renderResearchProject),
  ].join("\n");
}

function researchProjectReport(
  report: Awaited<ReturnType<typeof refreshTaskTargets>>[number],
): TaskRefreshResearchProjectReport {
  const { target, failure, ...result } = report;
  return {
    researchProject: target.key,
    ...result,
    ...(failure === undefined ? {} : { failure }),
  };
}

function combinedOutcome(
  modules: readonly TaskRefreshModuleReport[],
  researchProjects: readonly TaskRefreshResearchProjectReport[],
): TaskRefreshReport["outcome"] {
  const reports = [...modules, ...researchProjects];
  const stale = reports.filter(({ freshness }) => freshness === "stale").length;
  return stale === 0
    ? "refreshed"
    : stale === reports.length
      ? "stale"
      : "partially-refreshed";
}

function renderResearchProject(
  project: TaskRefreshResearchProjectReport,
): string {
  const { changes } = project;
  return [
    `${project.researchProject} (research project): ${renderTaskCounts(project.counts)}`,
    `${project.freshness}; ${changes.added} added, ${changes.updated} updated, ${changes.cancelled} newly cancelled`,
    ...(project.failure === undefined
      ? []
      : [`${project.failure.code}: ${project.failure.message}`]),
  ].join("; ");
}

function renderModule(module: TaskRefreshModuleReport): string {
  const { changes } = module;
  return [
    `${module.module} (${module.semester}): ${renderTaskCounts(module.counts)}`,
    `${module.freshness}; ${changes.added} added, ${changes.updated} updated, ${changes.cancelled} newly cancelled`,
    ...(module.failure === undefined
      ? []
      : [`${module.failure.code}: ${module.failure.message}`]),
  ].join("; ");
}
