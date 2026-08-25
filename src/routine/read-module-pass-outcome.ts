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
// at all is a failed pass rather than an empty one — the morning never reports silence it did not
// earn. One unreadable entry is the smaller claim and gets the smaller answer: it is dropped and
// named in `failures`, and the buckets around it stand. The work a pass reports has already
// happened on the mount, so discarding seven good buckets over an eighth bad line reports a module
// as idle that has just rewritten its own docs.
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
  const curated = readable(result.curated, "curated", placement);
  const rederived = readable(result.rederived, "rederived", rederivation);
  const superseded = readable(result.superseded, "superseded", supersession);
  const withdrawn = readable(result.withdrawn, "withdrawn", withdrawal);
  const parked = readable(result.parked, "parked", parking);
  const docWrites = readable(result.docWrites, "docWrites", docWrite);
  const failures = readable(result.failures, "failures", failure);
  const noted = readable(result.noted, "noted", note);
  return {
    curated: curated.kept,
    rederived: rederived.kept,
    superseded: superseded.kept,
    withdrawn: withdrawn.kept,
    parked: parked.kept,
    docWrites: docWrites.kept,
    failures: [
      ...failures.kept,
      ...curated.dropped,
      ...rederived.dropped,
      ...superseded.dropped,
      ...withdrawn.dropped,
      ...parked.dropped,
      ...docWrites.dropped,
      ...failures.dropped,
      ...noted.dropped,
    ],
    noted: noted.kept,
  };
}

interface ReadBucket<Entry> {
  kept: Entry[];
  dropped: RoutineFailure[];
}

// A bucket that is not an array leaves nothing to salvage and fails the pass; an entry inside one
// costs only itself.
function readable<Entry>(
  value: unknown,
  key: string,
  read: (entry: Record<string, unknown>, key: string) => Entry,
): ReadBucket<Entry> {
  if (!Array.isArray(value)) {
    throw new OperationalError(
      "operational-failure",
      `The session result's ${key} must be an array.`,
    );
  }
  const kept: Entry[] = [];
  const dropped: RoutineFailure[] = [];
  for (const entry of value) {
    try {
      kept.push(read(asObject(entry, `${key} entry`), key));
    } catch (error) {
      dropped.push({
        code: "unreadable-entry",
        message: `${
          error instanceof Error ? error.message : String(error)
        } It was dropped, and the rest of the pass stands.`,
      });
    }
  }
  return { kept, dropped };
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

function parking(entry: Record<string, unknown>, key: string): ParkedItem {
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
