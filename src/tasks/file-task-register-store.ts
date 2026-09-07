import { isAbsolute, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap, isSeq, parseDocument, stringify } from "yaml";

import {
  taskProvenanceKeys,
  taskRegisterPath,
  taskStatuses,
} from "../contract/task-register.js";
import { OperationalError } from "../operational-error.js";
import { recoverableRegisterFile } from "./recoverable-register-file.js";
import { isDoDate } from "./do-date.js";
import type {
  TaskRegister,
  TaskRegisterEntry,
  TaskRegisterProvenance,
  TaskRegisterStore,
  TaskStatus,
} from "./types.js";

export function createFileTaskRegisterStore(
  targetRoot: string,
  registerPath = taskRegisterPath,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[] = taskProvenanceKeys,
  options: { stateRoot?: string } = {},
): TaskRegisterStore {
  if (
    registerPath.length === 0 ||
    isAbsolute(registerPath) ||
    registerPath.includes("\\") ||
    normalize(registerPath) !== registerPath ||
    registerPath
      .split("/")
      .some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new OperationalError(
      "invalid-config",
      "A Task-register path must be a normalized relative path inside its target root.",
    );
  }
  const file = recoverableRegisterFile({
    targetRoot,
    registerPath,
    ...options,
  });
  let observed = false;
  let original: string | undefined;
  const read = async (): Promise<TaskRegister | undefined> => {
    original = await file.read();
    const register =
      original === undefined
        ? undefined
        : parseRegister(original, registerPath, provenanceKeys);
    observed = true;
    return register;
  };
  return {
    read,
    write: async (register) => {
      if (!observed) await read();
      const serialized = serializeRegister(register, provenanceKeys);
      const intended = parseRegister(serialized, registerPath, provenanceKeys);
      const previous =
        original === undefined
          ? undefined
          : parseRegister(original, registerPath, provenanceKeys);
      const contents = isDeepStrictEqual(previous, intended)
        ? (original as string)
        : original === undefined
          ? serialized
          : updateDocument(original, previous as TaskRegister, intended);
      await file.replace(original, contents);
      original = contents;
    },
  };
}

function parseRegister(
  contents: string,
  registerPath: string,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): TaskRegister {
  let value: unknown;
  try {
    const document = parseDocument(contents);
    if (document.errors.length > 0) throw invalidRegister(registerPath);
    value = document.toJS();
  } catch {
    throw invalidRegister(registerPath);
  }
  if (!isRecord(value)) throw invalidRegister(registerPath);
  const listId = readListId(value.list_id, registerPath);
  const tasks = value.tasks ?? [];
  if (!Array.isArray(tasks)) throw invalidRegister(registerPath);
  const entries = tasks.map((entry) =>
    readEntry(entry, registerPath, provenanceKeys),
  );
  const ids = entries.flatMap((entry) =>
    entry.taskId === undefined ? [] : [entry.taskId],
  );
  if (new Set(ids).size !== ids.length || ids.includes(""))
    throw invalidRegister(registerPath);
  return { ...(listId === undefined ? {} : { listId }), tasks: entries };
}

function updateDocument(
  original: string,
  previous: TaskRegister,
  intended: TaskRegister,
): string {
  const document = parseDocument(original);
  if (previous.listId !== intended.listId) {
    if (intended.listId === undefined) document.delete("list_id");
    else document.set("list_id", intended.listId);
  }
  const sequence = document.get("tasks");
  if (!isSeq(sequence) && previous.tasks.length > 0)
    throw invalidRegister("Task register");
  const oldNodes = isSeq(sequence) ? sequence.items : [];
  const used = new Set<number>();
  const nodes = intended.tasks.map((entry) => {
    const index = previous.tasks.findIndex(
      (old, i) =>
        !used.has(i) &&
        (entry.taskId === undefined
          ? old.taskId === undefined && isDeepStrictEqual(old, entry)
          : old.taskId === entry.taskId),
    );
    if (index < 0) return document.createNode(entryFields(entry));
    used.add(index);
    const node = oldNodes[index];
    if (!isMap(node)) throw invalidRegister("Task register");
    const before = entryFields(previous.tasks[index] as TaskRegisterEntry);
    for (const [key, value] of Object.entries(entryFields(entry))) {
      if (isDeepStrictEqual(before[key], value)) continue;
      if (value === undefined) node.delete(key);
      else node.set(key, value);
    }
    return node;
  });
  // Register operations retain history. Refuse a transformation whose identity cannot retain it.
  if (used.size !== previous.tasks.length)
    throw invalidRegister("Task register: unmatched existing rows");
  if (isSeq(sequence)) {
    if (sequence.items.length === 0 && nodes.length > 0) sequence.flow = false;
    sequence.items = nodes;
  } else document.set("tasks", document.createNode(nodes));
  return document.toString();
}

