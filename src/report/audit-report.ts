import type { AuditResult, Finding } from "../conformance/index.js";
import type {
  HistoryDiagnostic,
  RecordedAuditObservation,
  ResolvedTarget,
} from "../mounted/index.js";
import type { ObservationComparison } from "../observation/index.js";

export interface JsonAuditReport {
  schemaVersion: 1;
  module: {
    code: string;
    semester: string;
  };
  outcome: AuditResult["outcome"];
  findings: Finding[];
  comparison: ObservationComparison;
  historyDiagnostics: HistoryDiagnostic[];
  observation: {
    schemaVersion: 1;
    ruleSetVersion: 1;
    contractVersion: number | "unavailable";
    reportProvenance: RecordedAuditObservation["observation"]["reportProvenance"];
  };
}

export function createJsonAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
  recorded: RecordedAuditObservation,
): JsonAuditReport {
  return {
    schemaVersion: 1,
    module: {
      code: target.module,
      semester: target.semester,
    },
    outcome: result.outcome,
    findings: result.findings,
    comparison: recorded.comparison,
    historyDiagnostics: recorded.historyDiagnostics,
    observation: {
      schemaVersion: recorded.observation.schemaVersion,
      ruleSetVersion: recorded.observation.ruleSetVersion,
      contractVersion: recorded.observation.contractVersion,
      reportProvenance: recorded.observation.reportProvenance,
    },
  };
}

export function renderHumanAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
  recorded: RecordedAuditObservation,
): string {
  const findings = result.findings.flatMap((finding) => [
    `[${finding.status}] ${finding.ruleId} ${finding.path}`,
    `  Enforcement: ${finding.enforcement}`,
    `  Severity: ${finding.severity}`,
    `  Evidence: ${finding.evidence}`,
    `  Explanation: ${finding.explanation}`,
    `  Applicability: ${finding.applicability}`,
  ]);
  return [
    `Audit ${target.module} (${target.semester})`,
    `Outcome: ${result.outcome}`,
    `Comparison: ${recorded.comparison.basis}`,
    `New findings: ${recorded.comparison.new.length}`,
    `Unchanged findings: ${recorded.comparison.unchanged.length}`,
    `Resolved findings: ${recorded.comparison.resolved.length}`,
    ...contractChangeLines(recorded.comparison),
    ...comparisonFindingLines(recorded.comparison),
    ...recorded.historyDiagnostics.map(
      ({ kind, path, message }) => `History [${kind}] ${path}: ${message}`,
    ),
    ...findings,
  ].join("\n");
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
  return findings.map(
    ({ ruleId, path, status }) =>
      `Comparison [${classification}] ${ruleId} ${path} (${status})`,
  );
}

export function exitCodeFor(result: AuditResult): 0 | 1 | 3 {
  switch (result.outcome) {
    case "conformant":
      return 0;
    case "deviation":
      return 1;
    case "requires-decision":
      return 3;
  }
}
