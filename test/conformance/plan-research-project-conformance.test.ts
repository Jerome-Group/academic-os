import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResolvedResearchProject } from "../../src/config/index.js";
import {
  planResearchProjectConformance,
  type ResearchProjectControls,
  type ResearchProjectInventory,
  researchProjectControlPaths,
} from "../../src/conformance/index.js";
import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";
import { createResearchProjectSeedPlan } from "../../src/seed/index.js";
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
const profile = `# URECA Y2 — Example research project

## Identity

| Field | Value | Evidence |
| --- | --- | --- |
| Project key | ureca-y2 | owner-supplied |
| Folder | URECA Y2 | owner-supplied |
| Title | Example research project | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ureca | official-source |

## Purpose and Questions

Unknown until project evidence is supplied.

## Programme

Unknown until programme evidence is supplied.

## Supervision

| Field | Value | Evidence |
| --- | --- | --- |

## Deliverables

| Deliverable | Requirement | Evidence |
| --- | --- | --- |

## Source Authority

| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |

## Workspaces

| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Research | Owner research | \`70 Research/\` |

## Known Gaps

| Gap | Consequence | Next evidence |
| --- | --- | --- |
| Project brief | Scope remains unresolved | official-source |
`;

describe("planResearchProjectConformance", () => {
  it("accepts the complete projected URECA seed through every applicable rule", async () => {
    const input = await conformantInput();
    const result = planResearchProjectConformance(input);

    assert.equal(result.outcome, "conformant");
    assert.deepEqual(result.proposedOperations, []);
    assert.deepEqual(
      [...new Set(result.findings.map(({ ruleId }) => ruleId))].sort(),
      [...input.contract.ruleIds].sort(),
    );
  });

  it("records deterministic structural rules only from alternate behaviour", async () => {
    const input = await conformantInput();
    const withEntries = (entries: ResearchProjectInventory["entries"]) =>
      planResearchProjectConformance({
        ...input,
        inventory: { ...input.inventory, entries },
      }).findings;
    const withoutPath = (path: string) =>
      input.inventory.entries.filter((entry) => entry.path !== path);

    recordResearchFindingEvidence(
      planResearchProjectConformance({
        ...input,
        inventory: { ...input.inventory, projectKey: "other-project" },
      }).findings,
      "RP-ROOT-001",
    );
    recordResearchFindingEvidence(
      withEntries(withoutPath("AGENTS.md")),
      "RP-UNIVERSAL-001",
    );
    recordResearchFindingEvidence(
      withEntries(withoutPath("30 Deliverables/10 Abstract")),
      "RP-PROFILE-STRUCTURE-001",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: "loose.md", kind: "file" },
      ]),
      "RP-ROOT-002",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: ".mount-state", kind: "file" },
      ]),
      "RP-ROOT-003",
    );
    recordResearchFindingEvidence(
      planResearchProjectConformance({
        ...input,
        controls: { ...input.controls, agents: "# Broken router\n" },
      }).findings,
      "RP-AGENTS-001",
      "RP-AGENTS-004",
    );
    recordResearchFindingEvidence(
      planResearchProjectConformance({
        ...input,
        controls: { ...input.controls, claude: "Read something else.\n" },
      }).findings,
      "RP-AGENTS-002",
    );
    recordResearchFindingEvidence(
      planResearchProjectConformance({
        ...input,
        controls: { ...input.controls, context: "# Wrong context\n" },
      }).findings,
      "RP-CONTEXT-001",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: "00 Project Admin/extra.md", kind: "file" },
      ]),
      "RP-ADMIN-001",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: "docs/extra.md", kind: "file" },
      ]),
      "RP-DOCS-001",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: "context.md", kind: "file" },
      ]),
      "RP-NAMING-001",
    );
    recordResearchFindingEvidence(
      withEntries([
        ...input.inventory.entries,
        { path: "build", kind: "directory" },
      ]),
      "RP-LATEX-001",
    );

    const baseline = planResearchProjectConformance(input);
    recordResearchBehaviorEvidence("RP-AUDIT-001", () => {
      assert.ok(
        baseline.findings.every(
          ({ enforcement, evidence, applicability }) =>
            (enforcement === "deterministic" || enforcement === "judgment") &&
            evidence.length > 0 &&
            applicability.length > 0,
        ),
      );
    });
    recordResearchBehaviorEvidence("RP-AUDIT-002", () => {
      const candidateMathematics = planResearchProjectConformance({
        ...input,
        inventory: {
          ...input.inventory,
          entries: [
            ...input.inventory.entries,
            {
              path: "70 Research/20 Mathematics/candidate.tex",
              kind: "file",
            },
          ],
        },
      });
      assert.equal(candidateMathematics.outcome, "conformant");
    });
    recordResearchBehaviorEvidence("RP-NAMING-003", () => {
      const scratchInterior = planResearchProjectConformance({
        ...input,
        inventory: {
          ...input.inventory,
          entries: [
            ...input.inventory.entries,
            { path: ".scratch/FREE FORM Draft.tex", kind: "file" },
          ],
        },
      });
      assert.equal(
        scratchInterior.findings.find(
          ({ ruleId }) => ruleId === "RP-NAMING-001",
        )?.status,
        "pass",
      );
    });
  });
});

async function conformantInput(): Promise<{
  contract: Awaited<ReturnType<typeof loadResearchProjectContract>>;
  target: ResolvedResearchProject;
  inventory: ResearchProjectInventory;
  controls: ResearchProjectControls;
}> {
  const contract = await loadResearchProjectContract();
  const seed = createResearchProjectSeedPlan({
    target,
    definition,
    profile,
    contract,
  });
  const files = new Map(
    seed.operations.map(({ path, contents }) => [path, contents]),
  );
  const controls = Object.fromEntries(
    Object.entries(researchProjectControlPaths).map(([name, path]) => [
      name,
      files.get(path),
    ]),
  ) as ResearchProjectControls;
  const inventory: ResearchProjectInventory = {
    projectKey: target.key,
    entries: seed.operations.map(({ path, kind, contents }) => ({
      path,
      kind,
      ...(kind === "file" ? { size: (contents ?? "").length } : {}),
    })),
  };
  return { contract, target, inventory, controls };
}
