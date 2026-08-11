import type { Finding } from "../conformance/index.js";
import { compareFindings, findingKey } from "./create-audit-observation.js";
import type { AuditObservation, ObservationComparison } from "./types.js";

export function compareAuditObservations(
  current: AuditObservation,
  previous?: AuditObservation,
): ObservationComparison {
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
  const currentKeys = new Set(currentFindings.map(findingKey));
  const previousKeys = new Set(previousFindings.map(findingKey));
  return {
    basis: "compatible-observation",
    new: currentFindings.filter(
      (finding) => !previousKeys.has(findingKey(finding)),
    ),
    unchanged: currentFindings.filter((finding) =>
      previousKeys.has(findingKey(finding)),
    ),
    resolved: previousFindings.filter(
      (finding) => !currentKeys.has(findingKey(finding)),
    ),
  };
}

function actionableFindings(findings: Finding[]): Finding[] {
  return findings
    .filter(({ status }) => status !== "pass" && status !== "not-applicable")
    .sort(compareFindings);
}
