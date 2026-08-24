import { readRecordedChecksum } from "./recorded-checksum.js";
import type {
  CurationIdentity,
  CurationItem,
  CurationRegisterLine,
} from "./types.js";
import { unnumberedSourcePath } from "./unnumbered-source-path.js";

// Each line kept beside the event it holds, because a reader that reports a problem reports where
// it is. Throws on a line that is not a JSON object, which is a register no pass may append to.
export function readCurationRegisterLines(
  source: string,
): CurationRegisterLine[] {
  const texts = source.split(/\r?\n/u);
  if (texts.at(-1) === "") texts.pop();
  return texts.map((text, index) => {
    const event: unknown = JSON.parse(text);
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new TypeError(`Line ${index + 1} is not a JSON object.`);
    }
    return {
      lineNumber: index + 1,
      text,
      event: event as Record<string, unknown>,
    };
  });
}

// One item per contract-v4 path, carrying the line that currently stands for it. The register is
// append-only history read top to bottom, so the last line about an item is its standing decision
// and every earlier one is the past that produced it.
export function standingCurationItems(
  lines: readonly CurationRegisterLine[],
  importerRoots: readonly string[],
): CurationItem[] {
  const standing = new Map<string, CurationItem>();
  for (const line of lines) {
    const item = walkedItem(line, importerRoots);
    if (item !== undefined) standing.set(item.key, item);
  }
  return [...standing.values()];
}

// Only what an arrival walk can meet is this pass's business. A line whose integration is not a
// declared importer root — `historical-migration`, say — names something no walk goes looking for,
// so it can never be rediscovered as an arrival and is left exactly as it stands.
function walkedItem(
  line: CurationRegisterLine,
  importerRoots: readonly string[],
): CurationItem | undefined {
  const {
    integration,
    source_path: sourcePath,
    source_id: sourceId,
  } = line.event;
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
  const checksum = readRecordedChecksum(line.event.checksum);
  return {
    key: `${integration}/${unnumberedPath}`,
    integration,
    sourceId,
    sourcePath,
    unnumberedPath,
    identity: lineIdentity(sourceId, unnumberedPath, checksum),
    checksum,
    standing: line,
  };
}

function lineIdentity(
  sourceId: string,
  unnumberedPath: string,
  checksum: ReturnType<typeof readRecordedChecksum>,
): CurationIdentity {
  return sourceId === unnumberedPath && checksum?.algorithm === "sha256"
    ? "contract-v4"
    : "legacy";
}
