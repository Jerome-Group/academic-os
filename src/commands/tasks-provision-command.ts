import { loadLocalConfig, resolveTasksConfig } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { OperationalError, resolveTarget } from "../mounted/index.js";
import {
  createFileTaskRegisterStore,
  createGoogleTaskListReader,
  createGoogleTaskListWriter,
  provisionModuleTaskList,
  type TaskProvisionReport,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os tasks provision --config <path> --semester <semester> --module <module> [--apply] [--json]";

export async function runTasksProvisionCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseTasksProvisionArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Task-list provisioning requires the cohort configuration.",
    );
  }
  const tasks = resolveTasksConfig(config);
  const target = resolveConfiguredAuditTarget(
    config,
    parsed.semester,
    parsed.module,
  );
  const { moduleRoot } = await resolveTarget(target);
  const report = await provisionModuleTaskList({
    module: { semester: parsed.semester, module: parsed.module },
    reader: createGoogleTaskListReader(tasks.credentials.scheduledRead),
    writer: createGoogleTaskListWriter(tasks.credentials.interactiveWrite),
    registerStore: createFileTaskRegisterStore(moduleRoot),
    apply: parsed.apply,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
}

function parseTasksProvisionArguments(arguments_: string[]): {
  configPath: string;
  semester: string;
  module: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "provision",
    valueFlags: ["--config", "--semester", "--module"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  if (
    configPath === undefined ||
    semester === undefined ||
    module === undefined
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, semester, module, apply: flags.has("--apply") };
}

function renderHuman(report: TaskProvisionReport): string {
  return [
    `Tasks provision: ${report.outcome}`,
    `${report.module.module} (${report.module.semester}): ${report.list.action.replace("-", " ")}`,
    `Register: ${report.register.replace("-", " ")}`,
  ].join("\n");
}
