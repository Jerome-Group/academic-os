import { OperationalError } from "../mounted/index.js";
import {
  applyTaskOperation,
  applyTaskTargetOperation,
  configuredResearchProjectTaskTarget,
  configuredTaskTarget,
  createGoogleTaskRefreshReader,
  createGoogleTaskOperationWriter,
  isDoDate,
  type TaskOperation,
  type TaskOperationName,
  type TaskOperationReport,
  type TaskTargetOperationReport,
  type TaskProvenance,
  type ResearchTaskProvenance,
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
      "--claim",
      "--meeting",
      "--deliverable",
    ],
    usage:
      "Usage: academic-os tasks create --config <path> (--semester <semester> --module <module> | --research-project <key>) --title <title> [--do-date <YYYY-MM-DD>] [--notes <notes>] [--assessment <name>] [--source <name>] [--milestone <name>] [--claim <name>] [--meeting <name>] [--deliverable <name>] [--json]",
  },
  change: {
    valueFlags: ["--task", "--title", "--do-date", "--notes"],
    usage:
      "Usage: academic-os tasks change --config <path> (--semester <semester> --module <module> | --research-project <key>) --task <task-id> [--title <title>] [--do-date <YYYY-MM-DD>] [--notes <notes>] [--json]",
  },
  complete: {
    valueFlags: ["--task"],
    usage:
      "Usage: academic-os tasks complete --config <path> (--semester <semester> --module <module> | --research-project <key>) --task <task-id> [--json]",
  },
  cancel: {
    valueFlags: ["--task"],
    usage:
      "Usage: academic-os tasks cancel --config <path> (--semester <semester> --module <module> | --research-project <key>) --task <task-id> [--json]",
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
  const writer = createGoogleTaskOperationWriter(
    tasks.credentials.interactiveWrite,
  );
  const reader = createGoogleTaskRefreshReader(tasks.credentials.scheduledRead);
  const report =
    parsed.researchProject === undefined
      ? await applyTaskOperation({
          target: configuredTaskTarget(config, {
            semester: parsed.semester ?? "",
            module: parsed.module ?? "",
          }),
          operation: parsed.operation,
          writer,
          reader,
        })
      : await applyTaskTargetOperation({
          target: configuredResearchProjectTaskTarget(
            config,
            parsed.researchProject,
            { requireActive: true },
          ),
          operation: parsed.operation,
          writer,
          reader,
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
  researchProject?: string;
  operation: TaskOperation;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: name,
    valueFlags: [
      "--config",
      "--semester",
      "--module",
      "--research-project",
      ...operations[name].valueFlags,
    ],
    booleanFlags: ["--json"],
    usage: operations[name].usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  const researchProject = values.get("--research-project");
  const hasModuleTarget = semester !== undefined && module !== undefined;
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined) ||
    hasModuleTarget === (researchProject !== undefined)
  ) {
    throw new OperationalError("invalid-arguments", operations[name].usage);
  }
  return {
    configPath,
    semester: semester ?? "",
    module: module ?? "",
    ...(researchProject === undefined ? {} : { researchProject }),
    operation: readOperation(name, values, researchProject !== undefined),
  };
}

function readOperation(
  name: TaskOperationName,
  values: ReadonlyMap<string, string>,
  researchProject: boolean,
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
      ...provenanceOf(values, researchProject),
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

const moduleProvenanceFlags = [
  ["--assessment", "assessment"],
  ["--source", "source"],
  ["--milestone", "milestone"],
] as const;

const researchProvenanceFlags = [
  ...moduleProvenanceFlags,
  ["--claim", "claim"],
  ["--meeting", "meeting"],
  ["--deliverable", "deliverable"],
] as const;

function provenanceOf(
  values: ReadonlyMap<string, string>,
  researchProject: boolean,
): {
  provenance?: TaskProvenance | ResearchTaskProvenance;
} {
  const richFlags = researchProvenanceFlags.slice(moduleProvenanceFlags.length);
  if (
    !researchProject &&
    richFlags.some(([flag]) => values.get(flag) !== undefined)
  ) {
    throw new OperationalError(
      "invalid-arguments",
      "claim, meeting, and deliverable provenance are available only for --research-project targets.",
    );
  }
  const provenance: ResearchTaskProvenance = {};
  const flags = researchProject
    ? researchProvenanceFlags
    : moduleProvenanceFlags;
  for (const [flag, key] of flags) {
    const value = values.get(flag);
    if (value !== undefined) provenance[key] = value;
  }
  return Object.keys(provenance).length === 0 ? {} : { provenance };
}

function renderLiveOutcome(
  report: Pick<TaskOperationReport, "taskId" | "outcome">,
): string {
  if (report.taskId === null) return "no live change";
  return report.outcome === "unverified"
    ? `task ${report.taskId}, live result unverified`
    : `task ${report.taskId}`;
}

function renderHuman(
  name: TaskOperationName,
  report: TaskOperationReport | TaskTargetOperationReport,
): string {
  const target =
    "module" in report
      ? `${report.module.module} (${report.module.semester})`
      : `${report.target.title} (${report.target.key})`;
  return [
    `Tasks ${name}: ${report.outcome}`,
    `${target}: ${renderLiveOutcome(report)}`,
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
