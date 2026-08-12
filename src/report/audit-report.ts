import {
  supportedContractVersion,
  type AuditResult,
  type Finding,
  type InventoryProvenance,
} from "../conformance/index.js";
import type {
  HistoryDiagnostic,
  RecordedAuditObservation,
  ResolvedTarget,
} from "../mounted/index.js";
import type { ObservationComparison } from "../observation/index.js";

export interface JsonAuditReport {
  schemaVersion: 1;
  mode: "monitoring" | "target" | "migration";
  module: {
    code: string;
    semester: string;
  };
  outcome: AuditResult["outcome"];
  findings: Finding[];
  comparison: ObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
  inventoryProvenance: InventoryProvenance;
  observation: {
    schemaVersion: 1;
    ruleSetVersion: 1;
    contractVersion: number | "unavailable";
    reportProvenance: RecordedAuditObservation["observation"]["reportProvenance"];
  };
  lifecycle: {
    contractRelationship:
      | "same-contract"
      | "same-contract-deviation"
      | "same-contract-drift"
      | "historical-contract-gap"
      | "contract-version-unavailable"
      | "contract-version-upgrade";
  };
}

export function createJsonAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
  recorded: RecordedAuditObservation,
  mode: JsonAuditReport["mode"] = "target",
): JsonAuditReport {
  return {
    schemaVersion: 1,
    mode,
    module: {
      code: target.module,
      semester: target.semester,
    },
    outcome: result.outcome,
    findings: result.findings,
    comparison: recorded.comparison,
    historyDiagnostics: recorded.historyDiagnostics,
    inventoryProvenance:
      recorded.observation.inventory.provenance ?? syntheticProvenance(target),
    observation: {
      schemaVersion: recorded.observation.schemaVersion,
      ruleSetVersion: recorded.observation.ruleSetVersion,
      contractVersion: recorded.observation.contractVersion,
      reportProvenance: recorded.observation.reportProvenance,
    },
    lifecycle: {
      contractRelationship: contractRelationship(result, recorded, mode),
    },
  };
}

export function renderHumanAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
  recorded: RecordedAuditObservation,
  mode: JsonAuditReport["mode"] = "target",
): string {
  return renderHumanJsonAuditReport(
    createJsonAuditReport(target, result, recorded, mode),
  );
}

export function renderHumanJsonAuditReport(report: JsonAuditReport): string {
  const findings = report.findings.flatMap((finding) => [
    `[${finding.status}] ${finding.ruleId} ${finding.path}`,
    ...findingDetailLines(finding),
  ]);
  return [
    `Audit ${report.module.code} (${report.module.semester})`,
    `Mode: ${report.mode}`,
    `Outcome: ${report.outcome}`,
    `Inventory: ${report.inventoryProvenance.source} (${report.inventoryProvenance.completeness})`,
    `Inventory target: ${report.inventoryProvenance.target}`,
    `Excluded trashed items: ${report.inventoryProvenance.excludedTrashedItems}`,
    ...report.inventoryProvenance.diagnostics.map(
      ({ kind, severity, evidence }) =>
        `Inventory [${severity}] ${kind}: ${evidence}`,
    ),
    `Contract relationship: ${report.lifecycle.contractRelationship}`,
    `Comparison: ${report.comparison.basis}`,
    `New findings: ${report.comparison.new.length}`,
    `Unchanged findings: ${report.comparison.unchanged.length}`,
    `Resolved findings: ${report.comparison.resolved.length}`,
    ...contractChangeLines(report.comparison),
    ...comparisonFindingLines(report.comparison),
    ...report.historyDiagnostics.map(
      ({ kind, path, message }) => `History [${kind}] ${path}: ${message}`,
    ),
    ...findings,
  ].join("\n");
}

function syntheticProvenance(target: ResolvedTarget): InventoryProvenance {
  return {
    source: "synthetic",
    target: target.moduleRoot,
    completeness: "complete",
    diagnostics: [],
    excludedTrashedItems: 0,
  };
}

function contractRelationship(
  result: AuditResult,
  recorded: RecordedAuditObservation,
  mode: JsonAuditReport["mode"],
): JsonAuditReport["lifecycle"]["contractRelationship"] {
  const contractVersion = recorded.observation.contractVersion;
  if (mode === "migration" && contractVersion === "unavailable") {
    return "historical-contract-gap";
  }
  if (contractVersion === "unavailable") {
    return "contract-version-unavailable";
  }
  if (contractVersion !== supportedContractVersion) {
    return "contract-version-upgrade";
  }
  const comparison = recorded.comparison;
  if (
    comparison.basis === "compatible-observation" &&
    (comparison.new.length > 0 || comparison.resolved.length > 0)
  ) {
    return "same-contract-drift";
  }
  if (mode === "migration" && result.outcome !== "conformant") {
    return "historical-contract-gap";
  }
  return result.outcome === "conformant"
    ? "same-contract"
    : "same-contract-deviation";
}

function contractChangeLines(comparison: ObservationComparison): string[] {
  if (comparison.contractChange === undefined) return [];
  return [
    `Contract version: ${comparison.contractChange.from} -> ${comparison.contractChange.to}`,
  ];
}

function comparisonFindingLines(comparison: ObservationComparison): string[] {
  return [
    ...classificationLines("new", comparison.new),
    ...classificationLines("unchanged", comparison.unchanged),
    ...classificationLines("resolved", comparison.resolved),
  ];
}

function classificationLines(
  classification: "new" | "unchanged" | "resolved",
  findings: Finding[],
): string[] {
  return findings.flatMap((finding) => [
    `Comparison [${classification}] ${finding.ruleId} ${finding.path} (${finding.status})`,
    ...findingDetailLines(finding, "Comparison"),
  ]);
}

function findingDetailLines(finding: Finding, scope?: "Comparison"): string[] {
  const label = (name: string): string =>
    scope === undefined ? name : `${scope} ${name.toLowerCase()}`;
  return [
    `  ${label("Enforcement")}: ${finding.enforcement}`,
    `  ${label("Severity")}: ${finding.severity}`,
    `  ${label("Evidence")}: ${finding.evidence}`,
    `  ${label("Explanation")}: ${finding.explanation}`,
    `  ${label("Applicability")}: ${finding.applicability}`,
  ];
}

export function exitCodeForOutcome(
  outcome: AuditResult["outcome"] | "operational-failure",
): 0 | 1 | 2 | 3 {
  switch (outcome) {
    case "conformant":
      return 0;
    case "deviation":
      return 1;
    case "operational-failure":
      return 2;
    case "requires-decision":
      return 3;
  }
}
