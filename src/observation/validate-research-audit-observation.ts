import {
  researchContractRuleEnforcement,
  type ResearchFinding,
} from "../conformance/index.js";
import { isInventory } from "./validate-inventory.js";
import { isIsoTimestamp, isRecord } from "./validation-primitives.js";
import type { ResearchAuditObservation } from "./research-types.js";
import {
  researchObservationSchemaVersion,
  researchRuleSetVersion,
} from "./research-types.js";

export interface ResearchObservationEnvelope {
  observationType: "research-project-audit";
  schemaVersion: number;
  ruleSetVersion: number;
  target: {
    kind: string;
    projectKey: string;
    profile: string;
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

export function readResearchObservationEnvelope(
  value: unknown,
): ResearchObservationEnvelope | undefined {
  if (
    !isRecord(value) ||
    value.observationType !== "research-project-audit" ||
    !isRecord(value.target)
  ) {
    return undefined;
  }
  if (
    typeof value.schemaVersion !== "number" ||
    typeof value.ruleSetVersion !== "number" ||
    typeof value.target.kind !== "string" ||
    typeof value.target.projectKey !== "string" ||
    typeof value.target.profile !== "string" ||
    typeof value.target.identity !== "string"
  ) {
    return undefined;
  }
  return {
    observationType: "research-project-audit",
    schemaVersion: value.schemaVersion,
    ruleSetVersion: value.ruleSetVersion,
    target: {
      kind: value.target.kind,
      projectKey: value.target.projectKey,
      profile: value.target.profile,
      identity: value.target.identity,
    },
  };
}

export function isResearchAuditObservation(
  value: unknown,
): value is ResearchAuditObservation {
  const envelope = readResearchObservationEnvelope(value);
  if (envelope === undefined || !isRecord(value)) return false;
  return (
    envelope.schemaVersion === researchObservationSchemaVersion &&
    envelope.ruleSetVersion === researchRuleSetVersion &&
    envelope.target.kind === "research-project" &&
    ["generic", "ureca"].includes(envelope.target.profile) &&
    validContractVersion(value.contractVersion) &&
    isIsoTimestamp(value.observedAt) &&
    isResearchInventory(value.inventory, envelope.target.projectKey) &&
    isRecord(value.metadataAvailability) &&
    ["unavailable", "entry-specific"].includes(
      String(value.metadataAvailability.contentChecksums),
    ) &&
    typeof value.metadataAvailability.reason === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every(isResearchFinding) &&
    isRecord(value.reportProvenance) &&
    value.reportProvenance.producer === "@jerome-group/academic-os" &&
    value.reportProvenance.producerVersion === "0.1.0" &&
    value.reportProvenance.reportSchemaVersion === 1 &&
    value.reportProvenance.command === "audit"
  );
}

function isResearchInventory(value: unknown, projectKey: string): boolean {
  if (!isRecord(value) || value.projectKey !== projectKey) return false;
  return isInventory({ ...value, moduleCode: projectKey }, projectKey);
}

function validContractVersion(value: unknown): boolean {
  return (
    value === "unavailable" ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function isResearchFinding(value: unknown): value is ResearchFinding {
  if (!isRecord(value) || typeof value.ruleId !== "string") return false;
  const expectedEnforcement = Object.hasOwn(
    researchContractRuleEnforcement,
    value.ruleId,
  )
    ? researchContractRuleEnforcement[
        value.ruleId as keyof typeof researchContractRuleEnforcement
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
