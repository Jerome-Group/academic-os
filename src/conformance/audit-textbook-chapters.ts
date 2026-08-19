import { basename } from "node:path";

import {
  CHAPTER_NAME_PATTERN,
  isChapterFileName,
  textbookChaptersPath,
} from "../contract/textbook-chapters.js";
import { deterministicFailure, withDeterministicPass } from "./finding.js";
import { isInsideRoot } from "./inventory-paths.js";
import type { Finding, Inventory } from "./types.js";

// The chapter home holds what the Textbook procedure cut, so the name of every file in it says
// which book, which division and which number it came out of. The Shelf index the key resolves
// through sits outside every module folder and the auditor never reaches for it: what a module can
// be held to is that its filenames carry a key, not that the shelf still spells it that way.
export function auditTextbookChapters(inventory: Inventory): Finding[] {
  const chapters = inventory.entries.filter(
    ({ path, kind }) =>
      kind === "file" && isInsideRoot(path, textbookChaptersPath),
  );
  const failures = chapters.flatMap(({ path }) =>
    isChapterFileName(basename(path), inventory.moduleCode)
      ? []
      : [
          deterministicFailure(
            "MF-TEXTBOOK-004",
            path,
            `Chapter filename ${basename(path)} does not match ${inventory.moduleCode}_${CHAPTER_NAME_PATTERN}.`,
            "A cut chapter names the Book key it resolves through, the book's own division word, its two-digit number or appendix letter, and its Title_Cased contents title.",
          ),
        ],
  );
  return withDeterministicPass(
    failures,
    "MF-TEXTBOOK-004",
    textbookChaptersPath,
    conformantChapters(chapters.length),
    "Chapter naming applies to every file in the module's chapter home.",
  );
}

function conformantChapters(count: number): string {
  return count === 1
    ? "The one cut chapter names the book, division and number it came from."
    : `All ${count} cut chapters name the book, division and number they came from.`;
}
