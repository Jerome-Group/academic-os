import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRepairPlan,
  executeRepairPlan,
  repairApprovalDigest,
  repairDecisionDigest,
  type RepairExecutionDrive,
  type RepairExecutionJournalStore,
  type RepairExecutionRecovery,
  type RepairJournalEvent,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("previews without recovery or mutation, then recovers before ID-bound apply", async () => {
  const plan = createRepairPlan(repairPlanDraft());
  const calls: string[] = [];
  const events: RepairJournalEvent[] = [];
  const store: RepairExecutionJournalStore = {
    read: async () => [...events],
    append: async (event) => {
      events.push(event);
    },
  };
  const recovery: RepairExecutionRecovery = {
    recover: async () => {
      calls.push("recover");
      return {
        drive: {
          changeSetId: plan.changeSetId,
          planDigest: plan.planDigest,
          recoveryRootId: "recovery-root",
          retirementRootId: "retired-root",
          items: [],
          verified: true,
        },
        bytes: {
          changeSetId: plan.changeSetId,
          planDigest: plan.planDigest,
          path: "/separate/snapshot",
          items: [],
          localArtifacts: [],
          protection: "read-only-and-user-immutable",
          verified: true,
        },
      };
    },
    verify: async () => {
      calls.push("verify-recovery");
    },
  };
  const drive: RepairExecutionDrive = {
    inventory: async () => plan.inventory,
    createFolder: async ({ operationId, parentId, name }) => {
      calls.push(`create:${operationId}:${parentId}:${name}`);
      const itemId =
        operationId === "create-admin" ? "new-admin-id" : "new-learning-id";
      return {
        itemId,
        parentId,
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
    },
    createFile: async ({ operationId, parentId, name }) => {
      calls.push(`file:${operationId}:${parentId}:${name}`);
      return {
        itemId: "curation-register-id",
        parentId,
        name,
        mimeType: "application/jsonl",
      };
    },
    relocateItem: async ({ operationId, sourceId, parentId, name }) => {
      calls.push(`move:${operationId}:${sourceId}:${parentId}:${name}`);
      return { itemId: sourceId, parentId, name, mimeType: "application/pdf" };
    },
    verifyContinuation: async () => ({ blockers: [], recovered: [] }),
    verifyPostcondition: async () => {
      calls.push("verify-postcondition");
      return [];
    },
  };

  const preview = await executeRepairPlan({
    plan,
    mode: "preview",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(preview.outcome, "preview");
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);

  const applied = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(applied.outcome, "completed");
  assert.deepEqual(calls, [
    "recover",
    "verify-recovery",
    "create:create-admin:module-id:00 Module Admin",
    "create:create-materials:module-id:10 Learning Materials",
    "move:move-source:source-id:new-learning-id:ZZ9999_Source_A.pdf",
    "file:record-curation-decisions:new-admin-id:20 Curation Register.jsonl",
    "verify-recovery",
    "verify-postcondition",
  ]);
  assert.deepEqual(
    events.map(({ type }) => type),
    [
      "started",
      "recovery-completed",
      "operation-started",
      "operation-completed",
      "operation-started",
      "operation-completed",
      "operation-started",
      "operation-completed",
      "operation-started",
      "operation-completed",
      "verification-completed",
      "outcome",
    ],
  );
});

test("accepts only an equivalent regenerated Finder icon after completion", async () => {
  const emptySha256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const approvedIcon = {
    relativePath: "docs/Icon\r",
    device: "10",
    inode: "20",
    size: "0",
    modifiedTime: "123456789",
    sha256: emptySha256,
  };
  const draft = repairPlanDraft();
  draft.inventory.localArtifacts.push(approvedIcon);
  draft.decisions.push({
    sourceId: "local:10:20",
    decision: "retained",
    evidence: ["Generated Finder icon remains outside the Drive inventory."],
  });
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);
  const plan = createRepairPlan(draft);
  const events: RepairJournalEvent[] = [];
  let currentIcons = [approvedIcon];
  const recoveryResult = {
    drive: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      recoveryRootId: "recovery-root",
      retirementRootId: "retired-root",
      items: [],
      verified: true as const,
    },
    bytes: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      path: "/separate/snapshot",
      items: [],
      localArtifacts: [approvedIcon],
      protection: "read-only-and-user-immutable" as const,
      verified: true as const,
    },
  };
  const drive: RepairExecutionDrive = {
    inventory: async () => ({
      ...plan.inventory,
      localArtifacts: currentIcons,
    }),
    createFolder: async ({ operationId, parentId, name }) => ({
      itemId: operationId,
      parentId,
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
    createFile: async ({ parentId, name }) => ({
      itemId: "register-id",
      parentId,
      name,
      mimeType: "application/jsonl",
    }),
    relocateItem: async ({ sourceId, parentId, name }) => ({
      itemId: sourceId,
      parentId,
      name,
      mimeType: "application/pdf",
    }),
    verifyContinuation: async () => ({ blockers: [], recovered: [] }),
    verifyPostcondition: async () => [],
  };
  const input = {
    plan,
    mode: "apply" as const,
    resume: false,
    drive,
    recovery: {
      recover: async () => recoveryResult,
      verify: async () => undefined,
    },
    journal: {
      read: async () => [...events],
      append: async (event: RepairJournalEvent) => {
        events.push(event);
      },
    },
  };

  assert.equal((await executeRepairPlan(input)).outcome, "completed");
  const regeneratedIcon = {
    ...approvedIcon,
    inode: "21",
    modifiedTime: "123456999",
  };
  const generatedRootIcon = {
    ...regeneratedIcon,
    relativePath: "Icon\r",
    inode: "22",
  };
  currentIcons = [regeneratedIcon, generatedRootIcon];
  assert.equal((await executeRepairPlan(input)).outcome, "completed");

  currentIcons = [
    regeneratedIcon,
    { ...generatedRootIcon, size: "1", sha256: "a".repeat(64) },
  ];
  const changed = await executeRepairPlan(input);
  assert.equal(changed.outcome, "blocked");
  assert.match(changed.evidence.join(" "), /local-only artifact/u);
});

test("fails closed when the target changes during recovery", async () => {
  const plan = createRepairPlan(repairPlanDraft());
  const events: RepairJournalEvent[] = [];
  let inventoryCalls = 0;
  let mutated = false;
  const drive: RepairExecutionDrive = {
    inventory: async () => {
      inventoryCalls += 1;
      if (inventoryCalls === 1) return plan.inventory;
      return {
        ...plan.inventory,
        items: plan.inventory.items.map((item) =>
          item.id === "source-id" ? { ...item, version: "8" } : item,
        ),
      };
    },
    createFolder: async () => {
      mutated = true;
      throw new Error("must not mutate");
    },
    createFile: async () => {
      mutated = true;
      throw new Error("must not mutate");
    },
    relocateItem: async () => {
      mutated = true;
      throw new Error("must not mutate");
    },
    verifyContinuation: async () => ({ blockers: [], recovered: [] }),
    verifyPostcondition: async () => [],
  };
  const recoveryResult = {
    drive: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      recoveryRootId: "recovery-root",
      retirementRootId: "retired-root",
      items: [],
      verified: true as const,
    },
    bytes: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      path: "/snapshot",
      items: [],
      localArtifacts: [],
      protection: "read-only-and-user-immutable" as const,
      verified: true as const,
    },
  };
  const report = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery: {
      recover: async () => recoveryResult,
      verify: async () => undefined,
    },
    journal: {
      read: async () => [...events],
      append: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(report.outcome, "blocked");
  assert.equal(mutated, false);
  assert.equal(
    events.some(({ type }) => type === "operation-started"),
    false,
  );
});

