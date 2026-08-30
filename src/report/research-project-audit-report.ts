import type {
  InventoryProvenance,
  ResearchFinding,
  ResearchProjectConformancePlan,
} from "../conformance/index.js";
import type { ResolvedResearchProject } from "../config/index.js";
import type {
  HistoryDiagnostic,
  RecordedResearchProjectAuditObservation,
} from "../mounted/index.js";
import type { ResearchObservationComparison } from "../observation/index.js";

export interface ResearchProjectAuditReport {
  schemaVersion: 1;
  mode: "research-project";
  project: { key: string; folder: string };
  outcome: ResearchProjectConformancePlan["outcome"];
  contractVersion: number | "unavailable";
  findings: ResearchProjectConformancePlan["findings"];
  proposedOperations: ResearchProjectConformancePlan["proposedOperations"];
  inventoryProvenance: InventoryProvenance;
  comparison: ResearchObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
  observation: {
    path: string;
    schemaVersion: 1;
    ruleSetVersion: 1;
    contractVersion: number | "unavailable";
    reportProvenance: RecordedResearchProjectAuditObservation["observation"]["reportProvenance"];
  };
}

export function createResearchProjectAuditReport(input: {
  project: ResolvedResearchProject;
  result: ResearchProjectConformancePlan;
  recorded: RecordedResearchProjectAuditObservation;
  inventoryProvenance: InventoryProvenance;
}): ResearchProjectAuditReport {
  return {
    schemaVersion: 1,
    mode: "research-project",
    project: {
      key: input.project.key,
      folder: input.project.folder,
    },
    outcome: input.result.outcome,
    contractVersion: input.result.contractVersion,
    findings: input.result.findings,
    proposedOperations: input.result.proposedOperations,
    inventoryProvenance: input.inventoryProvenance,
    comparison: input.recorded.comparison,
    historyDiagnostics: input.recorded.historyDiagnostics,
    observation: {
      path: input.recorded.observationPath,
      schemaVersion: input.recorded.observation.schemaVersion,
      ruleSetVersion: input.recorded.observation.ruleSetVersion,
      contractVersion: input.recorded.observation.contractVersion,
      reportProvenance: input.recorded.observation.reportProvenance,
    },
  };
}

export function renderHumanResearchProjectAuditReport(
  report: ResearchProjectAuditReport,
): string {
  return [
    `Audit ${report.project.folder} (${report.project.key})`,
    `Mode: ${report.mode}`,
    `Outcome: ${report.outcome}`,
    `Contract version: ${report.contractVersion}`,
    `Observation: ${report.observation.path}`,
    `Inventory: ${report.inventoryProvenance.source} (${report.inventoryProvenance.completeness})`,
    `Inventory target: ${report.inventoryProvenance.target}`,
    `Excluded trashed items: ${report.inventoryProvenance.excludedTrashedItems}`,
    ...report.inventoryProvenance.diagnostics.map(
      ({ kind, severity, evidence }) =>
        `Inventory [${severity}] ${kind}: ${evidence}`,
    ),
    `Comparison: ${report.comparison.basis}`,
    `New findings: ${report.comparison.new.length}`,
    `Unchanged findings: ${report.comparison.unchanged.length}`,
    `Resolved findings: ${report.comparison.resolved.length}`,
    ...contractChangeLines(report.comparison),
    ...comparisonFindingLines(report.comparison),
    ...report.historyDiagnostics.map(
      ({ kind, path, message }) => `History [${kind}] ${path}: ${message}`,
    ),
    ...report.findings.flatMap((finding) => [
      `[${finding.status}] ${finding.ruleId} ${finding.path}`,
      ...findingDetailLines(finding),
    ]),
  ].join("\n");
}

function contractChangeLines(
  comparison: ResearchObservationComparison,
): string[] {
  if (comparison.contractChange === undefined) return [];
  return [
    `Contract version: ${comparison.contractChange.from} -> ${comparison.contractChange.to}`,
  ];
}

function comparisonFindingLines(
  comparison: ResearchObservationComparison,
): string[] {
  return [
    ...classificationLines("new", comparison.new),
    ...classificationLines("unchanged", comparison.unchanged),
    ...classificationLines("resolved", comparison.resolved),
  ];
}

function classificationLines(
  classification: "new" | "unchanged" | "resolved",
  findings: ResearchFinding[],
): string[] {
  return findings.flatMap((finding) => [
    `Comparison [${classification}] ${finding.ruleId} ${finding.path} (${finding.status})`,
    ...findingDetailLines(finding, "Comparison"),
  ]);
}

function findingDetailLines(
  finding: ResearchFinding,
  scope?: "Comparison",
): string[] {
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
