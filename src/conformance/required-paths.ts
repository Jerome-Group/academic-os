import { enforcementForRule } from "./rule-enforcement.js";
import type {
  ContractRuleId,
  Finding,
  Inventory,
  InventoryEntryKind,
} from "./types.js";

export interface RequiredPathRule {
  ruleId: ContractRuleId;
  subject: string;
  applicability: string;
}

// One finding per required path, whatever names the requirement: present with the right kind
// passes, a wrong kind and an absent path each fail with the path as their evidence.
export function requiredPathFindings(
  inventory: Inventory,
  required: ReadonlyArray<readonly [string, InventoryEntryKind]>,
  rule: RequiredPathRule,
): Finding[] {
  const entriesByPath = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  return required.map(([path, expectedKind]) => {
    const entry = entriesByPath.get(path);
    if (entry === undefined) {
      return requiredPathFinding(rule, "fail", path, {
        evidence: `Inventory has no entry at ${path}.`,
        explanation: `The contract requires a ${expectedKind} at this path.`,
      });
    }
    if (entry.kind !== expectedKind) {
      return requiredPathFinding(rule, "fail", path, {
        evidence: `Inventory identifies ${path} as a ${entry.kind}.`,
        explanation: `The contract requires a ${expectedKind} at this path.`,
      });
    }
    return requiredPathFinding(rule, "pass", path, {
      evidence: `Inventory contains a ${expectedKind} at ${path}.`,
      explanation: `The required ${rule.subject} path is present with the required kind.`,
    });
  });
}

function requiredPathFinding(
  rule: RequiredPathRule,
  status: "pass" | "fail",
  path: string,
  { evidence, explanation }: { evidence: string; explanation: string },
): Finding {
  return {
    ruleId: rule.ruleId,
    enforcement: enforcementForRule(rule.ruleId),
    status,
    severity: status === "fail" ? "error" : "information",
    path,
    evidence,
    explanation,
    applicability: rule.applicability,
  };
}
