import { Ajv } from "ajv";
import { nativeInventorySchemas } from "./generated/schemas.js";
import type { NativeScanRecord } from "./generated/native-scan-record-1.js";
import type { NativeInventory } from "./generated/native-inventory-1.js";

const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
for (const schema of nativeInventorySchemas) ajv.addSchema(schema);
const record = ajv.getSchema<NativeScanRecord>(
  "urn:academic-os:native-scan-record:1",
);
const inventory = ajv.getSchema<NativeInventory>(
  "urn:academic-os:native-inventory:1",
);
if (record === undefined || inventory === undefined)
  throw new Error("Missing bundled native inventory schemas.");
export function validateScanRecord(value: unknown): value is NativeScanRecord {
  return record?.(value) === true;
}
export const validateNativeInventory = inventory;
