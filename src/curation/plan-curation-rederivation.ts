import { sha256 } from "../checksum.js";
import { validateCurationRegister } from "../conformance/validate-curation-register.js";
import { curationSplitCandidates } from "./read-curation-splits.js";
import {
  closedCurationKeys,
  readCurationRegisterEvents,
  walkedCurationItems,
} from "./read-curation-register.js";
import { renderChecksum } from "./recorded-checksum.js";
import type {
  CurationRederivationPlan,
  CurationSplitCandidate,
  CurationSplitCounts,
  CurationSplitDiscrepancy,
  CurationSplitState,
  ModuleCurationRederivationPlan,
  ObservedModuleRederivation,
  ObservedRederivationSource,
  PlannedCurationRederivation,
  StandingCuratedLine,
} from "./rederivation-types.js";

// What every module's register owes MF-CURATION-005, decided from bytes already read. Pure, so the
// preview a run shows and the lines it would append are the same strings.
export function planCurationRederivation(input: {
  modules: readonly ObservedModuleRederivation[];
  now: string;
}): CurationRederivationPlan {
  const modules = [...input.modules]
    .sort((left, right) => left.module.localeCompare(right.module))
    .map((observed) => planModule(observed, input.now));
  const counts = emptyCounts();
  for (const module of modules) {
    for (const state of stateNames) counts[state] += module.counts[state];
  }
  return {
    outcome: counts.rederiving > 0 ? "split" : "settled",
    counts,
    modules,
  };
}

const stateNames = [
  "settled",
  "rederiving",
  "changed",
  "legacy-identity",
  "unprovable",
  "missing-source",
] as const;

function emptyCounts(): CurationSplitCounts {
  return {
    settled: 0,
    rederiving: 0,
    changed: 0,
    "legacy-identity": 0,
    unprovable: 0,
    "missing-source": 0,
  };
}

function planModule(
  observed: ObservedModuleRederivation,
  now: string,
): ModuleCurationRederivationPlan {
  const base = {
    module: observed.module,
    semester: observed.semester,
    counts: emptyCounts(),
    rederivations: [],
    discrepancies: [],
    observedSha256: sha256(observed.register),
  };
  const finding = validateCurationRegister(observed.register);
  if (finding.status !== "pass") {
    return { ...base, blockers: [finding.evidence] };
  }
  const walked = walkedCurationItems(
    readCurationRegisterEvents(observed.register),
    observed.integrations,
  );
  const closed = closedCurationKeys(walked);
  const counts = emptyCounts();
  const rederivations: PlannedCurationRederivation[] = [];
  const discrepancies: CurationSplitDiscrepancy[] = [];
  for (const candidate of curationSplitCandidates(walked)) {
    if (closed.has(candidate.key)) continue;
    const decided = decideCandidate(candidate, observed);
    counts[decided.state] += 1;
    if (decided.state === "rederiving") {
      rederivations.push(rederivation(candidate, decided, now));
    } else if (decided.state !== "settled") {
      discrepancies.push({
        key: candidate.key,
        integration: candidate.integration,
        sourcePath: candidate.sourcePath,
        state: decided.state,
        evidence: decided.evidence,
      });
    }
  }
  return { ...base, counts, rederivations, discrepancies, blockers: [] };
}

type SortedDestinations = {
  derived: string[];
  copies: string[];
  unreadable: string[];
  missing: string[];
};

type DecidedCandidate =
  | { state: "settled" }
  | ({
      state: "rederiving";
      source: ObservedRederivationSource;
    } & SortedDestinations)
  | {
      state: Exclude<CurationSplitState, "settled" | "rederiving">;
      evidence: string;
    };

