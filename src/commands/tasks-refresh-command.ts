import {
  planCohortAudit,
  resolveConfiguredAuditTarget,
} from "../cohort/index.js";
import {
  type AcademicConfig,
  loadLocalConfig,
  resolveTasksConfig,
} from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createConfiguredTaskRegisterStore,
  createGoogleTaskRefreshReader,
  refreshTaskRegisters,
  type TaskRefreshModuleReport,
  type TaskRefreshReport,
  type TaskRefreshTarget,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os tasks refresh --config <path> [--semester <semester> --module <module>] [--json]";

export async function runTasksRefreshCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseTasksRefreshArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "A Tasks refresh requires the cohort configuration.",
    );
  }
  const tasks = resolveTasksConfig(config);
  const report = await refreshTaskRegisters({
    targets: refreshTargets(config, parsed),
    reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome !== "refreshed") process.exitCode = 2;
}

function refreshTargets(
  config: AcademicConfig,
  parsed: { semester?: string; module?: string },
): TaskRefreshTarget[] {
  if (parsed.semester === undefined || parsed.module === undefined) {
    return planCohortAudit(config).targets.map((target) => ({
      semester: target.semester,
      module: target.module,
      registerStore: createConfiguredTaskRegisterStore(target),
    }));
  }
  const target = resolveConfiguredAuditTarget(
    config,
    parsed.semester,
    parsed.module,
  );
  return [
    {
      semester: target.semester,
      module: target.module,
      registerStore: createConfiguredTaskRegisterStore(target),
    },
  ];
}

function parseTasksRefreshArguments(arguments_: string[]): {
  configPath: string;
  semester?: string;
  module?: string;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "refresh",
    valueFlags: ["--config", "--semester", "--module"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    ...(semester === undefined ? {} : { semester }),
    ...(module === undefined ? {} : { module }),
  };
}

function renderHuman(report: TaskRefreshReport): string {
  return [
    `Tasks refresh: ${report.outcome}`,
    ...report.modules.map(renderModule),
  ].join("\n");
}

function renderModule(module: TaskRefreshModuleReport): string {
  const { counts, changes } = module;
  return [
    `${module.module} (${module.semester}): ${quantity(counts.tasks, "task")}`,
    `${counts.open} open, ${counts.completed} completed, ${counts.cancelled} cancelled, ${counts.unpushed} unpushed`,
    `${module.freshness}; ${changes.added} added, ${changes.updated} updated, ${changes.cancelled} newly cancelled`,
    ...(module.failure === undefined
      ? []
      : [`${module.failure.code}: ${module.failure.message}`]),
  ].join("; ");
}

function quantity(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
