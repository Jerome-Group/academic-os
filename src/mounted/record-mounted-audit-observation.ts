import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, mkdir, open, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  compareAuditObservations,
  createAuditObservation,
  isAuditObservation,
  observationSchemaVersion,
  readObservationEnvelope,
  ruleSetVersion,
  type AuditObservation,
} from "../observation/index.js";
import { OperationalError } from "../operational-error.js";
import type {
  AppendMountedAuditObservationInput,
  HistoryDiagnostic,
  MountedAuditHistory,
  ObservationPublisher,
  RecordedAuditObservation,
  RecordMountedAuditObservationInput,
} from "./types.js";

export async function recordMountedAuditObservation(
  input: RecordMountedAuditObservationInput,
  publisher: ObservationPublisher = atomicObservationPublisher,
): Promise<RecordedAuditObservation> {
  const history = await readMountedAuditHistory(input.target);
  const observation = createAuditObservation({
    target: {
      moduleCode: input.target.module,
      semester: input.target.semester,
      identity: input.target.moduleRoot,
    },
    inventory: input.inventory,
    findings: input.result.findings,
    observedAt: input.observedAt,
    contractVersion: input.contractVersion,
  });
  const comparison = compareAuditObservations(observation, history.previous);
  return await appendMountedAuditObservation(
    {
      target: input.target,
      observation,
      comparison,
      historyDiagnostics: history.diagnostics,
    },
    publisher,
  );
}

export async function readMountedAuditHistory(
  target: RecordMountedAuditObservationInput["target"],
): Promise<MountedAuditHistory> {
  const historyDirectory = observationDirectory(target);
  return await readHistory(historyDirectory, target);
}

export async function appendMountedAuditObservation(
  input: AppendMountedAuditObservationInput,
  publisher: ObservationPublisher = atomicObservationPublisher,
): Promise<RecordedAuditObservation> {
  const historyDirectory = observationDirectory(input.target);
  await mkdir(historyDirectory, { recursive: true, mode: 0o700 });
  const observationPath = await appendObservation(
    historyDirectory,
    input.observation,
    publisher,
  );
  return {
    observation: input.observation,
    observationPath,
    comparison: input.comparison,
    historyDiagnostics: input.historyDiagnostics,
  };
}

function observationDirectory(
  target: RecordMountedAuditObservationInput["target"],
): string {
  const targetKey = createHash("sha256")
    .update(target.moduleRoot)
    .digest("hex");
  return join(target.stateRoot, "observations", targetKey);
}

async function readHistory(
  directory: string,
  target: RecordMountedAuditObservationInput["target"],
): Promise<{
  previous?: AuditObservation;
  diagnostics: HistoryDiagnostic[];
}> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return {
        diagnostics: [
          {
            kind: "missing-history",
            path: basename(directory),
            message: "No prior observation exists for this target.",
          },
        ],
      };
    }
    throw error;
  }
  const diagnostics: HistoryDiagnostic[] = entries
    .filter((entry) => entry.isFile() && isTemporaryObservation(entry.name))
    .map(({ name }) => ({
      kind: "interrupted-write" as const,
      path: name,
      message: "An interrupted observation write was preserved for inspection.",
    }));
  const observations: AuditObservation[] = [];
  const jsonEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of jsonEntries) {
    const path = join(directory, entry.name);
    let value: unknown;
    try {
      const file = await open(path, "r");
      try {
        value = JSON.parse(await file.readFile("utf8"));
      } finally {
        await file.close();
      }
    } catch {
      diagnostics.push({
        kind: "corrupt-history",
        path: entry.name,
        message: "Observation history is not readable valid JSON.",
      });
      continue;
    }
    const envelope = readObservationEnvelope(value);
    if (envelope === undefined) {
      diagnostics.push({
        kind: "corrupt-history",
        path: entry.name,
        message: "Observation history does not match the observation schema.",
      });
      continue;
    }
    if (
      envelope.schemaVersion !== observationSchemaVersion ||
      envelope.ruleSetVersion !== ruleSetVersion ||
      envelope.target.identity !== target.moduleRoot ||
      envelope.target.moduleCode !== target.module ||
      envelope.target.semester !== target.semester
    ) {
      diagnostics.push({
        kind: "incompatible-history",
        path: entry.name,
        message:
          "Observation history uses a different schema, rule set, or target identity.",
      });
      continue;
    }
    if (!isAuditObservation(value)) {
      diagnostics.push({
        kind: "corrupt-history",
        path: entry.name,
        message: "Observation history does not match the observation schema.",
      });
      continue;
    }
    observations.push(value);
  }

  observations.sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt),
  );
  const previous = observations[0];
  if (previous === undefined && jsonEntries.length === 0) {
    diagnostics.push({
      kind: "missing-history",
      path: basename(directory),
      message: "No prior observation exists for this target.",
    });
  }
  diagnostics.sort((left, right) =>
    `${left.kind}\u0000${left.path}`.localeCompare(
      `${right.kind}\u0000${right.path}`,
    ),
  );
  return { ...(previous === undefined ? {} : { previous }), diagnostics };
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function appendObservation(
  directory: string,
  observation: AuditObservation,
  publisher: ObservationPublisher,
): Promise<string> {
  const suffix = randomUUID();
  const timestamp = observation.observedAt.replaceAll(":", "-");
  const destination = join(directory, `${timestamp}--${suffix}.json`);
  const temporary = join(directory, `.observation-${suffix}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(observation, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await syncDirectory(directory);
    await publisher.publish(temporary, destination);
    await syncDirectory(directory);
    await unlink(temporary);
    await syncDirectory(directory);
    return destination;
  } catch {
    throw new OperationalError(
      "operational-failure",
      "Observation could not be appended atomically; any temporary write was preserved.",
    );
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isTemporaryObservation(name: string): boolean {
  return name.startsWith(".observation-") && name.endsWith(".tmp");
}

const atomicObservationPublisher: ObservationPublisher = {
  publish: async (temporary, destination) => {
    await link(temporary, destination);
  },
};
