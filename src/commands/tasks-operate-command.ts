import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  applyTaskOperation,
  createDeferredTaskRegisterStore,
  createGoogleTaskRefreshReader,
  createGoogleTaskOperationWriter,
  isDoDate,
  type TaskOperation,
  type TaskOperationName,
  type TaskOperationReport,
  type TaskProvenance,
} from "../tasks/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { loadCohortTasksConfig } from "./load-cohort-tasks-config.js";
import { renderTaskCounts } from "./render-task-counts.js";

// The operations this command serves, and the whole of what tells them apart: their own flags and
// their own usage line. The table is the command set, so the dispatcher asks it what it accepts.
const operations: Record<
  TaskOperationName,
  { valueFlags: readonly string[]; usage: string }
> = {
  create: {
    valueFlags: [
      "--title",
      "--do-date",
      "--notes",
      "--assessment",
      "--source",
      "--milestone",
    ],
    usage:
      "Usage: academic-os tasks create --config <path> --semester <semester> --module <module> --title <title> [--do-date <YYYY-MM-DD>] [--notes <notes>] [--assessment <name>] [--source <name>] [--milestone <name>] [--json]",
  },
  change: {
    valueFlags: ["--task", "--title", "--do-date", "--notes"],
    usage:
      "Usage: academic-os tasks change --config <path> --semester <semester> --module <module> --task <task-id> [--title <title>] [--do-date <YYYY-MM-DD>] [--notes <notes>] [--json]",
  },
  complete: {
    valueFlags: ["--task"],
    usage:
      "Usage: academic-os tasks complete --config <path> --semester <semester> --module <module> --task <task-id> [--json]",
  },
  cancel: {
    valueFlags: ["--task"],
    usage:
      "Usage: academic-os tasks cancel --config <path> --semester <semester> --module <module> --task <task-id> [--json]",
  },
};

export function isTaskOperation(
  value: string | undefined,
): value is TaskOperationName {
  return value !== undefined && Object.hasOwn(operations, value);
}

// The four in-session task operations share everything but their arguments: each one pushes to
// the module's live list with the write credential, then refreshes the register with the read
// one — the same credential split an unattended pull already runs under.
export async function runTasksOperateCommand(
  name: TaskOperationName,
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseOperationArguments(name, arguments_);
  const { config, tasks } = await loadCohortTasksConfig(parsed.configPath);
  const target = resolveConfiguredAuditTarget(
    config,
    parsed.semester,
    parsed.module,
  );
  const report = await applyTaskOperation({
    target: {
      semester: target.semester,
      module: target.module,
      registerStore: createDeferredTaskRegisterStore(target),
    },
    operation: parsed.operation,
    writer: createGoogleTaskOperationWriter(tasks.credentials.interactiveWrite),
    reader: createGoogleTaskRefreshReader(tasks.credentials.scheduledRead),
  });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderHuman(name, report)}\n`,
  );
  if (report.outcome !== "applied" || report.register?.freshness !== "fresh") {
    process.exitCode = 2;
  }
}

function parseOperationArguments(
  name: TaskOperationName,
  arguments_: string[],
): {
  configPath: string;
  semester: string;
  module: string;
  operation: TaskOperation;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: name,
    valueFlags: [
      "--config",
      "--semester",
      "--module",
      ...operations[name].valueFlags,
    ],
    booleanFlags: ["--json"],
    usage: operations[name].usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  if (
    configPath === undefined ||
    semester === undefined ||
    module === undefined
  ) {
    throw new OperationalError("invalid-arguments", operations[name].usage);
  }
  return {
    configPath,
    semester,
    module,
    operation: readOperation(name, values),
  };
}

function readOperation(
  name: TaskOperationName,
  values: ReadonlyMap<string, string>,
): TaskOperation {
  const title = values.get("--title");
  const notes = values.get("--notes");
  const doDate = readDoDate(values.get("--do-date"), name);
  if (name === "create") {
    if (title === undefined) {
      throw new OperationalError("invalid-arguments", operations.create.usage);
    }
    return {
      name,
      title,
      ...(doDate === undefined ? {} : { doDate }),
      ...(notes === undefined ? {} : { notes }),
      ...provenanceOf(values),
    };
  }
  const taskId = values.get("--task");
  if (taskId === undefined) {
    throw new OperationalError("invalid-arguments", operations[name].usage);
  }
  if (name !== "change") return { name, taskId };
  if (title === undefined && doDate === undefined && notes === undefined) {
    throw new OperationalError("invalid-arguments", operations.change.usage);
  }
  return {
    name,
    taskId,
    ...(title === undefined ? {} : { title }),
    ...(doDate === undefined ? {} : { doDate }),
    ...(notes === undefined ? {} : { notes }),
  };
}

// A Do-date carrying a time is refused at the boundary rather than truncated: Google discards the
// time half, so accepting one would silently agree to a deadline the register cannot hold.
function readDoDate(
  value: string | undefined,
  name: TaskOperationName,
): string | undefined {
  if (value === undefined) return undefined;
  if (!isDoDate(value)) {
    throw new OperationalError(
      "invalid-arguments",
      `A do-date is a date with no time: YYYY-MM-DD. ${operations[name].usage}`,
    );
  }
  return value;
}

const provenanceFlags = [
  ["--assessment", "assessment"],
  ["--source", "source"],
  ["--milestone", "milestone"],
] as const;

function provenanceOf(values: ReadonlyMap<string, string>): {
  provenance?: TaskProvenance;
} {
  const provenance: TaskProvenance = {};
  for (const [flag, key] of provenanceFlags) {
    const value = values.get(flag);
    if (value !== undefined) provenance[key] = value;
  }
  return Object.keys(provenance).length === 0 ? {} : { provenance };
}

function renderLiveOutcome(report: TaskOperationReport): string {
  if (report.taskId === null) return "no live change";
  return report.outcome === "unverified"
    ? `task ${report.taskId}, live result unverified`
    : `task ${report.taskId}`;
}

function renderHuman(
  name: TaskOperationName,
  report: TaskOperationReport,
): string {
  return [
    `Tasks ${name}: ${report.outcome}`,
    `${report.module.module} (${report.module.semester}): ${renderLiveOutcome(report)}`,
    ...(report.register === null
      ? []
      : [
          `Register: ${report.register.freshness}; ${renderTaskCounts(report.register.counts)}`,
        ]),
    ...(report.failure === undefined
      ? []
      : [`${report.failure.code}: ${report.failure.message}`]),
    ...(report.register?.failure === undefined
      ? []
      : [
          `${report.register.failure.code}: ${report.register.failure.message}`,
        ]),
  ].join("\n");
}