test("retires an approved local-only artifact only after verified recovery", async () => {
  const draft = repairPlanDraft();
  const artifact = {
    relativePath: ".DS_Store",
    device: "10",
    inode: "20",
    size: "8",
    modifiedTime: "123456789",
    sha256: "a".repeat(64),
  };
  draft.inventory.localArtifacts.push(artifact);
  draft.decisions.push({
    sourceId: "local:10:20",
    decision: "recovery-only",
    evidence: ["Approved Finder metadata retirement."],
  });
  draft.operations.push({
    operationId: "retire-finder-metadata",
    kind: "retire-local-artifact",
    sourceId: "local:10:20",
    relativePath: artifact.relativePath,
  });
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);
  const plan = createRepairPlan(draft);
  const events: RepairJournalEvent[] = [];
  let retired = false;
  let recoveryVerified = false;
  const recoveryResult = {
    drive: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      recoveryRootId: "recovery-root",
      retirementRootId: "retired-root",
      items: [],
      verified: true as const,
    },
    bytes: {
      changeSetId: plan.changeSetId,
      planDigest: plan.planDigest,
      path: "/snapshot",
      items: [],
      localArtifacts: [artifact],
      protection: "read-only-and-user-immutable" as const,
      verified: true as const,
    },
  };
  const report = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive: {
      inventory: async () =>
        retired ? { ...plan.inventory, localArtifacts: [] } : plan.inventory,
      createFolder: async ({ operationId, parentId, name }) => ({
        itemId: operationId,
        parentId,
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
      createFile: async ({ parentId, name }) => ({
        itemId: "register-id",
        parentId,
        name,
        mimeType: "application/jsonl",
      }),
      relocateItem: async ({ sourceId, parentId, name }) => ({
        itemId: sourceId,
        parentId,
        name,
        mimeType: "application/pdf",
      }),
      verifyContinuation: async () => ({ blockers: [], recovered: [] }),
      verifyPostcondition: async () => [],
    },
    recovery: {
      recover: async () => recoveryResult,
      verify: async () => {
        recoveryVerified = true;
      },
    },
    local: {
      retireArtifact: async (approved) => {
        assert.equal(recoveryVerified, true);
        assert.deepEqual(approved, artifact);
        retired = true;
        return {
          itemId: "local:10:20",
          parentId: "/snapshot",
          name: artifact.relativePath,
          mimeType: "application/vnd.academic-os.retired-local-artifact",
        };
      },
      verifyRetired: async () => retired,
    },
    journal: {
      read: async () => [...events],
      append: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(report.outcome, "completed");
  assert.equal(retired, true);
});
