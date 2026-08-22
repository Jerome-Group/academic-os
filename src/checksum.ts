import { createHash } from "node:crypto";

// On a Drive mount a file has no stable ID, so its bytes stand in for its identity. This is what
// a plan records, what a write proves against, and what a journal carries.
export function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}
