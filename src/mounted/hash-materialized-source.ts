import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { ensureMaterialized } from "./ensure-materialized.js";
import { resolveSafeFile } from "./read-safe-file.js";
import { OperationalError } from "../operational-error.js";

export async function hashMaterializedSource(
  root: string,
  file: string,
): Promise<{ byteLength: number; sha256: string }> {
  const path = await resolveSafeFile(root, file.split("/"), "Exercise source");
  await ensureMaterialized(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size === 0)
      throw new OperationalError(
        "invalid-target",
        `Source has no ordinary materialized bytes: ${file}.`,
      );
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      byteLength += chunk.length;
    }
    const after = await lstat(path);
    const descriptor = await handle.stat();
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== byteLength ||
      before.size !== descriptor.size ||
      before.mtimeMs !== descriptor.mtimeMs ||
      before.ctimeMs !== descriptor.ctimeMs ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (await realpath(path)) !== path
    )
      throw new OperationalError(
        "invalid-target",
        `Source changed during selection: ${file}.`,
      );
    return { byteLength, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}
