import {
  planCohortAudit,
  resolveConfiguredAuditTarget,
} from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  createDeferredTaskRegisterStore,
  createGoogleTaskRefreshReader,
  refreshTaskRegisters,
  type TaskRefreshModuleReport,
  type TaskRefreshReport,
  type TaskRefreshTarget,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";
import { quantity } from "./quantity.js";

const usage =
  "Usage: academic-os tasks refresh --config <path> [--semester <semester> --module <module>] [--json]";

export async function runTasksRefreshCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseTasksRefreshArguments(arguments_);
  const { config, tasks } = await loadCohortTasksConfig(parsed.configPath);
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
      registerStore: createDeferredTaskRegisterStore(target),
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
      registerStore: createDeferredTaskRegisterStore(target),
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
