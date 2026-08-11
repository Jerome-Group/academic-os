import type { Finding, FindingStatus } from "./types.js";

export function controlFinding(
  ruleId: string,
  path: string,
  status: FindingStatus,
  evidence: string,
  explanation: string,
): Finding {
  return {
    ruleId,
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
  ruleId: string,
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
