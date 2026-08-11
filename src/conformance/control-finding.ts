import type { ContractRuleId, Finding, FindingStatus } from "./types.js";
import { enforcementForRule } from "./rule-enforcement.js";

export function controlFinding(
  ruleId: ContractRuleId,
  path: string,
  status: FindingStatus,
  evidence: string,
  explanation: string,
): Finding {
  return {
    ruleId,
    enforcement: enforcementForRule(ruleId),
    status,
    severity:
      status === "requires-decision"
        ? "decision"
        : status === "fail"
          ? "error"
          : "information",
    path,
    evidence,
    explanation,
    applicability: "Module control validation applies to every module folder.",
  };
}

export function failedControl(
  ruleId: ContractRuleId,
  path: string,
  problems: string[],
): Finding {
  return controlFinding(
    ruleId,
    path,
    "fail",
    problems.join(" "),
    "The control does not match the supported contract shape.",
  );
}
