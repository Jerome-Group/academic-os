import { lstat, readFile } from "node:fs/promises";

import { md5Bytes, sha256Bytes } from "../checksum.js";

// A source item's digests, or nothing where there is no ordinary file to read. Both are computed
// from one reading, because the two conventions this pass bridges name the same bytes differently.
export async function hashSource(
  path: string,
): Promise<{ sha256: string; md5: string } | undefined> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    metadata === undefined ||
    metadata.isSymbolicLink() ||
    !metadata.isFile()
  ) {
    return undefined;
  }
  const bytes = await readFile(path).catch(() => undefined);
  return bytes === undefined
    ? undefined
    : { sha256: sha256Bytes(bytes), md5: md5Bytes(bytes) };
}
