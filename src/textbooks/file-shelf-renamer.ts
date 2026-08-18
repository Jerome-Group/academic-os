import { lstat, rename } from "node:fs/promises";
import { basename, join } from "node:path";

import { OperationalError } from "../operational-error.js";
import type { ShelfRenamer } from "./types.js";

// The Owner's books are the one thing on the shelf that cannot be reconstructed, so a rename
// refuses anything it cannot prove safe: a name that is not a plain shelf filename, a source that
// is no longer there, and above all a target that already exists — `rename(2)` would replace it
// silently, and the replaced book is gone without passing through Drive Trash.
export function createFileShelfRenamer(shelfRoot: string): ShelfRenamer {
  return {
    rename: async ({ from, to }) => {
      const source = shelfPath(shelfRoot, from);
      const target = shelfPath(shelfRoot, to);
      if ((await entryAt(source)) !== "file") {
        throw refusal(`the book to rename is no longer on the shelf: ${from}`);
      }
      if ((await entryAt(target)) !== "absent") {
        throw refusal(`something on the shelf is already named ${to}`);
      }
      await rename(source, target);
    },
  };
}

function shelfPath(shelfRoot: string, file: string): string {
  if (file === "" || basename(file) !== file || file === "." || file === "..") {
    throw refusal(`${file} does not name a book directly on the shelf`);
  }
  return join(shelfRoot, file);
}

async function entryAt(path: string): Promise<"file" | "other" | "absent"> {
  try {
    return (await lstat(path)).isFile() ? "file" : "other";
  } catch {
    return "absent";
  }
}

function refusal(evidence: string): OperationalError {
  return new OperationalError(
    "operational-failure",
    `The shelf rename was refused: ${evidence}.`,
  );
}
