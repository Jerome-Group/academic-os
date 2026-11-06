import { Ajv, type ValidateFunction } from "ajv";
import { activitySchemas } from "../module-activity/generated/schemas.js";
import type { FrozenBytes } from "../module-activity/generated/workflow.js";
import {
  base64DecodedLength,
  canonicalBase64,
  encodeCanonicalJson,
  sha256,
} from "./canonical-json.js";
import { controlSchemas } from "./generated/schemas.js";
import {
  moduleCalendarDate,
  nativeNulFreeBytes,
} from "./module-data-formats.js";
import { readStrictJson } from "./strict-json.js";

export const maximumActivityBytes = 8_388_608;
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat("module-calendar-date", moduleCalendarDate);
ajv.addFormat("native-nul-free-bytes", nativeNulFreeBytes);
ajv.addFormat("publication-base64", canonicalBase64);
for (const schema of [...controlSchemas, ...activitySchemas])
  ajv.addSchema(schema);

export function activityValidator<T>(name: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(
    `urn:academic-os:module-activity:1#/definitions/${name}`,
  );
  if (!validate) throw new Error(`Unknown activity schema ${name}.`);
  return validate;
}

export function requireActivitySize(value: unknown): Uint8Array {
  measureActivityWire(value);
  const bytes = encodeCanonicalJson(value);
  if (bytes.byteLength > maximumActivityBytes)
    throw new Error(
      `Complete activity packet measured ${bytes.byteLength} bytes; limit ${maximumActivityBytes}.`,
    );
  return bytes;
}

export function parseActivity<T>(value: unknown, name: string): T {
  requireActivitySize(value);
  const validate = activityValidator<T>(name);
  if (!validate(value))
    throw new Error(`Invalid ${name}: ${ajv.errorsText(validate.errors)}.`);
  checkFrozen(value);
  return value;
}

function checkFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if ("bytesBase64" in value) {
    if (
      !("byteLength" in value) ||
      !("byteSha256" in value) ||
      typeof value.bytesBase64 !== "string" ||
      typeof value.byteLength !== "number" ||
      typeof value.byteSha256 !== "string"
    )
      throw new Error("Malformed frozen byte binding.");
    activityBytes({
      bytesBase64: value.bytesBase64,
      byteLength: value.byteLength,
      byteSha256: value.byteSha256,
    });
    return;
  }
  for (const child of Object.values(value)) checkFrozen(child);
}

export function activityBytes(value: FrozenBytes): Uint8Array {
  if (
    value.bytesBase64.length > 11_184_812 ||
    value.byteLength > maximumActivityBytes ||
    !canonicalBase64(value.bytesBase64) ||
    base64DecodedLength(value.bytesBase64) !== value.byteLength
  )
    throw new Error(
      `Frozen activity bytes exceed limit ${maximumActivityBytes} or exact decoded length differs.`,
    );
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (sha256(bytes) !== value.byteSha256)
    throw new Error("Frozen activity byte digest differs.");
  return bytes;
}

export function readActivityJson(bytes: Uint8Array): unknown {
  const parsed = readStrictJson(bytes, "module-activity");
  if (parsed.kind !== "read")
    throw new Error(parsed.diagnostics.map((d) => d.message).join(" "));
  return parsed.value;
}

export function activityWireSchema(name: string): {
  type: "object";
  [key: string]: unknown;
} {
  const contract = activitySchemas[0];
  if (!contract || !(name in contract.definitions))
    throw new Error(`Unknown activity definition ${name}.`);
  return {
    type: "object",
    $schema: contract.$schema,
    $id: `urn:academic-os:module-activity:wire:${name}`,
    allOf: [{ $ref: `#/definitions/${name}` }],
    definitions: contract.definitions,
  };
}

export function measureActivityWire(
  value: unknown,
  maximumBytes = maximumActivityBytes,
): number {
  let measured = 0;
  const parents = new Set<object>();
  const add = (count: number) => {
    measured += count;
    if (measured > maximumBytes)
      throw new Error(
        `Complete activity packet measured at least ${measured} bytes; limit ${maximumBytes}.`,
      );
  };
  const string = (text: string) => {
    add(2);
    for (const scalar of text) {
      const code = scalar.codePointAt(0) ?? 0;
      if (code >= 0xd800 && code <= 0xdfff)
        throw new Error("Invalid Unicode scalar.");
      add(
        code < 32
          ? [8, 9, 10, 12, 13].includes(code)
            ? 2
            : 6
          : code === 34 || code === 92
            ? 2
            : Buffer.byteLength(scalar),
      );
    }
  };
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      string(item);
      return;
    }
    if (
      item === null ||
      typeof item === "boolean" ||
      typeof item === "number"
    ) {
      add(JSON.stringify(item).length);
      return;
    }
    if (!item || typeof item !== "object" || parents.has(item))
      throw new Error("Unsupported activity packet value.");
    parents.add(item);
    if (
      "bytes" in item &&
      item.bytes instanceof Uint8Array &&
      "byteLength" in item &&
      "byteSha256" in item
    ) {
      const size = item.bytes.byteLength;
      if (size > maximumActivityBytes)
        throw new Error(
          `Activity bytes measured ${size}; limit ${maximumBytes}.`,
        );
      visit({ byteLength: item.byteLength, byteSha256: item.byteSha256 });
      add(-1);
      string("bytesBase64");
      add(4 + 4 * Math.ceil(size / 3) + 1);
    } else if (Array.isArray(item)) {
      add(2 + Math.max(0, item.length - 1));
      for (const child of item) visit(child);
    } else {
      const entries = Object.entries(item);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, child] of entries) {
        string(key);
        add(1);
        visit(child);
      }
    }
    parents.delete(item);
  };
  visit(value);
  return measured;
}
