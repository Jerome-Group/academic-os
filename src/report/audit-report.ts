import type { AuditResult, Finding } from "../conformance/index.js";
import type { ResolvedTarget } from "../mounted/index.js";

export interface JsonAuditReport {
  schemaVersion: 1;
  module: {
    code: string;
    semester: string;
  };
  outcome: AuditResult["outcome"];
  findings: Finding[];
}

export function createJsonAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
): JsonAuditReport {
  return {
    schemaVersion: 1,
    module: {
      code: target.module,
      semester: target.semester,
    },
    outcome: result.outcome,
    findings: result.findings,
  };
}

export function renderHumanAuditReport(
  target: ResolvedTarget,
  result: AuditResult,
): string {
  const findings = result.findings.flatMap((finding) => [
    `[${finding.status}] ${finding.ruleId} ${finding.path}`,
    `  Severity: ${finding.severity}`,
    `  Evidence: ${finding.evidence}`,
    `  Explanation: ${finding.explanation}`,
    `  Applicability: ${finding.applicability}`,
  ]);
  return [
    `Audit ${target.module} (${target.semester})`,
    `Outcome: ${result.outcome}`,
    ...findings,
  ].join("\n");
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
