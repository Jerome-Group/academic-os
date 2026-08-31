import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, mkdir, open, readdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  ResearchAuditResult,
  ResearchProjectInventory,
} from "../conformance/index.js";
import {
  compareResearchAuditObservations,
  createResearchAuditObservation,
  isResearchAuditObservation,
  readObservationEnvelope,
  readResearchObservationEnvelope,
  researchObservationSchemaVersion,
  researchRuleSetVersion,
  type ResearchAuditObservation,
  type ResearchObservationComparison,
} from "../observation/index.js";
import { OperationalError } from "../operational-error.js";
import type { ResolvedConfiguredResearchProjectRoots } from "./resolve-configured-research-project-roots.js";
import type { HistoryDiagnostic, ObservationPublisher } from "./types.js";

export interface RecordResearchProjectAuditObservationInput {
  target: ResolvedConfiguredResearchProjectRoots;
  inventory: ResearchProjectInventory;
  result: ResearchAuditResult;
  observedAt: string;
  contractVersion: number | "unavailable";
}

export interface ResearchProjectAuditHistory {
  previous?: ResearchAuditObservation;
  diagnostics: HistoryDiagnostic[];
}

export interface RecordedResearchProjectAuditObservation {
  observation: ResearchAuditObservation;
  observationPath: string;
  comparison: ResearchObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
}

export async function recordResearchProjectAuditObservation(
  input: RecordResearchProjectAuditObservationInput,
  publisher: ObservationPublisher = atomicObservationPublisher,
): Promise<RecordedResearchProjectAuditObservation> {
  const history = await readResearchProjectAuditHistory(input.target);
  const observation = createResearchAuditObservation({
    target: {
      kind: "research-project",
      projectKey: input.target.project.key,
      profile: input.target.project.profile ?? "generic",
      identity: input.target.projectRoot,
    },
    inventory: input.inventory,
    findings: input.result.findings,
    observedAt: input.observedAt,
    contractVersion: input.contractVersion,
  });
  const comparison = compareResearchAuditObservations(
    observation,
    history.previous,
  );
  const directory = researchObservationDirectory(input.target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const observationPath = await appendObservation(
    directory,
    observation,
    publisher,
  );
  return {
    observation,
    observationPath,
    comparison,
    historyDiagnostics: history.diagnostics,
  };
}

export async function readResearchProjectAuditHistory(
  target: ResolvedConfiguredResearchProjectRoots,
): Promise<ResearchProjectAuditHistory> {
  const directory = researchObservationDirectory(target);
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
            message:
              "No prior Research-project observation exists for this target.",
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
      message:
        "An interrupted Research-project observation write was preserved for inspection.",
    }));
  const observations: ResearchAuditObservation[] = [];
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
      diagnostics.push(corruptDiagnostic(entry.name));
      continue;
    }
    const envelope = readResearchObservationEnvelope(value);
    if (envelope === undefined) {
      diagnostics.push(
        readObservationEnvelope(value) === undefined
          ? corruptDiagnostic(entry.name)
          : incompatibleDiagnostic(entry.name),
      );
      continue;
    }
    if (
      envelope.schemaVersion !== researchObservationSchemaVersion ||
      envelope.ruleSetVersion !== researchRuleSetVersion ||
      envelope.target.identity !== target.projectRoot ||
      envelope.target.projectKey !== target.project.key ||
      envelope.target.profile !== (target.project.profile ?? "generic")
    ) {
      diagnostics.push(incompatibleDiagnostic(entry.name));
      continue;
    }
    if (!isResearchAuditObservation(value)) {
      diagnostics.push(corruptDiagnostic(entry.name));
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
      message: "No prior Research-project observation exists for this target.",
    });
  }
  diagnostics.sort((left, right) =>
    `${left.kind}\u0000${left.path}`.localeCompare(
      `${right.kind}\u0000${right.path}`,
    ),
  );
  return { ...(previous === undefined ? {} : { previous }), diagnostics };
}

function researchObservationDirectory(
  target: ResolvedConfiguredResearchProjectRoots,
): string {
  const targetKey = createHash("sha256")
    .update(target.projectRoot)
    .digest("hex");
  return join(target.stateRoot, "observations", "research-projects", targetKey);
}

function corruptDiagnostic(path: string): HistoryDiagnostic {
  return {
    kind: "corrupt-history",
    path,
    message: "Research-project observation history does not match its schema.",
  };
}

function incompatibleDiagnostic(path: string): HistoryDiagnostic {
  return {
    kind: "incompatible-history",
    path,
    message:
      "Observation history uses a different target kind, schema, rule set, profile, or identity.",
  };
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
  observation: ResearchAuditObservation,
  publisher: ObservationPublisher,
): Promise<string> {
  const suffix = randomUUID();
  const timestamp = observation.observedAt.replaceAll(":", "-");
  const destination = join(directory, `${timestamp}--${suffix}.json`);
  const temporary = join(directory, `.research-observation-${suffix}.tmp`);
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
      "Research-project observation could not be appended atomically; any temporary write was preserved.",
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
  return name.startsWith(".research-observation-") && name.endsWith(".tmp");
}

const atomicObservationPublisher: ObservationPublisher = {
  publish: async (temporary, destination) => {
    await link(temporary, destination);
  },
};
