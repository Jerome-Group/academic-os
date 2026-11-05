import { isAbsolute } from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { readStrictJson } from "../controls/strict-json.js";
import {
  ConfigurationError,
  type ConfigurationDiagnostic,
} from "./configuration-error.js";
import { configurationSchema } from "./generated/schema.js";
import type {
  AcademicConfig,
  LoadedConfig,
  LocalConfig,
  ServiceConfig,
} from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat("absolute-path", isAbsolute);
ajv.addFormat("trimmed-string", (value: string) => value.trim() === value);
ajv.addFormat(
  "iso-instant",
  (value: string) => !Number.isNaN(new Date(value).valueOf()),
);
ajv.addSchema(configurationSchema);
const schemaId = configurationSchema.$id;
const validateLocal = validator<LocalConfig>("LocalConfig");
const validateAcademic = validator<AcademicConfig>("AcademicConfig");
const validateService = validator<ServiceConfig>("ServiceConfig");
function validator<T>(name: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(`${schemaId}#/definitions/${name}`);
  if (validate === undefined)
    throw new Error("Built-in configuration schema is missing.");
  return validate;
}
const safeFields = new Set(
  Object.values(configurationSchema.definitions).flatMap(({ properties }) =>
    Object.keys(properties),
  ),
);

export function parseConfig(bytes: Uint8Array): LoadedConfig {
  // Configuration v1 has no numeric fields except its safe integer version.
  const read = readStrictJson(bytes, "configuration");
  if (read.kind === "invalid") {
    throw failure(
      "invalid-json",
      "",
      "UTF-8 JSON with unique keys, Unicode scalar strings and safe integer literals",
      "Correct the JSON bytes; configuration values are not included in diagnostics.",
    );
  }
  return validateConfig(read.value);
}

export function validateConfig(value: unknown): LoadedConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure(
      "invalid-config-value",
      "",
      "a configuration object",
      "Use a supported local, cohort or service configuration.",
    );
  }
  if ("schemaVersion" in value && value.schemaVersion !== 1) {
    throw failure(
      "unsupported-config-version",
      "/schemaVersion",
      "supported schemaVersion 1 or the supported unversioned format",
      "Use a supported reader; do not rewrite private configuration automatically.",
    );
  }
  const local =
    "semester" in value || "module" in value || "semesterRoots" in value;
  const academic = "activeSemester" in value || "semesters" in value;
  if (local && academic) {
    throw failure(
      "conflicting-config-shapes",
      "",
      "one local target or one cohort shape",
      "Remove conflicting target declarations after reviewing the intended configuration.",
    );
  }
  if (academic) {
    if (validateAcademic(value)) return value;
    throw schemaFailure(validateAcademic.errors);
  }
  if (local) {
    if (validateLocal(value)) return value;
    throw schemaFailure(validateLocal.errors);
  }
  if (validateService(value)) return value;
  throw schemaFailure(validateService.errors);
}

export function requireLocalConfig(config: LoadedConfig): LocalConfig {
  if ("semester" in config) return config;
  throw failure(
    "invalid-config-value",
    "",
    "a configured local module target",
    "Use a local target configuration or an explicit cohort target.",
  );
}

function schemaFailure(
  errors: ErrorObject[] | null | undefined,
): ConfigurationError {
  return new ConfigurationError(
    (errors ?? []).map((error) => ({
      code: "invalid-config-value",
      pointer: safePointer(error.instancePath),
      expected:
        error.keyword === "required"
          ? `required field ${safeField(error.params.missingProperty)}`
          : error.keyword === "additionalProperties"
            ? "supported fields only"
            : `the ${error.keyword} constraint in ${error.schemaPath}`,
      remediation:
        "Follow src/config/schemas/configuration-1.schema.json; supplied values are redacted.",
    })),
  );
}

function safePointer(pointer: string): string {
  return pointer
    .split("/")
    .map((part, index) =>
      index === 0 ? "" : safeFields.has(part) ? part : "*",
    )
    .join("/");
}
function safeField(value: unknown): string {
  return typeof value === "string" && safeFields.has(value) ? value : "*";
}
function failure(
  code: ConfigurationDiagnostic["code"],
  pointer: string,
  expected: string,
  remediation: string,
): ConfigurationError {
  return new ConfigurationError([{ code, pointer, expected, remediation }]);
}
