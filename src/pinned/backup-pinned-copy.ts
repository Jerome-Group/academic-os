import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256Bytes } from "../checksum.js";

export async function backupPinnedCopy(input: {
  stateRoot: string;
  runId: string;
  targetKind: "modules" | "research-projects";
  targetKey: string;
  relativePath: string;
  contents: Uint8Array;
  expectedSha256: string;
}): Promise<string> {
  const path = join(
    input.stateRoot,
    "backups",
    "pinned-documents",
    input.runId,
    input.targetKind,
    encodeURIComponent(input.targetKey),
    input.relativePath,
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, input.contents, {
    flag: "wx",
    mode: 0o600,
  });
  const backedUp = await readFile(path);
  if (sha256Bytes(backedUp) !== input.expectedSha256) {
    throw new Error(`Backup did not preserve original bytes at ${path}.`);
  }
  return path;
}
