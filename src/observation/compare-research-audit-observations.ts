import type { ResearchFinding } from "../conformance/index.js";
import {
  compareResearchFindings,
  researchFindingKey,
} from "./create-research-audit-observation.js";
import type {
  ResearchAuditObservation,
  ResearchObservationComparison,
} from "./research-types.js";

export function compareResearchAuditObservations(
  current: ResearchAuditObservation,
  previous?: ResearchAuditObservation,
): ResearchObservationComparison {
  const currentFindings = actionableFindings(current.findings);
  if (previous === undefined) {
    return {
      basis: "no-prior-observation",
      new: currentFindings,
      unchanged: [],
      resolved: [],
    };
  }
  if (previous.contractVersion !== current.contractVersion) {
    return {
      basis: "contract-version-changed",
      contractChange: {
        from: previous.contractVersion,
        to: current.contractVersion,
      },
      new: [],
      unchanged: [],
      resolved: [],
    };
  }

  const previousFindings = actionableFindings(previous.findings);
  const currentKeys = new Set(currentFindings.map(researchFindingKey));
  const previousKeys = new Set(previousFindings.map(researchFindingKey));
  return {
    basis: "compatible-observation",
    new: currentFindings.filter(
      (finding) => !previousKeys.has(researchFindingKey(finding)),
    ),
    unchanged: currentFindings.filter((finding) =>
      previousKeys.has(researchFindingKey(finding)),
    ),
    resolved: previousFindings.filter(
      (finding) => !currentKeys.has(researchFindingKey(finding)),
    ),
  };
}

function actionableFindings(findings: ResearchFinding[]): ResearchFinding[] {
  return findings
    .filter(({ status }) => status !== "pass" && status !== "not-applicable")
    .sort(compareResearchFindings);
}
