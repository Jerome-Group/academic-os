import type { InventoryEntry, ResearchFinding } from "../conformance/index.js";
import type {
  CreateResearchAuditObservationInput,
  ResearchAuditObservation,
} from "./research-types.js";
import {
  researchObservationSchemaVersion,
  researchRuleSetVersion,
} from "./research-types.js";

export function createResearchAuditObservation(
  input: CreateResearchAuditObservationInput,
): ResearchAuditObservation {
  return {
    observationType: "research-project-audit",
    schemaVersion: researchObservationSchemaVersion,
    ruleSetVersion: researchRuleSetVersion,
    contractVersion: input.contractVersion,
    target: input.target,
    observedAt: input.observedAt,
    inventory: {
      projectKey: input.inventory.projectKey,
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
    findings: [...input.findings].sort(compareResearchFindings),
    reportProvenance: {
      producer: "@jerome-group/academic-os",
      producerVersion: "0.1.0",
      reportSchemaVersion: 1,
      command: "audit",
    },
  };
}

export function compareResearchFindings(
  left: ResearchFinding,
  right: ResearchFinding,
): number {
  return researchFindingKey(left).localeCompare(researchFindingKey(right));
}

export function researchFindingKey(finding: ResearchFinding): string {
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
