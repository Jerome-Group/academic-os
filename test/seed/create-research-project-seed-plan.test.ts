import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResolvedResearchProject } from "../../src/config/index.js";
import {
  researchProjectUniversalStructure,
  urecaResearchProjectStructure,
} from "../../src/contract/research-project-structure.js";
import {
  createResearchProjectSeedPlan,
  type ResearchProjectContract,
} from "../../src/seed/index.js";

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

const profile = "# URECA Y2\n\nOwner-supplied project identity.\n";

const contract: ResearchProjectContract = {
  version: 1,
  ruleIds: ["RP-UNIVERSAL-001", "RP-PROFILE-STRUCTURE-001"],
  universalStructure: researchProjectUniversalStructure,
  profiles: { generic: [], ureca: urecaResearchProjectStructure },
  seedFiles: Object.fromEntries(
    researchProjectUniversalStructure
      .filter(([, kind]) => kind === "file")
      .map(([path]) => [path, `Seed for {{PROJECT_NAME}} at ${path}.\n`]),
  ),
};

describe("createResearchProjectSeedPlan", () => {
  it("builds a deterministic URECA plan without module or NTULearn structure", () => {
    const plan = createResearchProjectSeedPlan({
      target,
      definition,
      profile,
      contract,
    });

    assert.deepEqual(plan.target, {
      kind: "research-project",
      key: "ureca-y2",
      folder: "URECA Y2",
    });
    assert.equal(plan.contractVersion, 1);
    assert.deepEqual(plan.blockers, []);
    assert.ok(
      plan.operations.some(({ path }) => path === "30 Deliverables/30 Paper"),
    );
    assert.ok(plan.operations.every(({ path }) => !path.includes("NTULearn")));
    assert.equal(
      plan.operations.find(
        ({ path }) => path === "00 Project Admin/00 Project Profile.md",
      )?.contents,
      profile,
    );
    assert.match(
      plan.operations.find(({ path }) => path === "AGENTS.md")?.contents ?? "",
      /Seed for URECA Y2/u,
    );
  });

  it("overrides caller-owned controls and derives directories for additive intake", () => {
    const plan = createResearchProjectSeedPlan({
      target,
      definition,
      profile,
      contract,
      initialFiles: [
        {
          destination: "00 Project Admin/20 Source Register.yaml",
          encoding: "utf8",
          contents: "sources: []\n",
        },
        {
          destination: "00 Project Admin/50 Deliverable Register.yaml",
          encoding: "utf8",
          contents: "deliverables: []\n",
        },
        {
          destination: "10 Source Materials/references.bib",
          encoding: "utf8",
          contents: "% approved initial bibliography\n",
        },
        {
          destination:
            "10 Source Materials/20 Core Sources/representation-theory/book.pdf",
          encoding: "binary",
          contentsBase64: "AP8=",
        },
      ],
    });

    assert.equal(
      plan.operations.find(
        ({ path }) => path === "00 Project Admin/20 Source Register.yaml",
      )?.contents,
      "sources: []\n",
    );
    assert.equal(
      plan.operations.find(
        ({ path }) => path === "00 Project Admin/50 Deliverable Register.yaml",
      )?.contents,
      "deliverables: []\n",
    );
    assert.equal(
      plan.operations.find(
        ({ path }) => path === "10 Source Materials/references.bib",
      )?.contents,
      "% approved initial bibliography\n",
    );
    assert.deepEqual(
      plan.operations.find(
        ({ path }) =>
          path ===
          "10 Source Materials/20 Core Sources/representation-theory/book.pdf",
      ),
      {
        kind: "file",
        path: "10 Source Materials/20 Core Sources/representation-theory/book.pdf",
        contentsBase64: "AP8=",
      },
    );
    assert.ok(
      plan.operations.some(
        ({ kind, path }) =>
          kind === "directory" &&
          path === "10 Source Materials/20 Core Sources/representation-theory",
      ),
    );
  });

  it("rejects duplicate, escaping, root, Admin, pinned, and type-conflicting destinations", () => {
    const cases: Array<{
      destinations: string[];
      message: RegExp;
    }> = [
      {
        destinations: [
          "10 Source Materials/20 Core Sources/a.md",
          "10 Source Materials/20 Core Sources/a.md",
        ],
        message: /duplicate/u,
      },
      { destinations: ["../outside.md"], message: /canonical relative path/u },
      { destinations: ["loose.md"], message: /open content interior/u },
      {
        destinations: ["00 Project Admin/private.md"],
        message: /Project Admin/u,
      },
      { destinations: ["AGENTS.md"], message: /pinned or fixed/u },
      {
        destinations: [
          "10 Source Materials/20 Core Sources/topic",
          "10 Source Materials/20 Core Sources/topic/note.md",
        ],
        message: /type conflict/u,
      },
      {
        destinations: [
          "10 Source Materials/20 Core Sources/Topic/a.md",
          "10 Source Materials/20 Core Sources/topic/b.md",
        ],
        message: /case-variant path conflict/u,
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      assert.throws(
        () =>
          createResearchProjectSeedPlan({
            target,
            definition,
            profile,
            contract,
            initialFiles: testCase.destinations.map((destination) => ({
              destination,
              encoding: "utf8" as const,
              contents: `case ${index}\n`,
            })),
          }),
        testCase.message,
      );
    }
  });

  it("keeps Profile and Definition under their dedicated flags", () => {
    for (const destination of [
      "00 Project Admin/00 Project Profile.md",
      "00 Project Admin/10 Project Definition.yaml",
    ]) {
      assert.throws(
        () =>
          createResearchProjectSeedPlan({
            target,
            definition,
            profile,
            contract,
            initialFiles: [
              { destination, encoding: "utf8", contents: "replacement\n" },
            ],
          }),
        /dedicated --profile and --definition/u,
      );
    }
  });
});
