import { sha256 } from "../checksum.js";
import { validateCurationRegister } from "../conformance/validate-curation-register.js";
import {
  readCurationRegisterLines,
  standingCurationItems,
} from "./read-curation-register.js";
import { type RecordedChecksum, renderChecksum } from "./recorded-checksum.js";
import type {
  CurationDiscrepancy,
  CurationIdentityCounts,
  CurationIdentityPlan,
  CurationItem,
  ModuleCurationIdentityPlan,
  ObservedCurationSource,
  ObservedModuleRegister,
  PlannedCurationMigration,
} from "./types.js";

// What every module's register owes contract-v4 identity, decided from bytes already read. Pure, so
// the preview a run shows and the lines it would append are the same strings.
export function planCurationIdentityMigration(input: {
  modules: readonly ObservedModuleRegister[];
  now: string;
}): CurationIdentityPlan {
  const modules = [...input.modules]
    .sort((left, right) => left.module.localeCompare(right.module))
    .map((observed) => planModule(observed, input.now));
  const counts = emptyCounts();
  for (const module of modules) {
    for (const state of stateNames) counts[state] += module.counts[state];
  }
  return {
    outcome: counts.migrating > 0 ? "legacy" : "contract-v4",
    counts,
    modules,
  };
}

const stateNames = [
  "contract-v4",
  "migrating",
  "changed",
  "unprovable",
  "missing-source",
] as const;

function emptyCounts(): CurationIdentityCounts {
  return {
    "contract-v4": 0,
    migrating: 0,
    changed: 0,
    unprovable: 0,
    "missing-source": 0,
  };
}

function planModule(
  observed: ObservedModuleRegister,
  now: string,
): ModuleCurationIdentityPlan {
  const empty = {
    module: observed.module,
    semester: observed.semester,
    counts: emptyCounts(),
    migrations: [],
    discrepancies: [],
    observedSha256: sha256(observed.register),
  };
  const finding = validateCurationRegister(observed.register);
  if (finding.status !== "pass") {
    return { ...empty, blockers: [finding.evidence] };
  }
  const items = standingCurationItems(
    readCurationRegisterLines(observed.register),
    observed.importerRoots,
  );
  const notation = registerNotation(items);
  const counts = emptyCounts();
  const migrations: PlannedCurationMigration[] = [];
  const discrepancies: CurationDiscrepancy[] = [];
  for (const item of items) {
    const decided = decideItem(item, observed.sources.get(sourceKey(item)));
    counts[decided.state] += 1;
    if (decided.state === "migrating") {
      migrations.push(migration(item, decided.source, notation, now));
    } else if (decided.state !== "contract-v4") {
      discrepancies.push({
        key: item.key,
        integration: item.integration,
        sourcePath: item.sourcePath,
        state: decided.state,
        evidence: decided.evidence,
      });
    }
  }
  return { ...empty, counts, migrations, discrepancies, blockers: [] };
}

function sourceKey(item: CurationItem): string {
  return `${item.integration}/${item.sourcePath}`;
}

type DecidedItem =
  | { state: "contract-v4" }
  | { state: "migrating"; source: ObservedCurationSource }
  | {
      state: "changed" | "unprovable" | "missing-source";
      evidence: string;
    };

// Identity is carried forward only where the recorded checksum proves the standing decision was
// made about the bytes now on the mount. Source bytes that differ are an update arrival, which is a
// decision about where the item's content should go, and this pass has no business making one — it
// leaves the line alone so the curation walk decides it once, in the open.
function decideItem(
  item: CurationItem,
  source: ObservedCurationSource | undefined,
): DecidedItem {
  if (item.identity === "contract-v4") return { state: "contract-v4" };
  if (source === undefined) {
    return {
      state: "missing-source",
      evidence: `No source is at ${sourceKey(item)}, so this pass can compute no sha-256 for it; the standing line and whatever it placed are left exactly as they are.`,
    };
  }
  const recorded = item.checksum;
  if (recorded === undefined || recorded.algorithm === "unrecognised") {
    return {
      state: "unprovable",
      evidence:
        "The standing line records no checksum this pass can compare, so nothing proves its decision was made about the bytes now on the mount.",
    };
  }
  return observedDigest(recorded, source) === recorded.value
    ? { state: "migrating", source }
    : {
        state: "changed",
        evidence: `The source bytes no longer match the ${recorded.algorithm} the standing line recorded, so this is an update arrival for the curation pass to decide rather than an identity to carry forward.`,
      };
}

function observedDigest(
  recorded: RecordedChecksum,
  source: ObservedCurationSource,
): string {
  return recorded.algorithm === "md5" ? source.md5 : source.sha256;
}

// The superseding line is the standing one with its identity fields replaced, so the decision, the
// destination and every other field the module settled are carried forward exactly rather than
// re-derived. The register stays append-only: nothing already written is touched.
function migration(
  item: CurationItem,
  source: ObservedCurationSource,
  notation: RecordedChecksum["notation"],
  now: string,
): PlannedCurationMigration {
  const checksum = renderChecksum("sha256", source.sha256, notation);
  const event = {
    ...item.standing.event,
    source_id: item.unnumberedPath,
    checksum,
    evidence: `Identity migration to contract v4: the unnumbered source path and the sha-256 of the source bytes. The ${item.checksum?.algorithm} the superseded line recorded still matches those bytes, so its decision stands and is carried forward unchanged.`,
    timestamp: now,
    supersedes: item.sourceId,
  };
  return {
    key: item.key,
    integration: item.integration,
    sourcePath: item.sourcePath,
    supersedes: item.sourceId,
    from: item.checksum === undefined ? "" : item.checksum.value,
    to: checksum,
    line: JSON.stringify(event),
  };
}

// Whatever notation the register's own contract-v4 lines use is what a new one uses, because the
// arrival walk joins on the recorded string. A register with none yet takes the bare digest the
// seeded Curation Procedure's example writes.
function registerNotation(
  items: readonly CurationItem[],
): RecordedChecksum["notation"] {
  return items.some(
    (item) =>
      item.identity === "contract-v4" && item.checksum?.notation === "prefixed",
  )
    ? "prefixed"
    : "bare";
}
