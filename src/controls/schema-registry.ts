import { Ajv, type ValidateFunction } from "ajv";
import {
  moduleCalendarDate,
  nativeNulFreeBytes,
} from "./module-data-formats.js";
import { controlSchemas } from "./generated/schemas.js";
import type { ModuleHead } from "./generated/module-head-1.js";
import type { ControlGeneration } from "./generated/control-generation-1.js";
import type { ModuleIdentity } from "./generated/module-identity-1.js";
import type { ModuleDataGeneration } from "./generated/control-generation-2.js";
import type { ModuleDataControl } from "./generated/module-data-1.js";
import { diagnostic, type ControlDiagnostic } from "./types.js";

export const headSchemaId = "urn:academic-os:module-head:1";
export const generationSchemaId = "urn:academic-os:control-generation:1";
export const identitySchemaId = "urn:academic-os:module-identity:1";
export const moduleDataGenerationSchemaId =
  "urn:academic-os:control-generation:2";
export const moduleDataSchemaId = "urn:academic-os:module-data:1";
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: true });
ajv.addFormat("module-calendar-date", moduleCalendarDate);
ajv.addFormat("native-nul-free-bytes", nativeNulFreeBytes);
for (const schema of controlSchemas) ajv.addSchema(schema);

export const validateHead = validator<ModuleHead>(headSchemaId);
export const validateGeneration =
  validator<ControlGeneration>(generationSchemaId);
export const validateIdentity = validator<ModuleIdentity>(identitySchemaId);
export const validateModuleDataGeneration = validator<ModuleDataGeneration>(
  moduleDataGenerationSchemaId,
);
export const validateModuleData =
  validator<ModuleDataControl>(moduleDataSchemaId);

function validator<T>(id: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(id);
  if (validate === undefined)
    throw new Error(`Missing built-in control schema ${id}.`);
  return validate;
}

export function schemaDiagnostics(
  validate: ValidateFunction,
  path: string,
): ControlDiagnostic[] {
  return (validate.errors ?? []).map((error) =>
    diagnostic(
      "invalid-control-schema",
      path,
      `${error.message ?? error.keyword}: ${JSON.stringify(error.params)}`,
      "Use the referenced supported schema and version; a readable envelope does not establish complete module conformance.",
      error.instancePath,
    ),
  );
}
