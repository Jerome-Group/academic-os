import {
  base64DecodedLength,
  canonicalBase64,
  encodeCanonicalJson,
  sha256,
} from "../controls/canonical-json.js";

export {
  base64DecodedLength,
  canonicalBase64,
  freezeBytes,
  sha256,
} from "../controls/canonical-json.js";

import { refuse } from "./failure.js";
import type { FrozenBytes } from "./generated/publication-contract-1.js";
import { maximumEventBytes } from "./limits.js";

export const publicationEncoding = "academic-os-publication-json/1";
export function encodePublication(value: unknown): Uint8Array {
  const bytes = encodeCanonicalJson(value);
  if (bytes.byteLength > maximumEventBytes)
    refuse("invalid-controls", "Encoded publication JSON exceeds 8 MiB.");
  return bytes;
}
export function digest(value: unknown): string {
  return sha256(encodePublication(value));
}

export function thawBytes(value: FrozenBytes): Uint8Array {
  if (
    !canonicalBase64(value.bytesBase64) ||
    base64DecodedLength(value.bytesBase64) !== value.byteLength
  )
    throw new Error("Frozen byte length or digest mismatch.");
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (sha256(bytes) !== value.byteSha256)
    throw new Error("Frozen byte length or digest mismatch.");
  return bytes;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}
