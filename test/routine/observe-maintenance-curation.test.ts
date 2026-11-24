import assert from "node:assert/strict";
import type { ImportRootStatus } from "../../src/imports/index.js";
import { it } from "node:test";
import { observeMaintenanceCuration } from "../../src/routine/observe-maintenance-curation.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import type { Inventory } from "../../src/conformance/types.js";

function receipt(destination: string): ImportRootStatus {
  return {
    destination,
    status: "current",
    action: "none",
    counts: null,
    startedAt: null,
    finishedAt: null,
    lastSuccessfulAt: null,
    unread: [],
  };
}

it("keeps pending, ambiguity and missing outputs distinct from source-only and exact metadata", () => {
  const event = (source_path: string, decision: string, destination?: string) =>
    JSON.stringify({
      schema_version: 1,
      source_id: source_path,
      integration: "ntulearn",
      role: "primary",
      source_path,
      decision,
      ...(destination === undefined ? {} : { destination }),
      evidence: "Synthetic decision",
      timestamp: "2026-08-22T00:00:00Z",
    });
  const controls = {
    ...validModuleControls(),
    curationRegister: [
      event("read.pdf", "source-only"),
      event("park.pdf", "requires-decision"),
      event("placed.pdf", "curated", "10 Lectures/01 Missing.pdf"),
    ].join("\n"),
  };
  const paths = [
    "NTULearn",
    "NTULearn/Announcements/notice.md",
    "NTULearn/read.pdf",
    "NTULearn/park.pdf",
    "NTULearn/placed.pdf",
    "NTULearn/01 Same.pdf",
    "NTULearn/02 Same.pdf",
    "NTULearn/Course.md",
    `NTULearn/Source editions/${"a".repeat(64)}/${"b".repeat(64)}.json`,
    "NTULearn/Source editions/unknown.json",
    "NTULearn/Folder/Course.md",
  ];
  const inventory: Inventory = {
    moduleCode: "MH2100",
    entries: paths.map((path) => ({
      path,
      kind: path === "NTULearn" ? "directory" : "file",
    })),
    provenance: {
      source: "synthetic",
      target: "fixture",
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 0,
    },
  };
  const observe = () =>
    observeMaintenanceCuration({
      module: "MH2100",
      semester: "Y2S1",
      controls,
      inventory,
      imports: { available: true, roots: [receipt("NTULearn")] },
    });
  const before = observe();
  assert.equal(before.inputs, "available");
  assert.equal(before.counts.reservedMetadata, 2);
  assert.equal(before.counts.unrecorded, 3);
  assert.equal(before.counts["requires-decision"], 1);
  assert.equal(before.counts["normalized-path-collision"], 1);
  assert.equal(before.counts["missing-curated-output"], 1);
  assert.ok(!before.worklist.some(({ key }) => key.endsWith("read.pdf")));
  assert.deepEqual(observe(), before);
  inventory.entries.push({ path: "10 Lectures/01 Missing.pdf", kind: "file" });
  assert.equal(observe().counts["missing-curated-output"], 0);
  inventory.entries = inventory.entries.filter(
    ({ path }) => path !== "NTULearn/placed.pdf",
  );
  assert.equal(observe().counts["missing-recorded-source"], 1);
  if (inventory.provenance) inventory.provenance.completeness = "partial";
  assert.equal(observe().inputs, "unavailable");
  delete inventory.provenance;
  assert.equal(observe().inputs, "unavailable");
  controls.curationRegister = "broken";
  assert.equal(observe().counts.unrecorded, 0);
});

it("detects one normalized identity across two roots of the same integration", () => {
  const controls = validModuleControls();
  controls.definition = (controls.definition ?? "").replace(
    "- {role: primary, destination: NTULearn, evidence: [course-site]}",
    "- {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: supplementary, destination: NTULearn_Tutorial, evidence: [course-site]}",
  );
  const observation = observeMaintenanceCuration({
    module: "MH2100",
    semester: "Y2S1",
    controls,
    inventory: {
      moduleCode: "MH2100",
      entries: [
        { path: "NTULearn", kind: "directory" },
        { path: "NTULearn_Tutorial", kind: "directory" },
        { path: "NTULearn/01 Hints.pdf", kind: "file" },
        { path: "NTULearn_Tutorial/02 Hints.pdf", kind: "file" },
      ],
    },
    imports: { available: false, roots: [], error: "synthetic unread receipt" },
  });
  assert.equal(observation.counts["normalized-path-collision"], 1);
  assert.equal(observation.counts.unrecorded, 0);
  assert.deepEqual(observation.worklist[0]?.paths, [
    "NTULearn/01 Hints.pdf",
    "NTULearn_Tutorial/02 Hints.pdf",
  ]);
  assert.equal(observation.inputs, "unavailable");
});

