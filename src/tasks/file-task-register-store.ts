import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

import { OperationalError } from "../operational-error.js";
import type {
  TaskProvenance,
  TaskRegister,
  TaskRegisterEntry,
  TaskRegisterStore,
  TaskStatus,
} from "./types.js";

export const TASK_REGISTER_RELATIVE_PATH = join(
  "00 Module Admin",
  "30 Task Register.yaml",
);

const TASK_STATUSES: readonly string[] = ["open", "completed", "cancelled"];
const PROVENANCE_KEYS = ["assessment", "source", "milestone"] as const;

export function createFileTaskRegisterStore(
  moduleRoot: string,
): TaskRegisterStore {
  const registerPath = join(moduleRoot, TASK_REGISTER_RELATIVE_PATH);
  return {
    read: async () => await readRegister(registerPath),
    write: async (register) => await writeRegister(registerPath, register),
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
  if (!isRecord(value) || typeof value.list_id !== "string") {
    throw invalidRegister();
  }
  const tasks = value.tasks ?? [];
  if (!Array.isArray(tasks)) throw invalidRegister();
  return { listId: value.list_id, tasks: tasks.map(readEntry) };
}

function readEntry(value: unknown): TaskRegisterEntry {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.status !== "string" ||
    !TASK_STATUSES.includes(value.status)
  ) {
    throw invalidRegister();
  }
  const taskId = optionalText(value.task_id);
  const notes = optionalText(value.notes);
  return {
    ...(taskId === undefined ? {} : { taskId }),
    title: value.title,
    ...(value.do_date === undefined
      ? {}
      : { doDate: readDoDate(value.do_date) }),
    status: value.status as TaskStatus,
    ...(notes === undefined ? {} : { notes }),
    ...(value.provenance === undefined
      ? {}
      : { provenance: readProvenance(value.provenance) }),
  };
}

// A do-date is the day work is planned, and the schema reserves no room for a time: anything
// carrying one is a register to fix by hand rather than one to silently truncate.
function readDoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw invalidRegister();
  }
  return value;
}

function readProvenance(value: unknown): TaskProvenance {
  if (!isRecord(value)) throw invalidRegister();
  const provenance: TaskProvenance = {};
  for (const key of PROVENANCE_KEYS) {
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
    `The module's ${TASK_REGISTER_RELATIVE_PATH} is not a readable Task register.`,
  );
}

async function writeRegister(
  registerPath: string,
  register: TaskRegister,
): Promise<void> {
  const temporary = join(
    dirname(registerPath),
    `.30 Task Register-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, serializeRegister(register), { flag: "wx" });
    await rename(temporary, registerPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function serializeRegister(register: TaskRegister): string {
  return stringify({
    list_id: register.listId,
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
