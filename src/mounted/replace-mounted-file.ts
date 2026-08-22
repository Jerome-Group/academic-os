import { randomUUID } from "node:crypto";
import { open, rename, unlink, writeFile } from "node:fs/promises";

import { sha256 } from "../checksum.js";

// Drive for Desktop hands a mounted writer a filesystem and no ID surface, so a file's own bytes
// stand in for its identity: the caller says what it expects to be replacing, and the write only
// happens if that is still what is there. Overwriting in place would destroy the file without
// passing it through Drive Trash, so the contents arrive through a temporary and one rename.
export async function replaceMountedFile(input: {
  path: string;
  contents: string;
  expectedSha256: string;
  readContents(path: string): Promise<string | undefined>;
}): Promise<void> {
  const current = await input.readContents(input.path);
  if (current === undefined || sha256(current) !== input.expectedSha256) {
    throw new Error(
      "the copy changed after it was read for this run; nothing was written.",
    );
  }
  // Named for this write alone, so a temporary a crashed run left behind never blocks the next one.
  const temporary = `${input.path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(input.contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, input.path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

// A file that should not be there yet takes its name exclusively, which `rename` cannot do — it
// would clobber whatever arrived between the check and the write. `wx` fails instead.
export async function createMountedFile(input: {
  path: string;
  contents: string;
}): Promise<void> {
  try {
    await writeFile(input.path, input.contents, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    throw isErrorWithCode(error, "EEXIST")
      ? new Error("the name was taken before this run could write it.")
      : error;
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}
