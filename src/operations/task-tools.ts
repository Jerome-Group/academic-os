import { OperationalError } from "../operational-error.js";
import {
  applyTaskOperation,
  applyTaskTargetOperation,
  isDoDate,
  readTaskRegister,
  readTaskTargetRegister,
  type TaskOperation,
  type TaskOperationWriter,
  type TaskProvenance,
  type ResearchTaskProvenance,
  type TaskRefreshReader,
  type TaskRefreshTarget,
  type TaskRegisterTarget,
} from "../tasks/index.js";
import type {
  OperationTool,
  OperationToolField,
  OperationToolResult,
} from "./types.js";

// What the served operations need that a served tool cannot carry: the module a call names
// resolved to its register, and the two credentials the push and the pull run under.
export interface TaskToolPort {
  target(module: { semester: string; module: string }): TaskRefreshTarget;
  researchProjectTarget?(key: string): TaskRegisterTarget;
  writer: TaskOperationWriter;
  reader: TaskRefreshReader;
}

const moduleFields: OperationToolField[] = [
  {
    name: "semester",
    description:
      "The semester the module runs in, as the configuration names it.",
    required: true,
  },
  {
    name: "module",
    description: "The module code.",
    required: true,
  },
];

const researchProjectFields: OperationToolField[] = [
  {
    name: "research_project",
    description: "The research project's stable configuration key.",
    required: true,
  },
];

const taskField: OperationToolField = {
  name: "task_id",
  description:
    "The Google task ID, as the Task register holds it. A task the register has no row for parks until the register is read.",
  required: true,
};

const doDateField: OperationToolField = {
  name: "do_date",
  description:
    "The day the work is planned, as YYYY-MM-DD. It is never a deadline and never carries a time.",
};

const notesField: OperationToolField = {
  name: "notes",
  description: "The task's notes, as they read on the phone.",
};

// The v1 surface: the three in-session writes that follow the Promotion pattern, and the read
// that catches a module's register up with its live list.
export function createTaskTools(port: TaskToolPort): OperationTool[] {
  const moduleTools: OperationTool[] = [
    {
      name: "tasks_create",
      title: "Create a task",
      description:
        "Create a task on a module's live task list, then refresh its Task register. The task appears on the Owner's phone; a push the list refuses parks and leaves the register with no row for it.",
      fields: [
        ...moduleFields,
        {
          name: "title",
          description: "The task title, as it reads on the phone.",
          required: true,
        },
        doDateField,
        notesField,
        {
          name: "assessment",
          description:
            "Provenance Google never sees: the assessment this task belongs to.",
        },
        {
          name: "source",
          description:
            "Provenance Google never sees: the source item this task came from.",
        },
        {
          name: "milestone",
          description:
            "Provenance Google never sees: the Calendar milestone this task relates to.",
        },
      ],
      call: async (values) =>
        await operate(port, values, {
          name: "create",
          title: required(values, "title"),
          ...optionalDoDate(values),
          ...optional(values, "notes"),
          ...moduleProvenance(values),
        }),
    },
    {
      name: "tasks_change",
      title: "Change a task",
      description:
        "Change a task's title, do-date or notes on a module's live task list, then refresh its Task register.",
      fields: [
        ...moduleFields,
        taskField,
        { name: "title", description: "The new task title." },
        doDateField,
        notesField,
      ],
      call: async (values) => {
        const change = {
          ...optional(values, "title"),
          ...optionalDoDate(values),
          ...optional(values, "notes"),
        };
        if (Object.keys(change).length === 0) {
          throw new OperationalError(
            "invalid-arguments",
            "tasks_change takes at least one of title, do_date or notes.",
          );
        }
        return await operate(port, values, {
          name: "change",
          taskId: required(values, "task_id"),
          ...change,
        });
      },
    },
    {
      name: "tasks_complete",
      title: "Complete a task",
      description:
        "Tick a task on a module's live task list, then refresh its Task register.",
      fields: [...moduleFields, taskField],
      call: async (values) =>
        await operate(port, values, {
          name: "complete",
          taskId: required(values, "task_id"),
        }),
    },
    {
      name: "tasks_read_register",
      title: "Read a module's Task register",
      description:
        "Pull a module's live task list into its Task register and return the register's rows with their provenance. Reading pulls first: the live list is the authority, and a list that cannot be reached reads stale.",
      fields: moduleFields,
      call: async (values) => {
        const report = await readTaskRegister({
          target: port.target(moduleOf(values)),
          reader: port.reader,
        });
        return { report, failed: report.outcome !== "read" };
      },
    },
  ];
  const researchProjectTarget = port.researchProjectTarget;
  return researchProjectTarget === undefined
    ? moduleTools
    : [
        ...moduleTools,
        ...createResearchProjectTaskTools({
          ...port,
          researchProjectTarget,
        }),
      ];
}

