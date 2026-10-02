import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256Bytes } from "../checksum.js";
import { OperationalError } from "../operational-error.js";

const canonicalSource = new URL(
  "../../../docs/agents/safe-drive-testing.md",
  import.meta.url,
);
export const MAINTENANCE_SAFETY_FILENAME = "safe-drive-testing.md";

export interface MaintenanceSafetyEvidence {
  source: "docs/agents/safe-drive-testing.md";
  snapshotPath: string;
  sha256: string;
}

export async function stageMaintenanceSafetyEvidence(input: {
  artifacts: string;
  source?: URL;
}): Promise<MaintenanceSafetyEvidence> {
  const source = input.source ?? canonicalSource;
  const bytes = await readSource(source);
  const evidence: MaintenanceSafetyEvidence = {
    source: "docs/agents/safe-drive-testing.md",
    snapshotPath: join(input.artifacts, MAINTENANCE_SAFETY_FILENAME),
    sha256: sha256Bytes(bytes),
  };
  const file = await open(evidence.snapshotPath, "wx", 0o400);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await verifyMaintenanceSafetyEvidence(evidence, source);
  return evidence;
}

export async function verifyMaintenanceSafetyEvidence(
  evidence: MaintenanceSafetyEvidence,
  source: URL = canonicalSource,
): Promise<void> {
  const snapshot = await lstat(evidence.snapshotPath);
  if (
    !snapshot.isFile() ||
    snapshot.isSymbolicLink() ||
    (snapshot.mode & 0o777) !== 0o400
  ) {
    throw failure(
      "The maintenance safety snapshot must be an ordinary read-only file.",
    );
  }
  const [sourceBytes, snapshotBytes] = await Promise.all([
    readSource(source),
    readFile(evidence.snapshotPath),
  ]);
  if (
    sha256Bytes(sourceBytes) !== evidence.sha256 ||
    sha256Bytes(snapshotBytes) !== evidence.sha256
  ) {
    throw failure(
      "The maintenance safety source or snapshot changed; the session was not started.",
    );
  }
}

async function readSource(source: URL): Promise<Buffer> {
  try {
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Not an ordinary file.");
    const bytes = await readFile(source);
    if (new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim() === "")
      throw new Error("Empty procedure.");
    return bytes;
  } catch {
    throw failure(
      "The canonical maintenance safety procedure is unavailable; the session was not started.",
    );
  }
}

function failure(message: string): OperationalError {
  return new OperationalError("operational-failure", message);
}
