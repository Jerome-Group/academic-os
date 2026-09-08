import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planModuleConformance } from "../../src/conformance/index.js";
import type { LearningMaterialsAssessment } from "../../src/learning-materials/index.js";
import {
  createModuleMaintenanceWorkOrder,
  MAINTENANCE_DOMAINS,
} from "../../src/routine/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { testModuleContract } from "../fixtures/module-contract.js";

const observedAt = "2026-08-23T06:00:00+08:00";
const controls = validModuleControls();
const inventory = {
  moduleCode: "MH2100",
  entries: [
    { path: "00 Module Admin", kind: "directory" as const },
    { path: "00 Module Admin/40 Source Map.yaml", kind: "file" as const },
    { path: "NTULearn", kind: "directory" as const },
  ],
  provenance: {
    source: "synthetic" as const,
    target: "/synthetic/MH2100",
    completeness: "complete" as const,
    diagnostics: [],
    excludedTrashedItems: 0,
  },
};
const plan = planModuleConformance({
  contract: testModuleContract,
  target: {
    moduleCode: "MH2100",
    semester: "Y2S1",
    identity: "/synthetic/MH2100",
  },
  controls,
  inventory,
  observedAt,
});
const learningSources = {
  outcome: "gaps",
  inventoryCompleteness: "complete",
  units: [
    {
      unit: "Unit 1",
      topics: ["Synthetic topic"],
      lectures: [
        {
          category: "lectures",
          file: "NTULearn/week-1.pdf",
          availability: "missing",
        },
      ],
      textbook: [],
      tutorials: [],
      supplementaryMaterials: [],
      pastPapers: [],
      practiceTests: [],
      historicalReference: [],
      status: "gaps",
    },
  ],
  missingFiles: ["NTULearn/week-1.pdf"],
  nonFiles: [],
  unavailableFiles: [],
  declaredTutorialGaps: [],
  emptyUnits: [],
  noUnits: false,
  problems: [],
  summary: {
    units: 1,
    references: 1,
    available: 0,
    missing: 1,
    nonFiles: 0,
    unavailable: 0,
    declaredMissing: 0,
    emptyUnits: 0,
  },
} as LearningMaterialsAssessment;

const workOrder = createModuleMaintenanceWorkOrder({
  module: { code: "MH2100", semester: "Y2S1" },
  observedAt,
  plan,
  imports: {
    available: true,
    roots: [
      {
        destination: "NTULearn",
        status: "stale",
        action: "wake-owner",
        counts: null,
        startedAt: null,
        finishedAt: "2026-08-20T00:00:00.000Z",
        lastSuccessfulAt: null,
        unread: null,
      },
    ],
  },
  learningSources,
  writeJournalDirectory: "/private/session/attempt-1/write-journal",
  writeJournalPath: "/private/session/attempt-1/write-journal/operations.jsonl",
});

describe("module maintenance work order", () => {
  it("covers every registered domain with rules and concrete preflight evidence", () => {
    assert.equal(workOrder.schemaVersion, 1);
    assert.deepEqual(
      workOrder.domains.map(({ domain }) => domain),
      MAINTENANCE_DOMAINS.map(({ id }) => id),
    );
    assert.ok(
      workOrder.domains.every(
        ({ ruleIds, evidence }) => ruleIds.length > 0 && evidence.length > 0,
      ),
    );
    assert.match(
      workOrder.domains
        .find(({ domain }) => domain === "import-health")
        ?.evidence.join(" ") ?? "",
      /NTULearn: stale/u,
    );
  });

  it("includes only attention findings, approved proposed directories, and bounded learning gaps", () => {
    assert.ok(workOrder.audit.findings.length > 0);
    assert.ok(
      workOrder.audit.findings.every(
        ({ status }) => status !== "pass" && status !== "not-applicable",
      ),
    );
    assert.ok(workOrder.audit.proposedDirectories.length > 0);
    assert.deepEqual(workOrder.learningSources.units[0]?.gaps, [
      "lectures: NTULearn/week-1.pdf (missing)",
    ]);
    assert.equal("entries" in workOrder.audit, false);
  });

  it("names only its per-attempt write journal outside the evidence", () => {
    assert.equal(
      workOrder.writeJournalDirectory,
      "/private/session/attempt-1/write-journal",
    );
    assert.equal(
      workOrder.writeJournalPath,
      "/private/session/attempt-1/write-journal/operations.jsonl",
    );
    assert.equal(workOrder.writeJournalSchemaVersion, 1);
    assert.equal("safeguards" in workOrder, false);
  });
});
