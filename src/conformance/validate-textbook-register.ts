import {
  CHAPTER_NAME_PATTERN,
  isChapterFileName,
  textbookChaptersPath,
} from "../contract/textbook-chapters.js";
import {
  extractionKeys,
  shelfOwnedKeys,
} from "../contract/textbook-register.js";
import { readControlDocument } from "./control-document.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import { isRecord, nonEmptyString } from "./value-shape.js";

const registerPath = moduleControlPaths.textbookRegister;
const shelfOwned = new Set(shelfOwnedKeys);
const recordedKeys = new Set<string>(extractionKeys);
// A number is recorded as the book prints it, so a roman numeral stays roman and an appendix keeps
// its letter; the chapter filename is where those become zero-padded arabic.
const PRINTED_NUMBER = /^(?:[IVXLCDM]+|\p{Lu})$/u;

export function validateTextbookRegister(
  source: string | undefined,
  moduleCode: string,
): Finding {
  if (source === undefined) {
    return failedControl("MF-TEXTBOOK-003", registerPath, [
      `No readable control exists at ${registerPath}.`,
    ]);
  }
  const parsed = readControlDocument(source);
  if ("problems" in parsed) {
    return failedControl("MF-TEXTBOOK-003", registerPath, parsed.problems);
  }
  const value = parsed.value;
  if (!isRecord(value) || !Array.isArray(value.extractions)) {
    return failedControl("MF-TEXTBOOK-003", registerPath, [
      "Textbook register requires an extractions sequence, empty at seed.",
    ]);
  }
  const entries = value.extractions;
  const chapters = new Map<string, number>();
  const problems = entries.flatMap((entry, index) =>
    entryProblems(entry, index + 1, { moduleCode, chapters }),
  );
  const books = new Set(
    entries.flatMap((entry) => (isRecord(entry) ? [entry.book] : [])),
  );
  return problems.length === 0
    ? controlFinding(
        "MF-TEXTBOOK-003",
        registerPath,
        "pass",
        `Textbook register records ${entries.length} extraction${entries.length === 1 ? "" : "s"} of ${books.size} book${books.size === 1 ? "" : "s"}.`,
        "Every cut cites the Book key it came from and the pages it was taken by.",
      )
    : failedControl("MF-TEXTBOOK-003", registerPath, problems);
}

// One entry is one cut, and each key is what a later reader traces the cut back by: the book it
// came from, the division as the book prints it, the pages that were taken, the file that came
// out, and the copy of the book they were taken from.
function entryProblems(
  entry: unknown,
  position: number,
  register: { moduleCode: string; chapters: Map<string, number> },
): string[] {
  if (!isRecord(entry)) return [`Extraction ${position} is not a mapping.`];
  const requirements: Array<[string, boolean, string]> = [
    ["book", nonEmptyString(entry.book), "must be a Shelf-index key"],
    [
      "number",
      isPrintedNumber(entry.number),
      "must be the number the book prints",
    ],
    [
      "title",
      nonEmptyString(entry.title),
      "must be the full title the book's contents give",
    ],
    [
      "pages",
      isAbsolutePageRange(entry.pages),
      "must be an inclusive [first, last] range of absolute PDF pages",
    ],
    [
      "file",
      isChapterFileName(String(entry.file), register.moduleCode),
      `must name one ${register.moduleCode}_${CHAPTER_NAME_PATTERN} in ${textbookChaptersPath}`,
    ],
    [
      "source_sha256",
      isSha256(entry.source_sha256),
      "must be the book's sha-256 at cut time",
    ],
  ];
  return [
    ...requirements.flatMap(([key, holds, requirement]) =>
      holds ? [] : [`Extraction ${position} ${key} ${requirement}.`],
    ),
    ...Object.keys(entry)
      .filter((key) => !recordedKeys.has(key))
      .map((key) => unknownKeyProblem(key, position)),
    ...alreadyRecordedProblem(entry.file, position, register.chapters),
  ];
}

function unknownKeyProblem(key: string, position: number): string {
  return shelfOwned.has(key)
    ? `Extraction ${position} carries ${key}, which the Shelf index owns; an entry cites a Book key rather than repeating what it holds.`
    : `Extraction ${position} carries ${key}, which is not part of a cut.`;
}

// One chapter file is the output of one cut, so a second entry claiming it describes a cut nobody
// can hold against the pages it names.
function alreadyRecordedProblem(
  file: unknown,
  position: number,
  chapters: Map<string, number>,
): string[] {
  if (typeof file !== "string") return [];
  const recordedBy = chapters.get(file);
  if (recordedBy === undefined) {
    chapters.set(file, position);
    return [];
  }
  return [
    `Extraction ${position} file ${file} is already recorded by extraction ${recordedBy}.`,
  ];
}

function isPrintedNumber(value: unknown): boolean {
  return typeof value === "string"
    ? PRINTED_NUMBER.test(value)
    : Number.isInteger(value) && Number(value) > 0;
}

function isAbsolutePageRange(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [first, last] = value as [unknown, unknown];
  return (
    Number.isInteger(first) &&
    Number.isInteger(last) &&
    Number(first) >= 1 &&
    Number(first) <= Number(last)
  );
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
