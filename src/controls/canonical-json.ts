import { createHash } from "node:crypto";
import { readStrictJson } from "./strict-json.js";

export function encodeCanonicalJson(value: unknown): Uint8Array {
  const bytes = Buffer.from(encode(value, new Set()), "utf8");
  if (bytes.byteLength > 8 * 1024 * 1024) return bytes;
  const checked = readStrictJson(bytes, "academic-os-publication-json/1");
  if (checked.kind !== "read")
    throw new Error("Invalid publication JSON value.");
  return bytes;
}

function encode(value: unknown, parents: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0))
      throw new Error("Publication numbers must be safe integers.");
    return String(value);
  }
  if (typeof value !== "object" || parents.has(value))
    throw new Error("Unsupported publication JSON value.");
  parents.add(value);
  try {
    if (Array.isArray(value))
      return `[${value.map((item) => encode(item, parents)).join(",")}]`;
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Publication JSON requires plain objects.");
    return `{${Object.entries(value)
      .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([key, item]) => `${JSON.stringify(key)}:${encode(item, parents)}`)
      .join(",")}}`;
  } finally {
    parents.delete(value);
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digest(value: unknown): string {
  return sha256(encodeCanonicalJson(value));
}

export function freezeBytes(bytes: Uint8Array): {
  byteLength: number;
  byteSha256: string;
  bytesBase64: string;
} {
  return {
    byteLength: bytes.byteLength,
    byteSha256: sha256(bytes),
    bytesBase64: Buffer.from(bytes).toString("base64"),
  };
}

export function base64DecodedLength(value: string): number {
  return (
    (value.length / 4) * 3 -
    (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0)
  );
}

export function canonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  let last = 0;
  for (let index = 0; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code >= 65 && code <= 90) last = code - 65;
    else if (code >= 97 && code <= 122) last = code - 71;
    else if (code >= 48 && code <= 57) last = code + 4;
    else if (code === 43) last = 62;
    else if (code === 47) last = 63;
    else return false;
  }
  return (
    padding === 0 ||
    (end > 0 && (padding === 2 ? last % 16 === 0 : last % 4 === 0))
  );
}
