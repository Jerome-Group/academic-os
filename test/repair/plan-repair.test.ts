import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRepairPlan,
  RepairPlanError,
  repairApprovalDigest,
  repairDecisionDigest,
  repairInventoryDigest,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("creates a versioned ID-bound repair plan from approved decisions", () => {
  const plan = createRepairPlan(repairPlanDraft());

  assert.equal(plan.schemaVersion, 1);
  assert.match(plan.inventoryDigest, /^[0-9a-f]{64}$/u);
  assert.match(plan.decisionDigest, /^[0-9a-f]{64}$/u);
  assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
  assert.notEqual(plan.inventoryDigest, plan.planDigest);
  assert.equal(
    repairInventoryDigest({
      ...plan.inventory,
      observedAt: "2026-08-12T12:30:00.000Z",
    }),
    plan.inventoryDigest,
  );
  assert.equal(
    repairInventoryDigest({
      ...plan.inventory,
      items: [...plan.inventory.items].reverse(),
    }),
    plan.inventoryDigest,
  );
  assert.equal(plan.operations[2]?.operationId, "move-source");
  assert.equal(plan.curationEvents[0]?.source_id, "source-id");
  assert.equal(
    plan.curationEvents[0]?.destination,
    "10 Learning Materials/ZZ9999_Source_A.pdf",
  );
});

test("rejects stale approval, path-only identity, unavailable capability, and collisions", () => {
  const stale = repairPlanDraft();
  const approvedDecision = stale.decisions[0];
  assert.ok(approvedDecision);
  stale.decisions[0] = {
    ...approvedDecision,
    evidence: ["Changed after approval."],
  };
  assert.throws(() => createRepairPlan(stale), RepairPlanError);

  const pathIdentity = repairPlanDraft();
  pathIdentity.operations[2] = {
    operationId: "move-source",
    kind: "relocate-item",
    sourceId: "001 Source Material/ZZ9999 Source A.pdf",
    destination: {
      parent: { kind: "planned", operationId: "create-materials" },
      name: "ZZ9999_Source_A.pdf",
    },
  };
  assert.throws(() => createRepairPlan(pathIdentity), /inventory item ID/u);

  const unavailable = repairPlanDraft();
  const source = unavailable.inventory.items[2];
  assert.ok(source);
  delete source.capabilities.canCopy;
  assert.throws(() => createRepairPlan(unavailable), /unavailable capability/u);

  const collision = repairPlanDraft();
  collision.operations.push({
    operationId: "colliding-folder",
    kind: "create-folder",
    parent: { kind: "existing", id: "module-id" },
    name: "10 Learning Materials",
  });
  assert.throws(() => createRepairPlan(collision), /destination collision/u);

  const unsafeName = repairPlanDraft();
  const unsafeSource = unsafeName.inventory.items[2];
  assert.ok(unsafeSource);
  unsafeSource.name = "../escape.pdf";
  assert.throws(() => createRepairPlan(unsafeName), /stable metadata/u);

  const ambiguousParent = repairPlanDraft();
  const ambiguousSource = ambiguousParent.inventory.items[2];
  assert.ok(ambiguousSource);
  ambiguousSource.parentIds.push("module-id");
  assert.throws(() => createRepairPlan(ambiguousParent), /unambiguous/u);

  const changedOperations = repairPlanDraft();
  changedOperations.operations.push({
    operationId: "create-extra",
    kind: "create-folder",
    parent: { kind: "existing", id: "module-id" },
    name: "90 Resources",
  });
  assert.throws(() => createRepairPlan(changedOperations), /ordered plan/u);

  const wrongContract = repairPlanDraft();
  wrongContract.contractVersion = 999;
  assert.throws(() => createRepairPlan(wrongContract), /must be 2/u);
});

