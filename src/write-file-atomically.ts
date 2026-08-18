import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// A half-written control file is worse than an unwritten one, so the write lands beside its
// destination under a name nothing reads and becomes the file in one rename.
export async function writeFileAtomically(
  path: string,
  contents: string,
): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