it("requires complete receipt coverage and rejects importer destinations while excluding only ordinary metadata", () => {
  const controls = validModuleControls();
  controls.definition = (controls.definition ?? "").replace(
    "- {role: primary, destination: NTULearn, evidence: [course-site]}",
    "- {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: supplementary, destination: NTULearn_Tutorial, evidence: [course-site]}",
  );
  const event = (source_path: string, decision: string, destination?: string) =>
    JSON.stringify({
      schema_version: 1,
      source_id: source_path,
      integration: "ntulearn",
      role: "primary",
      source_path,
      decision,
      ...(destination === undefined ? {} : { destination }),
      evidence: "synthetic",
      timestamp: "2026-08-22T00:00:00Z",
    });
  controls.curationRegister = [
    event("Course.md", "source-only"),
    event("read.pdf", "source-only"),
    event("attachment.pdf", "curated", "NTULearn_Tutorial/attachment.pdf"),
  ].join("\n");
  const inventory: Inventory = {
    moduleCode: "MH2100",
    entries: [
      { path: "NTULearn", kind: "directory" },
      { path: "NTULearn_Tutorial", kind: "directory" },
      { path: "NTULearn/attachment.pdf", kind: "file" },
      { path: "NTULearn_Tutorial/attachment.pdf", kind: "file" },
      { path: "NTULearn_Tutorial/Course.md", kind: "file" },
      { path: "NTULearn_Tutorial/Last synced.md", kind: "symlink" },
      { path: "NTULearn_Tutorial/read.pdf", kind: "file" },
      { path: "NTULearn/Announcements/notice.md", kind: "file" },
    ],
    provenance: {
      source: "synthetic",
      target: "fixture",
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 0,
    },
  };
  const imports = { available: true, roots: [receipt("NTULearn")] };
  const observe = () =>
    observeMaintenanceCuration({
      module: "MH2100",
      semester: "Y2S1",
      controls,
      inventory,
      imports,
    });
  const partial = observe();
  assert.equal(partial.inputs, "unavailable");
  assert.ok(
    partial.problems.some(
      (problem) =>
        problem.includes("receipt") && problem.includes("NTULearn_Tutorial"),
    ),
  );
  assert.equal(partial.counts.reservedMetadata, 1);
  assert.ok(
    partial.problems.some(
      (problem) =>
        problem.includes("not an ordinary") &&
        problem.includes("Last synced.md"),
    ),
  );
  assert.equal(partial.counts["missing-recorded-source"], 0);
  assert.equal(partial.counts["invalid-curated-output"], 1);
  assert.equal(partial.counts["normalized-path-collision"], 1);
  assert.equal(partial.counts.settled, 1);
  imports.roots.push(receipt("NTULearn_Tutorial"));
  inventory.entries = inventory.entries.filter(
    ({ kind }) => kind !== "symlink",
  );
  assert.equal(observe().inputs, "available");
  imports.roots.push(receipt("NTULearn_Tutorial"));
  assert.equal(observe().inputs, "unavailable");
  imports.roots = [];
  assert.equal(observe().inputs, "unavailable");
});

it("keeps rederived artifacts as exact presence obligations without reopening the decision", () => {
  const controls = validModuleControls();
  controls.curationRegister = JSON.stringify({
    schema_version: 2,
    source_id: "combined.pdf",
    integration: "ntulearn",
    role: "primary",
    source_path: "combined.pdf",
    decision: "rederived",
    derived: [
      "10 Lectures/01 Chapter.pdf",
      "10 Lectures/02 Chapter.pdf",
      "NTULearn/combined.pdf",
    ],
    evidence: "Synthetic source split into chapters",
    timestamp: "2026-08-22T00:00:00Z",
  });
  const inventory: Inventory = {
    moduleCode: "MH2100",
    entries: [
      { path: "NTULearn", kind: "directory" },
      { path: "NTULearn/combined.pdf", kind: "file" },
      { path: "10 Lectures/01 Chapter.pdf", kind: "file" },
      { path: "10 Lectures/01 Chapter.pdf", kind: "file" },
    ],
  };
  const observation = observeMaintenanceCuration({
    module: "MH2100",
    semester: "Y2S1",
    controls,
    inventory,
    imports: { available: true, roots: [receipt("NTULearn")] },
  });
  assert.equal(observation.counts.settled, 0);
  assert.equal(observation.counts.unrecorded, 0);
  assert.equal(observation.counts["missing-derived-output"], 1);
  assert.equal(observation.counts["invalid-derived-output"], 1);
  assert.ok(
    observation.worklist.some(({ paths }) =>
      paths.includes("10 Lectures/02 Chapter.pdf"),
    ),
  );
});

