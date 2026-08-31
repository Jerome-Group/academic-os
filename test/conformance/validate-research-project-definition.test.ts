import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedResearchProject } from "../../src/config/index.js";
import {
  readResearchProjectProfile,
  validateResearchProjectDefinition,
} from "../../src/conformance/index.js";
import {
  recordResearchBehaviorEvidence,
  recordResearchFindingEvidence,
} from "../support/rule-evidence.js";

const target: ResolvedResearchProject = {
  key: "ureca-y2",
  root: "Modules/Research",
  folder: "URECA Y2",
  status: "active",
  profile: "ureca",
  taskListTitle: "URECA Y2",
};

const definition = `contract_version: 1
project:
  key: ureca-y2
  folder: URECA Y2
  title: Example research project
  status: active
profile: ureca
evidence:
  identity: owner-supplied
  confirmation: unresolved
`;

describe("research-project Definition", () => {
  it("accepts the exact v1 shape and configured identity", () => {
    const findings = validateResearchProjectDefinition(definition, target);

    assert.deepEqual(
      findings.map(({ ruleId, status }) => [ruleId, status]),
      [
        ["RP-DEFINITION-001", "pass"],
        ["RP-DEFINITION-002", "pass"],
      ],
    );
    assert.equal(readResearchProjectProfile(definition), "ureca");
  });

  it("rejects an open Definition shape and configured-identity drift", () => {
    const openShape = validateResearchProjectDefinition(
      definition.replace("profile: ureca", "profile: ureca\ntasks: []"),
      target,
    );
    const wrongIdentity = validateResearchProjectDefinition(
      definition.replace("folder: URECA Y2", "folder: Other Project"),
      target,
    );

    recordResearchFindingEvidence(openShape, "RP-DEFINITION-001");
    recordResearchFindingEvidence(wrongIdentity, "RP-DEFINITION-002");
    recordResearchBehaviorEvidence("RP-DELIVERABLES-003", () => {
      assert.equal(openShape[0]?.status, "fail");
      assert.match(openShape[0]?.evidence ?? "", /unsupported fields tasks/u);
    });
  });
});
