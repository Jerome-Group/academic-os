import type {
  CheatsheetCoverageItem,
  CheatsheetPriority,
  CoverageDisposition,
} from "./types.js";

const columns = [
  "item_id",
  "source_id",
  "locator",
  "topic_id",
  "priority",
  "disposition",
  "artifact_locator",
  "note",
] as const;
const priorities = new Set<CheatsheetPriority>([
  "required",
  "high",
  "useful",
  "extension",
]);
const dispositions = new Set<CoverageDisposition>([
  "verbatim",
  "condensed",
  "cross-reference",
  "excluded",
  "pending",
]);

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new Error("coverage contains an unterminated quoted cell.");
  }
  cells.push(cell);
  return cells;
}

export function parseCheatsheetCoverage(input: {
  csv: string;
  sourceIds: ReadonlySet<string>;
}): CheatsheetCoverageItem[] {
  const lines = input.csv.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const header = lines.shift();
  if (
    header === undefined ||
    csvCells(header).join(",") !== columns.join(",")
  ) {
    throw new Error(`coverage header must be ${columns.join(",")}.`);
  }
  const ids = new Set<string>();
  return lines.map((line, index) => {
    const cells = csvCells(line);
    if (cells.length !== columns.length) {
      throw new Error(`coverage line ${index + 2} has ${cells.length} cells.`);
    }
    const [
      id,
      sourceId,
      locator,
      topicId,
      priority,
      disposition,
      artifact,
      note,
    ] = cells;
    if (!id || ids.has(id)) {
      throw new Error(`coverage line ${index + 2} requires a unique item_id.`);
    }
    ids.add(id);
    if (!sourceId || !input.sourceIds.has(sourceId)) {
      throw new Error(`coverage item ${id} names an unknown source.`);
    }
    if (!locator || !topicId) {
      throw new Error(`coverage item ${id} requires locator and topic_id.`);
    }
    if (!priorities.has(priority as CheatsheetPriority)) {
      throw new Error(`coverage item ${id} has unknown priority.`);
    }
    if (!dispositions.has(disposition as CoverageDisposition)) {
      throw new Error(`coverage item ${id} has unknown disposition.`);
    }
    if (priority === "required" && disposition === "excluded") {
      throw new Error(`required coverage item ${id} cannot be excluded.`);
    }
    if (disposition === "excluded" && !note) {
      throw new Error(`excluded coverage item ${id} requires a reason.`);
    }
    if (disposition !== "excluded" && disposition !== "pending" && !artifact) {
      throw new Error(
        `included coverage item ${id} requires artifact_locator.`,
      );
    }
    return {
      id,
      sourceId,
      locator,
      topicId,
      priority: priority as CheatsheetPriority,
      disposition: disposition as CoverageDisposition,
      ...(artifact ? { artifactLocator: artifact } : {}),
      ...(note ? { note } : {}),
    };
  });
}
