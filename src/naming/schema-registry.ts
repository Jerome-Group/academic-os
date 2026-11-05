import { Ajv, type ValidateFunction } from "ajv";
import { controlSchemas } from "../controls/generated/schemas.js";
import { namingSchemas } from "./generated/schemas.js";
import type { NamingRequest } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
for (const schema of [...controlSchemas, ...namingSchemas])
  ajv.addSchema(schema);
const validator = ajv.getSchema<NamingRequest>(
  "urn:academic-os:naming-request:1",
);
if (validator === undefined) throw new Error("Missing built-in naming schema.");
export const validateNamingRequest: ValidateFunction<NamingRequest> = validator;
