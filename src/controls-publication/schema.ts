import { Ajv, type ValidateFunction } from "ajv";
import { controlSchemas } from "../controls/generated/schemas.js";
import {
  moduleCalendarDate,
  nativeNulFreeBytes,
} from "../controls/module-data-formats.js";
import { safeRelativePath } from "../controls/read-controls.js";
import { readStrictJson } from "../controls/strict-json.js";
import { canonicalBase64 } from "./codec.js";
import type {
  CreateResult,
  CreateWireInput,
  InspectResult,
  InspectWireInput,
  JournalEvent,
  PublicationBundle,
  PublishResult,
  PublishWireInput,
} from "./generated/publication-contract-1.js";
import { publicationSchemas } from "./generated/schemas.js";

export const publicationSchemaId = "urn:academic-os:publication-contract:1";
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: true });
ajv.addFormat("publication-base64", canonicalBase64);
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
for (const schema of [...controlSchemas, ...publicationSchemas])
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
  return {
    ...publicationSchemas[0],
    type: "object",
    $id: `${publicationSchemaId}:input:${name}`,
    $ref: `#/definitions/${name}`,
  };
}
