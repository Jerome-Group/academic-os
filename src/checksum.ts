import { createHash } from "node:crypto";

// On a Drive mount a file has no stable ID, so its bytes stand in for its identity. This is what
// a plan records, what a write proves against, and what a journal carries.
export function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

// Source material is bytes rather than text — a slide deck is not decodable as UTF-8 — so what
// identifies one is hashed as it was read.
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Drive's own checksum is md5, and a register line written from a Drive listing recorded that one.
// Reading the bytes back the same way is how such a line proves its decision still stands.
export function md5Bytes(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}
