import { readRecordedChecksum } from "./recorded-checksum.js";
import type { CurationSplitCandidate } from "./rederivation-types.js";
import type { CurationItem } from "./types.js";

// The items whose standing batch is more than one `curated` line. A batch is what one pass appended
// for one item — every line carrying that item's last `source_id` and `timestamp` — and a batch
// naming several destinations is the shape MF-CURATION-005 governs: one source worked into several
// artifacts, filed as though each artifact were a copy of it.
//
// Keyed off the last batch rather than off every `curated` line the register ever held, because the
// earlier ones are superseded history: a destination a later pass moved away from is not a copy
// this correction has anything to say about.
export function curationSplitCandidates(
  items: readonly CurationItem[],
): CurationSplitCandidate[] {
  const candidates: CurationSplitCandidate[] = [];
  for (const [, batch] of standingBatches(items)) {
    const candidate = splitCandidate(batch);
    if (candidate !== undefined) candidates.push(candidate);
  }
  return candidates;
}

// One item's last batch, in register order. `Map` keeps insertion order, so the candidates a plan
// reports come out in the order the register introduced them rather than in a hash's order.
function standingBatches(
  items: readonly CurationItem[],
): Map<string, CurationItem[]> {
  const latest = new Map<string, CurationItem[]>();
  for (const item of items) {
    const held = latest.get(item.key);
    if (held === undefined || !sameBatch(held[0], item)) {
      latest.set(item.key, [item]);
      continue;
    }
    held.push(item);
  }
  return latest;
}

function sameBatch(
  left: CurationItem | undefined,
  right: CurationItem,
): boolean {
  return (
    left !== undefined &&
    left.sourceId === right.sourceId &&
    timestampOf(left) === timestampOf(right)
  );
}

function splitCandidate(
  batch: readonly CurationItem[],
): CurationSplitCandidate | undefined {
  const first = batch[0];
  if (first === undefined) return undefined;
  const timestamp = timestampOf(first);
  if (timestamp === undefined) return undefined;
  const lines = batch.map(standingCuratedLine);
  if (lines.some((line) => line === undefined)) return undefined;
  const destinations = lines.map((line) => line?.destination);
  if (new Set(destinations).size < 2) return undefined;
  return {
    key: first.key,
    integration: first.integration,
    sourceId: first.sourceId,
    unnumberedPath: first.unnumberedPath,
    sourcePath: first.sourcePath,
    timestamp,
    identity: first.identity,
    notation: first.checksum?.notation ?? "bare",
    standing: first.standing,
    lines: lines.filter((line) => line !== undefined),
  };
}

// A batch holding anything but `curated` lines is not a split. A `rederived` line already closed
// the item, and a `withdrawn` or `source-only` one settled it some other way, so a batch mixing
// them is history this correction has no reading of and leaves alone.
function standingCuratedLine(item: CurationItem) {
  const { decision, destination } = item.standing;
  if (
    decision !== "curated" ||
    typeof destination !== "string" ||
    destination === ""
  ) {
    return undefined;
  }
  const recorded = readRecordedChecksum(item.standing.checksum);
  return {
    destination,
    recordedSha256:
      recorded?.algorithm === "sha256" ? recorded.value : undefined,
  };
}

function timestampOf(item: CurationItem): string | undefined {
  const { timestamp } = item.standing;
  return typeof timestamp === "string" && timestamp !== ""
    ? timestamp
    : undefined;
}
