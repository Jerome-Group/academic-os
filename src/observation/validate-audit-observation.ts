import { contractRuleEnforcement } from "../conformance/rule-enforcement.js";
import type { Finding } from "../conformance/types.js";
import {
  type AuditObservation,
  observationSchemaVersion,
  ruleSetVersion,
} from "./types.js";
import { isInventory } from "./validate-inventory.js";
import { isIsoTimestamp, isRecord } from "./validation-primitives.js";

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
    ["unavailable", "entry-specific"].includes(
      String(value.metadataAvailability.contentChecksums),
    ) &&
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
