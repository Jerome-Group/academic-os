import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";

export async function checksumFile(
  path: string,
  observed?: BigIntStats,
): Promise<{ sha256: string; size: bigint }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = observed ?? (await handle.stat({ bigint: true }));
    assertUnchanged(metadata, await handle.stat({ bigint: true }), path);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0n;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      size += BigInt(bytesRead);
    }
    assertUnchanged(metadata, await handle.stat({ bigint: true }), path);
    assertUnchanged(metadata, await lstat(path, { bigint: true }), path);
    return { sha256: digest.digest("hex"), size };
  } finally {
    await handle.close();
  }
}

function assertUnchanged(
  observed: BigIntStats,
  current: BigIntStats,
  path: string,
): void {
  if (
    !current.isFile() ||
    observed.dev !== current.dev ||
    observed.ino !== current.ino ||
    observed.size !== current.size ||
    observed.mtimeNs !== current.mtimeNs ||
    observed.ctimeNs !== current.ctimeNs
  ) {
    throw new Error(`File changed while fingerprinting: ${path}.`);
  }
}
