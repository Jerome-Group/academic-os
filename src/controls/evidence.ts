import { createHash } from "node:crypto";
import type { ControlEvidence, ControlObservation } from "./types.js";

export function byteSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function controlEvidence(
  files: readonly ControlObservation[],
): ControlEvidence[] {
  return files.flatMap((file) =>
    file.kind === "file"
      ? [
          {
            path: file.path,
            byteLength: file.bytes.byteLength,
            sha256: byteSha256(file.bytes),
            bytesBase64: Buffer.from(file.bytes).toString("base64"),
          },
        ]
      : [],
  );
}
