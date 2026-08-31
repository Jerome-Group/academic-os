import assert from "node:assert/strict";
import { researchEnforcementForRule } from "../../src/conformance/index.js";
import type {
  ContractRuleId,
  Finding,
  ResearchContractRuleId,
  ResearchFinding,
} from "../../src/conformance/index.js";

const marker = "academic-os-rule-evidence:";
const researchMarker = "academic-os-research-rule-evidence:";

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

export function recordResearchFindingEvidence(
  findings: readonly ResearchFinding[],
  ...ruleIds: ResearchContractRuleId[]
): void {
  for (const ruleId of ruleIds) {
    const alternate = findings.find(
      (finding) =>
        finding.ruleId === ruleId &&
        ["fail", "warning", "requires-decision"].includes(finding.status),
    );
    assert.ok(
      alternate !== undefined,
      `Expected non-pass output for ${ruleId}.`,
    );
    assert.equal(alternate.enforcement, "deterministic");
    recordResearch(ruleId);
  }
}

export function recordResearchBehaviorEvidence(
  ruleId: ResearchContractRuleId,
  assertion: () => void,
): void {
  assert.equal(researchEnforcementForRule(ruleId), "deterministic");
  assertion();
  recordResearch(ruleId);
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
  actual: readonly string[],
  expected: readonly string[],
): void {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

export function readResearchRuleEvidence(
  output: string,
): ResearchContractRuleId[] {
  return [
    ...new Set(
      [
        ...output.matchAll(
          /academic-os-research-rule-evidence:(RP-[A-Z]+(?:-[A-Z]+)*-[0-9]{3})/gu,
        ),
      ]
        .map((match) => match[1])
        .filter(
          (ruleId): ruleId is ResearchContractRuleId => ruleId !== undefined,
        ),
    ),
  ].sort();
}

function record(ruleId: ContractRuleId): void {
  console.log(`${marker}${ruleId}`);
}

function recordResearch(ruleId: ResearchContractRuleId): void {
  console.log(`${researchMarker}${ruleId}`);
}
