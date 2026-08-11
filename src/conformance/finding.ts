import { enforcementForRule } from "./rule-enforcement.js";
import type { ContractRuleId, Finding } from "./types.js";

export function deterministicFailure(
  ruleId: ContractRuleId,
  path: string,
  evidence: string,
  explanation: string,
): Finding {
  return {
    ruleId,
    enforcement: enforcementForRule(ruleId),
    status: "fail",
    severity: "error",
    path,
    evidence,
    explanation,
    applicability: "The inventory path is inside this rule's declared scope.",
  };
}

export function decisionFinding(
  ruleId: ContractRuleId,
  path: string,
  evidence: string,
  explanation: string,
): Finding {
  return {
    ruleId,
    enforcement: enforcementForRule(ruleId),
    status: "requires-decision",
    severity: "decision",
    path,
    evidence,
    explanation,
    applicability:
      "Observed evidence matches a contract case reserved for human judgment.",
  };
}

export function withDeterministicPass(
  findings: Finding[],
  ruleId: ContractRuleId,
  path: string,
  evidence: string,
  applicability: string,
): Finding[] {
  if (findings.length > 0) return findings;
  return [
    {
      ruleId,
      enforcement: enforcementForRule(ruleId),
      status: "pass",
      severity: "information",
      path,
      evidence,
      explanation: "No governed deviation was observed.",
      applicability,
    },
  ];
}
