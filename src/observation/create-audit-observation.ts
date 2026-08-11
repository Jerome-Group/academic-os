import type { Finding, InventoryEntry } from "../conformance/index.js";
import {
  type AuditObservation,
  type CreateAuditObservationInput,
  observationSchemaVersion,
  ruleSetVersion,
} from "./types.js";

export function createAuditObservation(
  input: CreateAuditObservationInput,
): AuditObservation {
  return {
    schemaVersion: observationSchemaVersion,
    ruleSetVersion,
    contractVersion: input.contractVersion,
    target: input.target,
    observedAt: input.observedAt,
    inventory: {
      moduleCode: input.inventory.moduleCode,
      entries: [...input.inventory.entries].sort(compareInventoryEntries),
      ...(input.inventory.excludedEntries === undefined
        ? {}
        : {
            excludedEntries: [...input.inventory.excludedEntries].sort(
              compareInventoryEntries,
            ),
          }),
      ...(input.inventory.provenance === undefined
        ? {}
        : { provenance: input.inventory.provenance }),
    },
    metadataAvailability:
      input.inventory.provenance?.source === "drive-api"
        ? {
            contentChecksums: "entry-specific",
            reason:
              "Each Drive inventory entry records whether a provider checksum was observed.",
          }
        : {
            contentChecksums: "unavailable",
            reason: "Mounted audits do not read academic file contents.",
          },
    findings: [...input.findings].sort(compareFindings),
    reportProvenance: {
      producer: "@jerome-group/academic-os",
      producerVersion: "0.1.0",
      reportSchemaVersion: 1,
      command: "audit",
    },
  };
}

export function compareFindings(left: Finding, right: Finding): number {
  return findingKey(left).localeCompare(findingKey(right));
}

export function findingKey(finding: Finding): string {
  return [
    finding.ruleId,
    finding.path,
    finding.status,
    finding.severity,
    finding.enforcement,
    finding.evidence,
    finding.explanation,
    finding.applicability,
  ].join("\u0000");
}

function compareInventoryEntries(
  left: InventoryEntry,
  right: InventoryEntry,
): number {
  return left.path.localeCompare(right.path);
}
