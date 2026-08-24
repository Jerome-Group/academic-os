import { readRecordedChecksum } from "./recorded-checksum.js";
import type {
  CurationIdentity,
  CurationItem,
  CurationRegisterEvent,
} from "./types.js";
import { unnumberedSourcePath } from "./unnumbered-source-path.js";

// Throws on a line that is not a JSON object, which is a register no pass may append to; the
// caller's own validation is what turns that into a reported blocker.
export function readCurationRegisterEvents(
  source: string,
): CurationRegisterEvent[] {
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    const event: unknown = JSON.parse(line);
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new TypeError(`Line ${index + 1} is not a JSON object.`);
    }
    return event as CurationRegisterEvent;
  });
}

// Every event an arrival walk could meet, in the order the register holds them. An event whose
// integration is not a declared importer root — `historical-migration`, say — names something no
// walk goes looking for, so it can never be rediscovered as an arrival and is not one of these.
export function walkedCurationItems(
  events: readonly CurationRegisterEvent[],
  importerRoots: readonly string[],
): CurationItem[] {
  return events
    .map((event) => walkedItem(event, importerRoots))
    .filter((item): item is CurationItem => item !== undefined);
}

// One item per contract-v4 path, carrying the event that currently stands for it. The register is
// append-only history read top to bottom, so the last event about an item is its standing decision
// and every earlier one is the past that produced it.
export function standingCurationItems(
  items: readonly CurationItem[],
): CurationItem[] {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

function walkedItem(
  event: CurationRegisterEvent,
  importerRoots: readonly string[],
): CurationItem | undefined {
  const { integration, source_path: sourcePath, source_id: sourceId } = event;
  if (
    typeof integration !== "string" ||
    typeof sourcePath !== "string" ||
    typeof sourceId !== "string" ||
    sourcePath === "" ||
    sourceId === "" ||
    !importerRoots.includes(integration)
  ) {
    return undefined;
  }
  const unnumberedPath = unnumberedSourcePath(sourcePath);
  const checksum = readRecordedChecksum(event.checksum);
  return {
    key: `${integration}/${unnumberedPath}`,
    integration,
    sourceId,
    sourcePath,
    unnumberedPath,
    identity: eventIdentity(sourceId, unnumberedPath, checksum),
    checksum,
    standing: event,
  };
}

function eventIdentity(
  sourceId: string,
  unnumberedPath: string,
  checksum: ReturnType<typeof readRecordedChecksum>,
): CurationIdentity {
  return sourceId === unnumberedPath && checksum?.algorithm === "sha256"
    ? "contract-v4"
    : "legacy";
}
