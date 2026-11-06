import { Ajv, type ValidateFunction } from "ajv";
import { controlSchemas } from "../controls/generated/schemas.js";
import {
  moduleCalendarDate,
  nativeNulFreeBytes,
} from "../controls/module-data-formats.js";
import { safeRelativePath } from "../controls/read-controls.js";
import { readStrictJson } from "../controls/strict-json.js";
import { activitySchemas } from "../module-activity/generated/schemas.js";
import { base64DecodedLength, canonicalBase64 } from "./codec.js";
import type {
  HostInstallInput,
  HostRegistration,
  HostRegistrationInput,
  Record as NativeRecord,
  Policy,
  PolicySelector,
} from "./generated/native-source-contract-1.js";
import type {
  CreateResult,
  CreateWireInput,
  InspectResult,
  InspectWireInput,
  JournalEvent,
  PublicationBundle,
  PublicationRecord,
  PublishResult,
  PublishWireInput,
} from "./generated/publication-contract-1.js";
import type { RuntimeConsistency } from "./generated/runtime-consistency-1.js";
import { publicationSchemas } from "./generated/schemas.js";

import { maximumInputBase64Characters, maximumInputBytes } from "./limits.js";

export function publicationInputBase64(value: string): boolean {
  return (
    value.length <= maximumInputBase64Characters &&
    canonicalBase64(value) &&
    base64DecodedLength(value) <= maximumInputBytes
  );
}

export const publicationSchemaId = "urn:academic-os:publication-contract:1";
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: true });
ajv.addFormat("publication-base64", canonicalBase64);
ajv.addFormat("publication-input-base64", publicationInputBase64);
ajv.addFormat("publication-raw-name", (value: string) => {
  if (!canonicalBase64(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return (
    bytes.length > 0 &&
    !bytes.includes(0) &&
    !bytes.includes(47) &&
    !bytes.equals(Buffer.from(".")) &&
    !bytes.equals(Buffer.from(".."))
  );
});
ajv.addFormat("publication-relative-path", safeRelativePath);
ajv.addFormat("module-calendar-date", moduleCalendarDate);
ajv.addFormat("native-nul-free-bytes", nativeNulFreeBytes);
for (const schema of [
  ...controlSchemas,
  ...activitySchemas,
  ...publicationSchemas,
])
  ajv.addSchema(schema);

function validator<T>(name: string): ValidateFunction<T> {
  const result = ajv.getSchema<T>(
    `${publicationSchemaId}#/definitions/${name}`,
  );
  if (result === undefined)
    throw new Error(`Missing publication schema ${name}.`);
  return result;
}

export const validateCreateInput =
  validator<CreateWireInput>("CreateWireInput");
export const validatePublishInput =
  validator<PublishWireInput>("PublishWireInput");
export const validateInspectInput =
  validator<InspectWireInput>("InspectWireInput");
export const validateBundle = validator<PublicationBundle>("PublicationBundle");
export const validateEvent = validator<JournalEvent>("JournalEvent");
export type MixedRecord = PublicationRecord | NativeRecord;
export type MixedEvent = Omit<JournalEvent, "record"> & { record: MixedRecord };
export const nativeSchemaId = "urn:academic-os:native-source-contract:1";
ajv.addSchema({
  $id: "urn:academic-os:mixed-publication-event:1",
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    sequence: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    previousEventByteSha256: {
      anyOf: [{ type: "null" }, { type: "string", pattern: "^[a-f0-9]{64}$" }],
    },
    record: {
      oneOf: [
        { $ref: `${publicationSchemaId}#/definitions/PublicationRecord` },
        { $ref: `${nativeSchemaId}#/definitions/Record` },
      ],
    },
  },
  required: ["schemaVersion", "sequence", "previousEventByteSha256", "record"],
  additionalProperties: false,
});
function requiredValidator<T>(id: string): ValidateFunction<T> {
  const result = ajv.getSchema<T>(id);
  if (!result) throw new Error(`Missing built-in schema ${id}.`);
  return result;
}
export const validateMixedEvent = requiredValidator<MixedEvent>(
  "urn:academic-os:mixed-publication-event:1",
);
export const validateHostInstallInput = requiredValidator<HostInstallInput>(
  `${nativeSchemaId}#/definitions/HostInstallInput`,
);
export const validateHostRegistrationInput =
  requiredValidator<HostRegistrationInput>(
    `${nativeSchemaId}#/definitions/HostRegistrationInput`,
  );
export const validatePolicy = requiredValidator<Policy>(
  `${nativeSchemaId}#/definitions/Policy`,
);
export const validatePolicySelector = requiredValidator<PolicySelector>(
  `${nativeSchemaId}#/definitions/PolicySelector`,
);
export const validateHostRegistration = requiredValidator<HostRegistration>(
  `${nativeSchemaId}#/definitions/HostRegistration`,
);
export const validateRuntimeConsistency = requiredValidator<RuntimeConsistency>(
  "urn:academic-os:runtime-consistency:1",
);
export const validateCreateResult = validator<CreateResult>("CreateResult");
export const validatePublishResult = validator<PublishResult>("PublishResult");
export const validateInspectResult = validator<InspectResult>("InspectResult");

export function parseBytes<T>(
  bytes: Uint8Array,
  validate: ValidateFunction<T>,
): T {
  const parsed = readStrictJson(bytes, publicationSchemaId);
  if (parsed.kind !== "read")
    throw new Error(parsed.diagnostics.map((item) => item.message).join(" "));
  if (!validate(parsed.value)) throw new Error(ajv.errorsText(validate.errors));
  return parsed.value;
}

export function wireSchema(
  name: "CreateWireInput" | "PublishWireInput" | "InspectWireInput",
): { type: "object"; [key: string]: unknown } {
  const contract = publicationSchemas.find(
    (schema) => schema.$id === publicationSchemaId,
  );
  if (contract === undefined)
    throw new Error("Missing built-in publication schema.");
  const input = contract.definitions[name];
  const available = new Map<string, unknown>(
    Object.entries(contract.definitions),
  );
  const selected = new Map<string, unknown>();
  const pending: unknown[] = [input];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null) continue;
    if ("$ref" in value && typeof value.$ref === "string") {
      if (!value.$ref.startsWith("#/definitions/"))
        throw new Error("Unsupported publication input schema reference.");
      const key = value.$ref.slice("#/definitions/".length);
      const definition = available.get(key);
      if (definition === undefined)
        throw new Error("Missing publication input schema definition.");
      if (!selected.has(key)) {
        selected.set(key, definition);
        pending.push(definition);
      }
    }
    pending.push(...Object.values(value));
  }
  return {
    ...input,
    $schema: contract.$schema,
    type: "object",
    $id: `${publicationSchemaId}:input:${name}`,
    ...(selected.size ? { definitions: Object.fromEntries(selected) } : {}),
  };
}