test("requires file-level curation before retiring an empty scratch tree", () => {
  const draft = repairPlanDraft();
  const scratch = {
    id: "scratch-id",
    name: ".scratch",
    mimeType: "application/vnd.google-apps.folder",
    parentIds: ["module-id"],
    modifiedTime: "2026-08-12T11:00:00.000Z",
    version: "3",
    capabilities: {
      canAddChildren: true,
      canListChildren: true,
      canEdit: true,
      canMoveItemWithinDrive: true,
    },
  };
  const temporary = {
    id: "temporary-id",
    name: "temporary.bin",
    mimeType: "application/octet-stream",
    parentIds: ["scratch-id"],
    modifiedTime: "2026-08-12T11:00:00.000Z",
    version: "4",
    size: "8",
    md5Checksum: "abcdefabcdefabcdefabcdefabcdefab",
    capabilities: {
      canCopy: true,
      canDownload: true,
      canEdit: true,
      canMoveItemWithinDrive: true,
    },
  };
  draft.inventory.items.push(scratch, temporary);
  draft.decisions.push(
    {
      sourceId: "temporary-id",
      decision: "recovery-only",
      evidence: ["Approved generated scratch artifact."],
    },
    {
      sourceId: "scratch-id",
      decision: "recovery-only",
      evidence: ["Approved empty scratch retirement."],
    },
  );
  draft.operations.push(
    {
      operationId: "retire-temporary",
      kind: "retire-item",
      sourceId: "temporary-id",
    },
    {
      operationId: "retire-scratch",
      kind: "retire-item",
      sourceId: "scratch-id",
    },
  );
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);

  const plan = createRepairPlan(draft);
  assert.deepEqual(
    plan.operations.slice(-3, -1).map(({ operationId }) => operationId),
    ["retire-temporary", "retire-scratch"],
  );
  assert.equal(
    plan.curationEvents.find(({ source_id }) => source_id === "temporary-id")
      ?.decision,
    "source-only",
  );

  const unsafe = repairPlanDraft();
  unsafe.inventory.items.push(scratch, temporary);
  unsafe.decisions.push({
    sourceId: "scratch-id",
    decision: "recovery-only",
    evidence: ["Unsafe implicit retirement."],
  });
  unsafe.operations.push({
    operationId: "retire-scratch",
    kind: "retire-item",
    sourceId: "scratch-id",
  });
  unsafe.approval.decisionDigest = repairDecisionDigest(unsafe.decisions);
  unsafe.approval.approvedPlanDigest = repairApprovalDigest(unsafe);
  assert.throws(() => createRepairPlan(unsafe), /implicitly migrate a file/u);
});

test("keeps an approved canonical copy while retiring only its excess duplicate", () => {
  const draft = repairPlanDraft();
  const canonical = draft.inventory.items[2];
  assert.ok(canonical);
  draft.decisions[0] = {
    sourceId: canonical.id,
    decision: "retained",
    evidence: ["Approved canonical copy."],
  };
  draft.operations = draft.operations.filter(
    ({ operationId }) => operationId !== "move-source",
  );
  draft.inventory.items.push({
    ...canonical,
    id: "excess-id",
    name: "ZZ9999 Source A Copy.pdf",
    version: "8",
  });
  draft.decisions.push({
    sourceId: "excess-id",
    decision: "recovery-only",
    evidence: ["Byte-identical excess copy approved for retirement."],
    supersedes: canonical.id,
  });
  draft.operations.push({
    operationId: "retire-excess",
    kind: "retire-item",
    sourceId: "excess-id",
  });
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);

  const plan = createRepairPlan(draft);
  assert.equal(
    plan.operations.some(
      (operation) =>
        (operation.kind === "relocate-item" ||
          operation.kind === "retire-item") &&
        operation.sourceId === canonical.id,
    ),
    false,
  );
  assert.equal(plan.curationEvents[0]?.supersedes, canonical.id);
});

test("binds local-only Finder retirement to filesystem identity and checksum", () => {
  const draft = repairPlanDraft();
  draft.inventory.localArtifacts.push({
    relativePath: ".DS_Store",
    device: "10",
    inode: "20",
    size: "8",
    modifiedTime: "123456789",
    sha256: "a".repeat(64),
  });
  draft.decisions.push({
    sourceId: "local:10:20",
    decision: "recovery-only",
    evidence: ["Approved Finder metadata retirement."],
  });
  draft.operations.push({
    operationId: "retire-finder-metadata",
    kind: "retire-local-artifact",
    sourceId: "local:10:20",
    relativePath: ".DS_Store",
  });
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);

  const plan = createRepairPlan(draft);
  const event = plan.curationEvents.find(
    ({ source_id }) => source_id === "local:10:20",
  );
  assert.equal(event?.source_path, ".DS_Store");
  assert.equal(event?.checksum, `sha256:${"a".repeat(64)}`);
});