function createResearchProjectTaskTools(
  port: TaskToolPort & {
    researchProjectTarget(key: string): TaskRegisterTarget;
  },
): OperationTool[] {
  return [
    {
      name: "research_tasks_create",
      title: "Create a research-project task",
      description:
        "Create a task on a research project's live task list, then refresh its Task register.",
      fields: [
        ...researchProjectFields,
        {
          name: "title",
          description: "The task title, as it reads on the phone.",
          required: true,
        },
        doDateField,
        notesField,
        {
          name: "assessment",
          description:
            "Provenance Google never sees: the assessment this task belongs to.",
        },
        {
          name: "source",
          description:
            "Provenance Google never sees: the source this task came from.",
        },
        {
          name: "milestone",
          description:
            "Provenance Google never sees: the Calendar milestone this task relates to.",
        },
        {
          name: "claim",
          description:
            "Provenance Google never sees: the research claim this task advances.",
        },
        {
          name: "meeting",
          description:
            "Provenance Google never sees: the supervisor meeting this task follows from.",
        },
        {
          name: "deliverable",
          description:
            "Provenance Google never sees: the research deliverable this task advances.",
        },
      ],
      call: async (values) =>
        await operateResearchProject(port, values, {
          name: "create",
          title: required(values, "title"),
          ...optionalDoDate(values),
          ...optional(values, "notes"),
          ...researchProvenance(values),
        }),
    },
    {
      name: "research_tasks_change",
      title: "Change a research-project task",
      description:
        "Change a task's title, do-date or notes on a research project's live task list, then refresh its Task register.",
      fields: [
        ...researchProjectFields,
        taskField,
        { name: "title", description: "The new task title." },
        doDateField,
        notesField,
      ],
      call: async (values) => {
        const change = {
          ...optional(values, "title"),
          ...optionalDoDate(values),
          ...optional(values, "notes"),
        };
        if (Object.keys(change).length === 0) {
          throw new OperationalError(
            "invalid-arguments",
            "research_tasks_change takes at least one of title, do_date or notes.",
          );
        }
        return await operateResearchProject(port, values, {
          name: "change",
          taskId: required(values, "task_id"),
          ...change,
        });
      },
    },
    {
      name: "research_tasks_complete",
      title: "Complete a research-project task",
      description:
        "Tick a task on a research project's live task list, then refresh its Task register.",
      fields: [...researchProjectFields, taskField],
      call: async (values) =>
        await operateResearchProject(port, values, {
          name: "complete",
          taskId: required(values, "task_id"),
        }),
    },
    {
      name: "research_tasks_read_register",
      title: "Read a research project's Task register",
      description:
        "Pull a research project's live task list into its Task register and return rows with their provenance.",
      fields: researchProjectFields,
      call: async (values) => {
        const report = await readTaskTargetRegister({
          target: port.researchProjectTarget(
            required(values, "research_project"),
          ),
          reader: port.reader,
        });
        return { report, failed: report.outcome !== "read" };
      },
    },
  ];
}

async function operate(
  port: TaskToolPort,
  values: ReadonlyMap<string, string>,
  operation: TaskOperation,
): Promise<OperationToolResult> {
  const report = await applyTaskOperation({
    target: port.target(moduleOf(values)),
    operation,
    writer: port.writer,
    reader: port.reader,
  });
  // The push is what the operation was asked to do, so a verified one whose follow-up pull then
  // failed is applied and not an error: the task is on the Owner's phone, and reporting it as a
  // failure is what invites the calling agent to push it a second time. The report names the
  // stale register, which a later read settles.
  return { report, failed: report.outcome !== "applied" };
}

async function operateResearchProject(
  port: TaskToolPort & {
    researchProjectTarget(key: string): TaskRegisterTarget;
  },
  values: ReadonlyMap<string, string>,
  operation: TaskOperation,
): Promise<OperationToolResult> {
  const report = await applyTaskTargetOperation({
    target: port.researchProjectTarget(required(values, "research_project")),
    operation,
    writer: port.writer,
    reader: port.reader,
  });
  return { report, failed: report.outcome !== "applied" };
}

function moduleOf(values: ReadonlyMap<string, string>): {
  semester: string;
  module: string;
} {
  return {
    semester: required(values, "semester"),
    module: required(values, "module"),
  };
}

// The declared fields are what the parse already enforced, so a required one missing here is a
// tool whose table and body disagree rather than a caller's mistake.
function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new OperationalError("invalid-arguments", `${name} is required.`);
  }
  return value;
}

function optional(
  values: ReadonlyMap<string, string>,
  name: "title" | "notes",
): Record<string, string> {
  const value = values.get(name);
  return value === undefined ? {} : { [name]: value };
}

// A Do-date carrying a time is refused rather than truncated: Google discards the time half, so
// accepting one would silently agree to a deadline the register cannot hold.
function optionalDoDate(values: ReadonlyMap<string, string>): {
  doDate?: string;
} {
  const value = values.get("do_date");
  if (value === undefined) return {};
  if (!isDoDate(value)) {
    throw new OperationalError(
      "invalid-arguments",
      "A do-date is a date with no time: YYYY-MM-DD.",
    );
  }
  return { doDate: value };
}

const moduleProvenanceKeys = ["assessment", "source", "milestone"] as const;

const researchProvenanceKeys = [
  ...moduleProvenanceKeys,
  "claim",
  "meeting",
  "deliverable",
] as const;

function moduleProvenance(values: ReadonlyMap<string, string>): {
  provenance?: TaskProvenance;
} {
  const provenance: TaskProvenance = {};
  for (const key of moduleProvenanceKeys) {
    const value = values.get(key);
    if (value !== undefined) provenance[key] = value;
  }
  return Object.keys(provenance).length === 0 ? {} : { provenance };
}

function researchProvenance(values: ReadonlyMap<string, string>): {
  provenance?: ResearchTaskProvenance;
} {
  const provenance: ResearchTaskProvenance = {};
  for (const key of researchProvenanceKeys) {
    const value = values.get(key);
    if (value !== undefined) provenance[key] = value;
  }
  return Object.keys(provenance).length === 0 ? {} : { provenance };
}
