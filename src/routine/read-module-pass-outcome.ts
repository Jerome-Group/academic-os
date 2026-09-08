import { OperationalError } from "../mounted/index.js";
import {
  MAINTENANCE_DOMAINS,
  MAINTENANCE_STATUSES,
  type MaintenanceDomainId,
  type MaintenanceDomainOutcome,
} from "./maintenance-domains.js";
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

// The result file records the session's claims beside the wrapper's independent checks. A file it
// cannot read at all is a failed pass rather than an empty one — the morning never reports silence it did not
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
  const maintenance = readableMaintenance(result.maintenance);
  const curated = readable(result.curated, "curated", placement);
  const rederived = readable(result.rederived, "rederived", rederivation);
  const superseded = readable(result.superseded, "superseded", supersession);
  const withdrawn = readable(result.withdrawn, "withdrawn", withdrawal);
  const parked = readable(result.parked, "parked", parking);
  const docWrites = readable(result.docWrites, "docWrites", docWrite);
  const failures = readable(result.failures, "failures", failure);
  const noted = readable(result.noted, "noted", note);
  return {
    maintenance: maintenance.kept,
    curated: curated.kept,
    rederived: rederived.kept,
    superseded: superseded.kept,
    withdrawn: withdrawn.kept,
    parked: parked.kept,
    docWrites: docWrites.kept,
    failures: [
      ...failures.kept,
      ...maintenance.dropped,
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

function readableMaintenance(
  value: unknown,
): ReadBucket<MaintenanceDomainOutcome> {
  if (!Array.isArray(value)) {
    return {
      kept: [],
      dropped: [
        {
          code: "incomplete-maintenance-coverage",
          message:
            "The session result's maintenance must be an array containing every daily maintenance domain.",
        },
      ],
    };
  }

  const kept: MaintenanceDomainOutcome[] = [];
  const dropped: RoutineFailure[] = [];
  const seen = new Set<MaintenanceDomainId>();
  for (const valueEntry of value) {
    let entry: Record<string, unknown>;
    try {
      entry = asObject(valueEntry, "maintenance entry");
    } catch (error) {
      dropped.push(droppedMaintenance(error));
      continue;
    }

    if (!isMaintenanceDomain(entry.domain)) {
      dropped.push({
        code: "invalid-maintenance-domain",
        message: `A maintenance entry names an unknown domain: ${String(entry.domain)}. It was dropped, and the rest of the pass stands.`,
      });
      continue;
    }
    if (seen.has(entry.domain)) {
      dropped.push({
        code: "duplicate-maintenance-domain",
        message: `The session result reports ${entry.domain} more than once. The duplicate was dropped, and the first entry stands.`,
      });
      continue;
    }
    seen.add(entry.domain);
    try {
      kept.push(maintenanceEntry(entry));
    } catch (error) {
      dropped.push(droppedMaintenance(error));
    }
  }

  const covered = new Set(kept.map(({ domain }) => domain));
  const missing = MAINTENANCE_DOMAINS.filter(({ id }) => !covered.has(id)).map(
    ({ id }) => id,
  );
  if (missing.length > 0) {
    dropped.push({
      code: "incomplete-maintenance-coverage",
      message: `The session result omitted valid maintenance coverage for: ${missing.join(", ")}.`,
    });
  }
  return { kept, dropped };
}

function maintenanceEntry(
  entry: Record<string, unknown>,
): MaintenanceDomainOutcome {
  const domain = entry.domain as MaintenanceDomainId;
  if (
    typeof entry.status !== "string" ||
    !MAINTENANCE_STATUSES.some((status) => status === entry.status)
  ) {
    throw new OperationalError(
      "operational-failure",
      `A maintenance entry's status is invalid for ${domain}.`,
    );
  }
  if (
    !Array.isArray(entry.evidence) ||
    entry.evidence.length === 0 ||
    !entry.evidence.every(
      (item) => typeof item === "string" && item.trim().length > 0,
    )
  ) {
    throw new OperationalError(
      "operational-failure",
      `A maintenance entry's evidence for ${domain} must contain non-blank strings.`,
    );
  }
  return {
    domain,
    status: entry.status as MaintenanceDomainOutcome["status"],
    evidence: entry.evidence,
  };
}

function droppedMaintenance(error: unknown): RoutineFailure {
  return {
    code: "invalid-maintenance-entry",
    message: `${error instanceof Error ? error.message : String(error)} It was dropped, and the rest of the pass stands.`,
  };
}

function isMaintenanceDomain(value: unknown): value is MaintenanceDomainId {
  return (
    typeof value === "string" &&
    MAINTENANCE_DOMAINS.some(({ id }) => id === value)
  );
}

interface ReadBucket<Entry> {
  kept: Entry[];
  dropped: RoutineFailure[];
}

// A malformed bucket costs only that bucket; a malformed entry costs only itself. Work already
// completed and reported in the other buckets remains visible.
function readable<Entry>(
  value: unknown,
  key: string,
  read: (entry: Record<string, unknown>, key: string) => Entry,
): ReadBucket<Entry> {
  if (!Array.isArray(value)) {
    return {
      kept: [],
      dropped: [
        {
          code: "unreadable-bucket",
          message: `The session result's ${key} must be an array. It was dropped, and the rest of the pass stands.`,
        },
      ],
    };
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