it("rejects mismatched identities without rejecting unrelated contextual decisions", () => {
  const controls = validModuleControls();
  const observe = () =>
    observeMaintenanceCuration({
      module: "MH2100",
      semester: "Y2S1",
      controls,
      inventory: {
        moduleCode: "MH2100",
        entries: [
          { path: "NTULearn", kind: "directory" },
          { path: "NTULearn/new.pdf", kind: "file" },
        ],
        provenance: {
          source: "synthetic",
          target: "fixture",
          completeness: "complete",
          diagnostics: [],
          excludedTrashedItems: 0,
        },
      },
      imports: { available: true, roots: [receipt("NTULearn")] },
    });
  controls.definition = (controls.definition ?? "").replace(
    "enabled: true, evidence: [assessment-profile]",
    "enabled: true",
  );
  assert.equal(observe().inputs, "available");
  controls.definition = controls.definition.replace(
    "code: MH2100",
    "code: AB1234",
  );
  assert.equal(observe().inputs, "unavailable");
  assert.equal(observe().counts.sources, 0);
  controls.definition = controls.definition
    .replace("code: AB1234", "code: MH2100")
    .replace("semester: 1", "semester: 2");
  assert.equal(observe().inputs, "unavailable");
});

it("prioritizes current arrivals ahead of large historical source-path observations", () => {
  const controls = validModuleControls();
  controls.curationRegister = Array.from({ length: 150 }, (_, i) =>
    JSON.stringify({
      schema_version: 1,
      source_id: `Old ${i}.pdf`,
      integration: "ntulearn",
      role: "primary",
      source_path: `Old ${i}.pdf`,
      decision: "source-only",
      evidence: "Synthetic historical path",
      timestamp: "2026-08-22T00:00:00Z",
    }),
  ).join("\n");
  const observation = observeMaintenanceCuration({
    module: "MH2100",
    semester: "Y2S1",
    controls,
    inventory: {
      moduleCode: "MH2100",
      entries: [
        { path: "NTULearn", kind: "directory" },
        { path: "NTULearn/Z New.pdf", kind: "file" },
        {
          path: `NTULearn/Source editions/${"a".repeat(64)}/${"b".repeat(64)}.json.part-12345678-abcd-abcd-abcd-123456789abc`,
          kind: "file",
        },
        {
          path: `NTULearn/Source editions/${"a".repeat(64)}/${"c".repeat(64)}.json.part-12345678-abcd-abcd-abcd-123456789abc.part-12345678-abcd-abcd-abcd-123456789abc`,
          kind: "file",
        },
      ],
    },
    imports: { available: false, roots: [] },
  });
  assert.equal(observation.counts["missing-recorded-source"], 150);
  assert.equal(observation.worklist[0]?.kind, "unrecorded");
  assert.equal(observation.omittedItems, 51);
  assert.equal(observation.counts.sources, 1);
  assert.ok(
    observation.problems.some((problem) =>
      problem.includes("Incomplete importer metadata"),
    ),
  );
});

it("retains outstanding decisions for recorded provenance without classifying metadata as coursework", () => {
  const controls = validModuleControls();
  const provenance = `Source editions/${"a".repeat(64)}/${"b".repeat(64)}.json`;
  const unrecordedMetadata = `Source editions/${"a".repeat(64)}/${"c".repeat(64)}.json`;
  const event = {
    schema_version: 1,
    source_id: provenance,
    integration: "ntulearn",
    role: "primary",
    source_path: provenance,
    decision: "requires-decision",
    evidence: "Synthetic earlier pending decision",
    timestamp: "2026-08-22T00:00:00Z",
  };
  controls.curationRegister = JSON.stringify(event);
  const observe = () =>
    observeMaintenanceCuration({
      module: "MH2100",
      semester: "Y2S1",
      controls,
      inventory: {
        moduleCode: "MH2100",
        entries: [
          { path: "NTULearn", kind: "directory" },
          { path: `NTULearn/${provenance}`, kind: "file" },
          { path: `NTULearn/${unrecordedMetadata}`, kind: "file" },
        ],
      },
      imports: { available: true, roots: [receipt("NTULearn")] },
    });
  const before = observe();
  assert.equal(before.counts.reservedMetadata, 2);
  assert.equal(before.counts.unrecorded, 0);
  assert.equal(before.counts["requires-decision"], 1);
  assert.deepEqual(before.worklist[0]?.paths, [`NTULearn/${provenance}`]);
  controls.curationRegister +=
    "\n" +
    JSON.stringify({
      ...event,
      decision: "source-only",
      timestamp: "2026-08-23T00:00:00Z",
    });
  assert.equal(observe().counts["requires-decision"], 0);
});
