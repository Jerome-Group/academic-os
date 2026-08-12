import assert from "node:assert/strict";

import type { ContractRuleId, Finding } from "../../src/conformance/index.js";

const marker = "academic-os-rule-evidence:";

export function recordFindingEvidence(
  findings: readonly Finding[],
  ...ruleIds: ContractRuleId[]
): void {
  for (const ruleId of ruleIds) {
    assert.ok(
      findings.some((finding) => finding.ruleId === ruleId),
      `Expected behavioural output for ${ruleId}.`,
    );
    record(ruleId);
  }
}

export function recordBehaviorEvidence(
  ruleId: ContractRuleId,
  assertion: () => void,
): void {
  assertion();
  record(ruleId);
}

export function readRuleEvidence(output: string): ContractRuleId[] {
  return [
    ...new Set(
      [...output.matchAll(/academic-os-rule-evidence:(MF-[A-Z]+-[0-9]{3})/gu)]
        .map((match) => match[1])
        .filter((ruleId): ruleId is ContractRuleId => ruleId !== undefined),
    ),
  ].sort();
}

export function assertCompleteRuleEvidence(
  actual: readonly ContractRuleId[],
  expected: readonly ContractRuleId[],
): void {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

function record(ruleId: ContractRuleId): void {
  console.log(`${marker}${ruleId}`);
}