function entryFields(entry: TaskRegisterEntry): Record<string, unknown> {
  return {
    task_id: entry.taskId,
    title: entry.title,
    do_date: entry.doDate,
    status: entry.status,
    notes: entry.notes,
    provenance: entry.provenance,
  };
}

// A register naming no list is the seeded skeleton, which provisioning fills; a register naming an
// empty one has lost the only handle it had on Google, and reading past that would push nowhere.
function readListId(value: unknown, registerPath: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value === "") {
    throw invalidRegister(registerPath);
  }
  return value;
}

function readEntry(
  value: unknown,
  registerPath: string,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): TaskRegisterEntry {
  if (!isRecord(value) || typeof value.title !== "string") {
    throw invalidRegister(registerPath);
  }
  const status = readStatus(value.status, registerPath);
  const taskId = optionalText(value.task_id, registerPath);
  const notes = optionalText(value.notes, registerPath);
  return {
    ...(taskId === undefined ? {} : { taskId }),
    title: value.title,
    ...(value.do_date === undefined
      ? {}
      : { doDate: readDoDate(value.do_date, registerPath) }),
    status,
    ...(notes === undefined ? {} : { notes }),
    ...(value.provenance === undefined
      ? {}
      : {
          provenance: readProvenance(
            value.provenance,
            registerPath,
            provenanceKeys,
          ),
        }),
  };
}

function readStatus(value: unknown, registerPath: string): TaskStatus {
  const status = taskStatuses.find((candidate) => candidate === value);
  if (status === undefined) throw invalidRegister(registerPath);
  return status;
}

// A register carrying a time is one to fix by hand rather than one to silently truncate: the
// time is the only evidence that somebody meant a deadline.
function readDoDate(value: unknown, registerPath: string): string {
  if (!isDoDate(value)) throw invalidRegister(registerPath);
  return value;
}

function readProvenance(
  value: unknown,
  registerPath: string,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): TaskRegisterProvenance {
  if (!isRecord(value)) throw invalidRegister(registerPath);
  if (unsupportedProvenanceKeys(value, provenanceKeys).length > 0) {
    throw invalidRegister(registerPath);
  }
  const provenance: TaskRegisterProvenance = {};
  for (const key of provenanceKeys) {
    const text = optionalText(value[key], registerPath);
    if (text !== undefined) provenance[key] = text;
  }
  return provenance;
}

function optionalText(
  value: unknown,
  registerPath: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidRegister(registerPath);
  return value;
}

function invalidRegister(registerPath: string): OperationalError {
  return new OperationalError(
    "operational-failure",
    `The configured ${registerPath} is not a readable Task register.`,
  );
}

function serializeRegister(
  register: TaskRegister,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): string {
  return stringify({
    ...(register.listId === undefined ? {} : { list_id: register.listId }),
    tasks: register.tasks.map((entry) => ({
      ...(entry.taskId === undefined ? {} : { task_id: entry.taskId }),
      title: entry.title,
      ...(entry.doDate === undefined ? {} : { do_date: entry.doDate }),
      status: entry.status,
      ...(entry.notes === undefined ? {} : { notes: entry.notes }),
      ...serializedProvenance(entry.provenance, provenanceKeys),
    })),
  });
}

function serializedProvenance(
  provenance: TaskRegisterProvenance | undefined,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): { provenance?: TaskRegisterProvenance } {
  if (provenance === undefined) return {};
  const unsupported = unsupportedProvenanceKeys(provenance, provenanceKeys);
  if (unsupported.length > 0) {
    throw new OperationalError(
      "invalid-arguments",
      `The Task-register target does not support provenance fields ${unsupported.join(", ")}.`,
    );
  }
  const selected: TaskRegisterProvenance = {};
  for (const key of provenanceKeys) {
    const value = provenance[key];
    if (value !== undefined) selected[key] = value;
  }
  return Object.keys(selected).length === 0 ? {} : { provenance: selected };
}

function unsupportedProvenanceKeys(
  provenance: object,
  provenanceKeys: readonly (keyof TaskRegisterProvenance)[],
): string[] {
  const supported = new Set<string>(provenanceKeys);
  return Object.entries(provenance).flatMap(([key, value]) =>
    value !== undefined && !supported.has(key) ? [key] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
