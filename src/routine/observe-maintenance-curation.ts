import {
  readDefinitionImporterSources,
  validateDefinition,
} from "../conformance/validate-definition.js";
import { validateCurationRegister } from "../conformance/validate-curation-register.js";
import type { Inventory, ModuleControls } from "../conformance/types.js";
import {
  readCurationRegisterEvents,
  standingCurationItems,
  walkedCurationItems,
} from "../curation/read-curation-register.js";
import { unnumberedSourcePath } from "../curation/unnumbered-source-path.js";
import type { MaintenanceImportObservation } from "./module-maintenance-work-order.js";

export type CurationAttention =
  | "unrecorded"
  | "requires-decision"
  | "normalized-path-collision"
  | "missing-derived-output"
  | "invalid-derived-output"
  | "invalid-curated-output"
  | "missing-curated-output"
  | "missing-recorded-source";
export interface MaintenanceCurationObservation {
  basis: "paths-and-standing-decisions-only";
  inputs: "available" | "unavailable";
  problems: string[];
  counts: Record<CurationAttention, number> & {
    sources: number;
    reservedMetadata: number;
    settled: number;
  };
  worklist: Array<{ kind: CurationAttention; key: string; paths: string[] }>;
  omittedItems: number;
}

// This observer proves path coverage only. Classification, materialization and byte equality remain
// the Curation procedure's responsibility, even when a standing decision and its output both exist.
export function observeMaintenanceCuration(input: {
  module: string;
  semester: string;
  inventory: Inventory;
  controls: ModuleControls;
  imports: MaintenanceImportObservation;
}): MaintenanceCurationObservation {
  const problems: string[] = [];
  if (input.inventory.provenance?.completeness !== "complete")
    problems.push(
      "Importer inventory is not known complete; missing paths cannot establish withdrawal.",
    );
  const definition = validateDefinition(
    input.controls.definition,
    input.module,
    input.semester,
  );
  const selectedSemester = /S([12])$/u.exec(input.semester)?.[1];
  const definitionAvailable =
    !definition.findings.some(({ status }) => status === "fail") &&
    definition.definition !== undefined &&
    definition.definition.code === input.module &&
    (selectedSemester === undefined ||
      definition.definition.semester === Number(selectedSemester));
  if (!definitionAvailable)
    problems.push(
      "Definition is missing, invalid or contradicts the selected module/semester; declared integrations are unavailable.",
    );
  const registerValid =
    validateCurationRegister(input.controls.curationRegister).status === "pass";
  if (!registerValid)
    problems.push(
      "Curation register is missing, unreadable or invalid; standing decisions are unavailable.",
    );
  const sources = definitionAvailable
    ? readDefinitionImporterSources(input.controls.definition)
    : [];
  const importerRoots = sources.flatMap(({ destinations }) => destinations);
  for (const root of importerRoots) {
    const receipts = input.imports.roots.filter(
      ({ destination }) => destination === root,
    );
    if (
      !input.imports.available ||
      receipts.length !== 1 ||
      receipts[0]?.status !== "current"
    )
      problems.push(
        `Importer receipt missing, ambiguous or noncurrent: ${root}; no withdrawal inference is permitted.`,
      );
  }
  const isImporterPath = (path: string): boolean =>
    importerRoots.some((root) => path === root || path.startsWith(`${root}/`));
  const entries = new Map(
    input.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const pathCounts = new Map<string, number>();
  for (const { path } of input.inventory.entries)
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  const standing = registerValid
    ? standingCurationItems(
        walkedCurationItems(
          readCurationRegisterEvents(input.controls.curationRegister ?? ""),
          sources.map(({ integration }) => integration),
        ),
      )
    : [];
  const decisions = new Map(standing.map((item) => [item.key, item]));
  const mirror = new Map<string, string[]>();
  const pendingMetadata = new Map<string, string[]>();
  const counts: MaintenanceCurationObservation["counts"] = {
    sources: 0,
    reservedMetadata: 0,
    settled: 0,
    unrecorded: 0,
    "requires-decision": 0,
    "normalized-path-collision": 0,
    "missing-derived-output": 0,
    "invalid-derived-output": 0,
    "invalid-curated-output": 0,
    "missing-curated-output": 0,
    "missing-recorded-source": 0,
  };
  for (const { integration, destinations } of sources) {
    for (const root of destinations) {
      if (entries.get(root)?.kind !== "directory")
        problems.push(`Importer root missing or unreadable: ${root}.`);
      for (const entry of input.inventory.entries) {
        if (!entry.path.startsWith(`${root}/`) || entry.kind === "directory")
          continue;
        const path = entry.path.slice(root.length + 1);
        if (entry.kind !== "file") {
          problems.push(
            `Source is not an ordinary inventoried file: ${entry.path}.`,
          );
          continue;
        }
        if (integration === "ntulearn" && incompleteMetadataPath(path)) {
          problems.push(
            `Incomplete importer metadata publication: ${entry.path}.`,
          );
          continue;
        }
        const key = `${integration}/${unnumberedSourcePath(path)}`;
        if (integration === "ntulearn" && reservedMetadataPath(path)) {
          counts.reservedMetadata++;
          if (decisions.get(key)?.standing.decision === "requires-decision")
            pendingMetadata.set(key, [
              ...(pendingMetadata.get(key) ?? []),
              entry.path,
            ]);
          continue;
        }
        counts.sources++;
        mirror.set(key, [...(mirror.get(key) ?? []), entry.path]);
      }
    }
  }
  const worklist: MaintenanceCurationObservation["worklist"] = [];
  const add = (kind: CurationAttention, key: string, paths: string[]): void => {
    counts[kind]++;
    worklist.push({ kind, key, paths: [...paths].sort().slice(0, 20) });
  };
  const outputPresent = (path: string): boolean =>
    !isImporterPath(path) &&
    entries.get(path)?.kind === "file" &&
    pathCounts.get(path) === 1;
  const derivedPaths = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((path): path is string => typeof path === "string")
      : [];

  for (const [key, paths] of pendingMetadata)
    add("requires-decision", key, paths);
  for (const [key, paths] of mirror) {
    if (paths.length > 1) {
      add("normalized-path-collision", key, paths);
      continue;
    }
    if (!registerValid) continue;
    const item = decisions.get(key);
    if (item === undefined || item.standing.decision === "withdrawn")
      add("unrecorded", key, paths);
    else if (item.standing.decision === "requires-decision")
      add("requires-decision", key, paths);
    else if (
      item.standing.decision === "source-only" ||
      (item.standing.decision === "rederived" &&
        derivedPaths(item.standing.derived).every(outputPresent)) ||
      (item.standing.decision === "curated" &&
        typeof item.standing.destination === "string" &&
        outputPresent(item.standing.destination))
    )
      counts.settled++;
  }
  for (const item of standing) {
    if (mirror.get(item.key)?.length !== 1) {
      if (
        !mirror.has(item.key) &&
        item.standing.decision !== "withdrawn" &&
        !(
          item.integration === "ntulearn" &&
          reservedMetadataPath(item.sourcePath)
        )
      )
        add("missing-recorded-source", item.key, [item.sourcePath]);
    }
    if (item.standing.decision === "rederived") {
      const paths = derivedPaths(item.standing.derived);
      const invalid = paths.filter(isImporterPath);
      const missing = paths.filter(
        (path) => !isImporterPath(path) && !outputPresent(path),
      );
      if (invalid.length > 0) add("invalid-derived-output", item.key, invalid);
      if (missing.length > 0) add("missing-derived-output", item.key, missing);
    }
    if (
      item.standing.decision === "curated" &&
      typeof item.standing.destination === "string" &&
      (isImporterPath(item.standing.destination) ||
        !outputPresent(item.standing.destination))
    )
      add(
        isImporterPath(item.standing.destination)
          ? "invalid-curated-output"
          : "missing-curated-output",
        item.key,
        [item.standing.destination],
      );
  }
  worklist.sort(
    (a, b) =>
      Number(a.kind === "missing-recorded-source") -
        Number(b.kind === "missing-recorded-source") ||
      compareText(a.key, b.key) ||
      compareText(a.kind, b.kind),
  );
  return {
    basis: "paths-and-standing-decisions-only",
    inputs: problems.length === 0 ? "available" : "unavailable",
    problems: [...new Set(problems)].sort().slice(0, 30),
    counts,
    worklist: worklist.slice(0, 100),
    omittedItems: Math.max(0, worklist.length - 100),
  };
}

function reservedMetadataPath(path: string): boolean {
  return (
    ["Course.md", "Last synced.md", "Sync status.json"].includes(path) ||
    /^Source editions\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/u.test(path)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function incompleteMetadataPath(path: string): boolean {
  return /^Source editions\/[a-f0-9]{64}\/[a-f0-9]{64}\.json(?:\.part-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}){1,2}$/u.test(
    path,
  );
}
