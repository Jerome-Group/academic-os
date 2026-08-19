import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import {
  taskProvenanceKeys,
  taskRegisterPath,
  taskStatuses,
} from "../contract/task-register.js";
import { OperationalError } from "../operational-error.js";
import { writeFileAtomically } from "../write-file-atomically.js";
import { isDoDate } from "./do-date.js";
import type {
  TaskProvenance,
  TaskRegister,
  TaskRegisterEntry,
  TaskRegisterStore,
  TaskStatus,
} from "./types.js";

export function createFileTaskRegisterStore(
  moduleRoot: string,
): TaskRegisterStore {
  const registerPath = join(moduleRoot, taskRegisterPath);
  return {
    read: async () => await readRegister(registerPath),
    write: async (register) =>
      await writeFileAtomically(registerPath, serializeRegister(register)),
  };
}

async function readRegister(
  registerPath: string,
): Promise<TaskRegister | undefined> {
  let contents: string;
  try {
    contents = await readFile(registerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw invalidRegister();
  }
  let value: unknown;
  try {
    value = parse(contents);
  } catch {
    throw invalidRegister();
  }
  if (!isRecord(value)) throw invalidRegister();
  const listId = readListId(value.list_id);
  const tasks = value.tasks ?? [];
  if (!Array.isArray(tasks)) throw invalidRegister();
  return {
    ...(listId === undefined ? {} : { listId }),
    tasks: tasks.map(readEntry),
  };
}

// A register naming no list is the seeded skeleton, which provisioning fills; a register naming an
// empty one has lost the only handle it had on Google, and reading past that would push nowhere.
function readListId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value === "") throw invalidRegister();
  return value;
}

function readEntry(value: unknown): TaskRegisterEntry {
  if (!isRecord(value) || typeof value.title !== "string") {
    throw invalidRegister();
  }
  const status = readStatus(value.status);
  const taskId = optionalText(value.task_id);
  const notes = optionalText(value.notes);
  return {
    ...(taskId === undefined ? {} : { taskId }),
    title: value.title,
    ...(value.do_date === undefined
      ? {}
      : { doDate: readDoDate(value.do_date) }),
    status,
    ...(notes === undefined ? {} : { notes }),
    ...(value.provenance === undefined
      ? {}
      : { provenance: readProvenance(value.provenance) }),
  };
}

function readStatus(value: unknown): TaskStatus {
  const status = taskStatuses.find((candidate) => candidate === value);
  if (status === undefined) throw invalidRegister();
  return status;
}

// A register carrying a time is one to fix by hand rather than one to silently truncate: the
// time is the only evidence that somebody meant a deadline.
function readDoDate(value: unknown): string {
  if (!isDoDate(value)) throw invalidRegister();
  return value;
}

function readProvenance(value: unknown): TaskProvenance {
  if (!isRecord(value)) throw invalidRegister();
  const provenance: TaskProvenance = {};
  for (const key of taskProvenanceKeys) {
    const text = optionalText(value[key]);
    if (text !== undefined) provenance[key] = text;
  }
  return provenance;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidRegister();
  return value;
}

function invalidRegister(): OperationalError {
  return new OperationalError(
    "operational-failure",
    `The module's ${taskRegisterPath} is not a readable Task register.`,
  );
}

function serializeRegister(register: TaskRegister): string {
  return stringify({
    ...(register.listId === undefined ? {} : { list_id: register.listId }),
    tasks: register.tasks.map((entry) => ({
      ...(entry.taskId === undefined ? {} : { task_id: entry.taskId }),
      title: entry.title,
      ...(entry.doDate === undefined ? {} : { do_date: entry.doDate }),
      status: entry.status,
      ...(entry.notes === undefined ? {} : { notes: entry.notes }),
      ...(entry.provenance === undefined
        ? {}
        : { provenance: entry.provenance }),
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
