import { contractRuleEnforcement } from "../conformance/rule-enforcement.js";
import type { Finding, InventoryEntry } from "../conformance/types.js";
import {
  type AuditObservation,
  observationSchemaVersion,
  ruleSetVersion,
} from "./types.js";

export interface ObservationEnvelope {
  schemaVersion: number;
  ruleSetVersion: number;
  target: {
    moduleCode: string;
    semester: string;
    identity: string;
  };
}

const findingStatuses = new Set([
  "pass",
  "fail",
  "warning",
  "manual-review",
  "requires-decision",
  "not-applicable",
]);
const findingSeverities = new Set([
  "information",
  "warning",
  "error",
  "decision",
]);
const inventoryEntryKinds = new Set(["directory", "file", "symlink", "other"]);

export function readObservationEnvelope(
  value: unknown,
): ObservationEnvelope | undefined {
  if (!isRecord(value) || !isRecord(value.target)) return undefined;
  if (
    typeof value.schemaVersion !== "number" ||
    typeof value.ruleSetVersion !== "number" ||
    typeof value.target.moduleCode !== "string" ||
    typeof value.target.semester !== "string" ||
    typeof value.target.identity !== "string"
  ) {
    return undefined;
  }
  return {
    schemaVersion: value.schemaVersion,
    ruleSetVersion: value.ruleSetVersion,
    target: {
      moduleCode: value.target.moduleCode,
      semester: value.target.semester,
      identity: value.target.identity,
    },
  };
}

export function isAuditObservation(value: unknown): value is AuditObservation {
  const envelope = readObservationEnvelope(value);
  if (envelope === undefined || !isRecord(value)) return false;
  return (
    envelope.schemaVersion === observationSchemaVersion &&
    envelope.ruleSetVersion === ruleSetVersion &&
    validContractVersion(value.contractVersion) &&
    isIsoTimestamp(value.observedAt) &&
    isInventory(value.inventory, envelope.target.moduleCode) &&
    isRecord(value.metadataAvailability) &&
    value.metadataAvailability.contentChecksums === "unavailable" &&
    typeof value.metadataAvailability.reason === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding) &&
    isRecord(value.reportProvenance) &&
    value.reportProvenance.producer === "@jerome-group/academic-os" &&
    value.reportProvenance.producerVersion === "0.1.0" &&
    value.reportProvenance.reportSchemaVersion === 1 &&
    value.reportProvenance.command === "audit"
  );
}

function validContractVersion(value: unknown): boolean {
  return (
    value === "unavailable" ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function isInventory(value: unknown, moduleCode: string): boolean {
  return (
    isRecord(value) &&
    value.moduleCode === moduleCode &&
    Array.isArray(value.entries) &&
    value.entries.every(isInventoryEntry)
  );
}

function isInventoryEntry(value: unknown): value is InventoryEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    inventoryEntryKinds.has(String(value.kind)) &&
    (value.size === undefined ||
      (typeof value.size === "number" &&
        Number.isInteger(value.size) &&
        value.size >= 0)) &&
    isIsoTimestamp(value.modifiedAt)
  );
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value) || typeof value.ruleId !== "string") return false;
  const expectedEnforcement = Object.hasOwn(
    contractRuleEnforcement,
    value.ruleId,
  )
    ? contractRuleEnforcement[
        value.ruleId as keyof typeof contractRuleEnforcement
      ]
    : undefined;
  return (
    expectedEnforcement !== undefined &&
    value.enforcement === expectedEnforcement &&
    findingStatuses.has(String(value.status)) &&
    findingSeverities.has(String(value.severity)) &&
    typeof value.path === "string" &&
    typeof value.evidence === "string" &&
    typeof value.explanation === "string" &&
    typeof value.applicability === "string"
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
