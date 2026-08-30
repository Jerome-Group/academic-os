import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { OperationalError, resolveTarget } from "../mounted/index.js";
import {
  configuredResearchProjectTaskTarget,
  createFileTaskRegisterStore,
  createGoogleTaskListReader,
  createGoogleTaskListWriter,
  provisionModuleTaskList,
  provisionTaskList,
  type TaskResearchProjectProvisionReport,
  type TaskProvisionReport,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";

const usage =
  "Usage: academic-os tasks provision --config <path> (--semester <semester> --module <module> | --research-project <key>) [--apply] [--json]";

export async function runTasksProvisionCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseTasksProvisionArguments(arguments_);
  const { config, tasks } = await loadCohortTasksConfig(parsed.configPath);
  const report =
    parsed.target.kind === "module"
      ? await provisionModule(config, tasks, parsed.target, parsed.apply)
      : await provisionResearchProject(
          config,
          tasks,
          parsed.target.key,
          parsed.apply,
        );
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
}

function parseTasksProvisionArguments(arguments_: string[]): {
  configPath: string;
  target:
    | { kind: "module"; semester: string; module: string }
    | { kind: "research-project"; key: string };
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "provision",
    valueFlags: ["--config", "--semester", "--module", "--research-project"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  const researchProject = values.get("--research-project");
  if (
    configPath === undefined ||
    (researchProject === undefined &&
      (semester === undefined || module === undefined)) ||
    (researchProject !== undefined &&
      (semester !== undefined || module !== undefined)) ||
    (semester === undefined) !== (module === undefined)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    target:
      researchProject === undefined
        ? {
            kind: "module",
            semester: semester as string,
            module: module as string,
          }
        : { kind: "research-project", key: researchProject },
    apply: flags.has("--apply"),
  };
}

async function provisionModule(
  config: Parameters<typeof resolveConfiguredAuditTarget>[0],
  tasks: Awaited<ReturnType<typeof loadCohortTasksConfig>>["tasks"],
  target: { semester: string; module: string },
  apply: boolean,
): Promise<TaskProvisionReport> {
  const configured = resolveConfiguredAuditTarget(
    config,
    target.semester,
    target.module,
  );
  const { moduleRoot } = await resolveTarget(configured);
  return await provisionModuleTaskList({
    module: { semester: target.semester, module: target.module },
    reader: createGoogleTaskListReader(tasks.credentials.scheduledRead),
    writer: createGoogleTaskListWriter(tasks.credentials.interactiveWrite),
    registerStore: createFileTaskRegisterStore(moduleRoot),
    apply,
  });
}

async function provisionResearchProject(
  config: Parameters<typeof configuredResearchProjectTaskTarget>[0],
  tasks: Awaited<ReturnType<typeof loadCohortTasksConfig>>["tasks"],
  key: string,
  apply: boolean,
): Promise<TaskResearchProjectProvisionReport> {
  const target = configuredResearchProjectTaskTarget(config, key, {
    requireActive: apply,
  });
  const provisioned = await provisionTaskList({
    target: target.identity,
    reader: createGoogleTaskListReader(tasks.credentials.scheduledRead),
    writer: createGoogleTaskListWriter(tasks.credentials.interactiveWrite),
    registerStore: target.registerStore,
    apply,
  });
  return {
    schemaVersion: 1,
    command: "tasks provision",
    outcome: provisioned.outcome,
    researchProject: { key },
    list: provisioned.list,
    register: provisioned.register,
  };
}

function renderHuman(
  report: TaskProvisionReport | TaskResearchProjectProvisionReport,
): string {
  const target =
    "module" in report
      ? `${report.module.module} (${report.module.semester})`
      : `${report.list.title} (research project ${report.researchProject.key})`;
  return [
    `Tasks provision: ${report.outcome}`,
    `${target}: ${report.list.action.replace("-", " ")}`,
    `Register: ${report.register.replace("-", " ")}`,
  ].join("\n");
}
