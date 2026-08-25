import { OperationalError } from "../mounted/index.js";
import type {
  CuratedItem,
  DocWrite,
  ModulePassOutcome,
  NotedItem,
  ParkedItem,
  RederivedItem,
  RoutineFailure,
  SupersededItem,
  WithdrawnItem,
} from "./types.js";

// The result file is the only thing the wrapper believes about a session, so a file it cannot read
// as this shape is a failed pass rather than an empty one — the morning never reports silence it
// did not earn.
export function readModulePassOutcome(contents: string): ModulePassOutcome {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new OperationalError(
      "operational-failure",
      "The session result is not valid JSON.",
    );
  }
  const result = asObject(value, "result");
  return {
    curated: entries(result.curated, "curated", placement),
    rederived: entries(result.rederived, "rederived", rederivation),
    superseded: entries(result.superseded, "superseded", supersession),
    withdrawn: entries(result.withdrawn, "withdrawn", withdrawal),
    parked: entries(result.parked, "parked", parked),
    docWrites: entries(result.docWrites, "docWrites", docWrite),
    failures: entries(result.failures, "failures", failure),
    noted: entries(result.noted, "noted", note),
  };
}

function entries<Entry>(
  value: unknown,
  key: string,
  read: (entry: Record<string, unknown>, key: string) => Entry,
): Entry[] {
  if (!Array.isArray(value)) {
    throw new OperationalError(
      "operational-failure",
      `The session result's ${key} must be an array.`,
    );
  }
  return value.map((entry) => read(asObject(entry, `${key} entry`), key));
}

function placement(entry: Record<string, unknown>, key: string): CuratedItem {
  return {
    item: text(entry.item, key, "item"),
    destination: text(entry.destination, key, "destination"),
  };
}

function supersession(
  entry: Record<string, unknown>,
  key: string,
): SupersededItem {
  return {
    item: text(entry.item, key, "item"),
    ...(entry.destination === undefined || entry.destination === null
      ? {}
      : { destination: text(entry.destination, key, "destination") }),
  };
}

function rederivation(
  entry: Record<string, unknown>,
  key: string,
): RederivedItem {
  if (
    !Array.isArray(entry.derived) ||
    !entry.derived.every((path) => typeof path === "string")
  ) {
    throw new OperationalError(
      "operational-failure",
      `A ${key} entry's derived must be an array of paths.`,
    );
  }
  return { item: text(entry.item, key, "item"), derived: entry.derived };
}

function withdrawal(
  entry: Record<string, unknown>,
  key: string,
): WithdrawnItem {
  return {
    item: text(entry.item, key, "item"),
    evidence: text(entry.evidence, key, "evidence"),
  };
}

function parked(entry: Record<string, unknown>, key: string): ParkedItem {
  return {
    item: text(entry.item, key, "item"),
    reason: text(entry.reason, key, "reason"),
    evidence: text(entry.evidence, key, "evidence"),
  };
}

function note(entry: Record<string, unknown>, key: string): NotedItem {
  return {
    item: text(entry.item, key, "item"),
    note: text(entry.note, key, "note"),
  };
}

function docWrite(entry: Record<string, unknown>, key: string): DocWrite {
  return {
    file: text(entry.file, key, "file"),
    summary: text(entry.summary, key, "summary"),
  };
}

function failure(entry: Record<string, unknown>, key: string): RoutineFailure {
  return {
    code: text(entry.code, key, "code"),
    message: text(entry.message, key, "message"),
  };
}

function asObject(value: unknown, role: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OperationalError(
      "operational-failure",
      `The session ${role} must be a JSON object.`,
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, key: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OperationalError(
      "operational-failure",
      `A ${key} entry's ${field} must be a non-empty string.`,
    );
  }
  return value;
}