// A split is corrected only where the source still hashes to what its standing lines recorded.
// Differing bytes are an update arrival — which issue the module should hold is the Owner's — and a
// batch still on legacy identity belongs to `curation migrate` first, because a line this pass
// appended under a path key would leave the Drive-ID lines standing beside it.
function decideCandidate(
  candidate: CurationSplitCandidate,
  observed: ObservedModuleRederivation,
): DecidedCandidate {
  if (candidate.identity === "legacy") {
    return {
      state: "legacy-identity",
      evidence: `The standing batch is keyed by ${candidate.sourceId} rather than by its unnumbered source path, so a line appended under contract-v4 identity would stand beside it rather than supersede it. Run curation migrate first.`,
    };
  }
  const source = observed.sources.get(candidate.key);
  if (source === undefined) {
    return {
      state: "missing-source",
      evidence: `Nothing in the mirror answers to ${candidate.key}, so this pass can compute no sha-256 to tell a copy from a cut; the standing lines and everything they placed are left exactly as they are.`,
    };
  }
  const comparable = candidate.lines
    .map(({ recordedSha256 }) => recordedSha256)
    .filter((digest) => digest !== undefined);
  if (comparable.length === 0) {
    return {
      state: "unprovable",
      evidence:
        "No line of the standing batch records a sha-256 this pass can compare, so nothing proves the batch was decided about the bytes now on the mount.",
    };
  }
  const disagreeing = comparable.filter((digest) => digest !== source.sha256);
  if (disagreeing.length > 0) {
    return {
      state: "changed",
      evidence: `The source bytes no longer match the sha-256 ${disagreeing.length} of ${comparable.length} standing lines recorded, so this is an update arrival for the curation walk to decide rather than a split to correct.`,
    };
  }
  const sorted = sortDestinations(candidate.lines, observed, source);
  if (sorted.derived.length === 0) return { state: "settled" };
  // Bytes alone cannot tell a chapter cut out of the source from the whole source placed and then
  // annotated, and MF-CURATION-002 says the second is told rather than closed. A batch holding a
  // destination that still hashes to the source has its whole copy accounted for, so everything
  // else is what the work produced; a batch holding none could have had its whole copy worked on,
  // and closing the item would retire a report the contract promises.
  if (sorted.copies.length === 0) {
    return {
      state: "unprovable",
      evidence: `No destination in the standing batch holds the source's own bytes, so this pass cannot tell ${sorted.derived.length} artifacts cut out of the source from a copy of it that was placed and then worked on. Closing the item would retire the standing divergence MF-CURATION-002 reports.`,
    };
  }
  return { state: "rederiving", source, ...sorted };
}

// Per destination, never per source: MF-CURATION-005's second paragraph, and the reason a split
// source that was also placed whole keeps the `curated` line that placed it. A destination holding
// the source's own bytes is a copy; one holding anything else is what the work produced.
//
// A destination the mount does not hold is named and left out of `derived`, because a `rederived`
// line asserting a path nobody read is the assertion a `withdrawn` line's absent checksum refuses.
// An unreadable recorded digest is named too, and costs its destination nothing: that digest is the
// *source's*, so it says whether the batch can be trusted rather than what the destination holds —
// refusing the item over one bad character would leave the whole source reporting every morning.
function sortDestinations(
  lines: readonly StandingCuratedLine[],
  observed: ObservedModuleRederivation,
  source: ObservedRederivationSource,
): SortedDestinations {
  const derived = new Set<string>();
  const copies = new Set<string>();
  const unreadable = new Set<string>();
  const missing = new Set<string>();
  for (const line of lines) {
    if (line.recordedSha256 === undefined) unreadable.add(line.destination);
    const observedSha256 = observed.artifacts.get(line.destination);
    if (observedSha256 === undefined) {
      missing.add(line.destination);
    } else if (observedSha256 === source.sha256) {
      copies.add(line.destination);
    } else {
      derived.add(line.destination);
    }
  }
  return {
    derived: [...derived].sort(),
    copies: [...copies].sort(),
    unreadable: [...unreadable].sort(),
    missing: [...missing].sort(),
  };
}

// The appended line is a decision written today rather than a standing event carried forward, so it
// is built field by field. Spreading the superseded line would put its `destination` onto a
// `rederived` line, which MF-CURATION-001 refuses and which would claim the item was both.
function rederivation(
  candidate: CurationSplitCandidate,
  decided: Extract<DecidedCandidate, { state: "rederiving" }>,
  now: string,
): PlannedCurationRederivation {
  const supersedes = `${candidate.sourceId}@${candidate.timestamp}`;
  const event = {
    schema_version: 3,
    source_id: candidate.unnumberedPath,
    integration: candidate.integration,
    role: candidate.standing.role,
    source_path: decided.source.sourcePath,
    checksum: renderChecksum(
      "sha256",
      decided.source.sha256,
      candidate.notation,
    ),
    decision: "rederived",
    derived: decided.derived,
    evidence: `MF-CURATION-005: one source worked into ${decided.derived.length} artifacts was recorded as a curated line apiece, so every walk compared each artifact against the whole source and reported a divergence the work itself put there. The superseded batch stays as the record of what was decided when.${copiesClause(decided.copies)}`,
    timestamp: now,
    supersedes,
  };
  return {
    key: candidate.key,
    integration: candidate.integration,
    sourcePath: candidate.sourcePath,
    sourceLocation: decided.source.location,
    supersedes,
    sha256: decided.source.sha256,
    derived: decided.derived,
    copies: decided.copies,
    unreadable: decided.unreadable,
    missing: decided.missing,
    line: JSON.stringify(event),
  };
}

function copiesClause(copies: readonly string[]): string {
  return copies.length === 0
    ? ""
    : ` ${copies.join(", ")} holds the source's own bytes and stays curated.`;
}
