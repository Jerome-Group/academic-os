import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRepairPlan,
  executeRepairPlan,
  type RepairExecutionDrive,
  type RepairExecutionJournalStore,
  type RepairExecutionRecovery,
  type RepairJournalEvent,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

test("reconciles an externally completed operation before explicit resume", async () => {
  const plan = createRepairPlan(repairPlanDraft());
  const events: RepairJournalEvent[] = [];
  const store: RepairExecutionJournalStore = {
    read: async () => [...events],
    append: async (event) => {
      events.push(event);
    },
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
  const recovery: RepairExecutionRecovery = {
    recover: async () => recoveryResult,
    verify: async () => undefined,
  };
  let firstMove = true;
  let createdId = "";
  const drive: RepairExecutionDrive = {
    inventory: async () => plan.inventory,
    createFolder: async ({ parentId, name }) => {
      createdId = "new-learning-id";
      return {
        itemId: createdId,
        parentId,
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
    },
    createFile: async ({ parentId, name }) => ({
      itemId: "curation-register-id",
      parentId,
      name,
      mimeType: "application/jsonl",
    }),
    relocateItem: async () => {
      if (firstMove) {
        firstMove = false;
        throw new Error("Connection lost after Drive accepted the move.");
      }
      assert.fail("reconciled move must not execute twice");
    },
    verifyContinuation: async () => ({
      blockers: [],
      recovered: [
        {
          operationId: "move-source",
          result: {
            itemId: "source-id",
            parentId: createdId,
            name: "ZZ9999_Source_A.pdf",
            mimeType: "application/pdf",
          },
        },
      ],
    }),
    verifyPostcondition: async () => [],
  };

  const interrupted = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(interrupted.outcome, "partially-completed");

  const inspection = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(inspection.outcome, "safely-resumable");
  assert.equal(
    events.filter(({ type }) => type === "operation-completed").length,
    2,
  );
  assert.deepEqual(inspection.remainingOperations, [
    "record-curation-decisions",
  ]);

  const resumed = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: true,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(resumed.outcome, "completed");

  const eventCount = events.length;
  const repeated = await executeRepairPlan({
    plan,
    mode: "preview",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(repeated.outcome, "completed");
  assert.equal(events.length, eventCount);
});

test("requires explicit resume to finish interrupted recovery", async () => {
  const plan = createRepairPlan(repairPlanDraft());
  const events: RepairJournalEvent[] = [];
  const store: RepairExecutionJournalStore = {
    read: async () => [...events],
    append: async (event) => {
      events.push(event);
    },
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
  let recoverCalls = 0;
  const recovery: RepairExecutionRecovery = {
    recover: async () => {
      recoverCalls += 1;
      if (recoverCalls === 1) throw new Error("snapshot interrupted");
      return recoveryResult;
    },
    verify: async () => undefined,
  };
  const drive: RepairExecutionDrive = {
    inventory: async () => plan.inventory,
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

  const interrupted = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(interrupted.outcome, "blocked");

  const inspected = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: false,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(inspected.outcome, "safely-resumable");
  assert.equal(recoverCalls, 1);

  const resumed = await executeRepairPlan({
    plan,
    mode: "apply",
    resume: true,
    drive,
    recovery,
    journal: store,
  });
  assert.equal(resumed.outcome, "completed");
  assert.equal(recoverCalls, 2);
});

for (const phase of ["final-recovery", "postcondition"] as const) {
  test(`resumes safely after ${phase} verification interruption`, async () => {
    const plan = createRepairPlan(repairPlanDraft());
    const events: RepairJournalEvent[] = [];
    let recoveryVerifications = 0;
    let postconditionVerifications = 0;
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
    const drive: RepairExecutionDrive = {
      inventory: async () => plan.inventory,
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
      verifyPostcondition: async () => {
        postconditionVerifications += 1;
        return phase === "postcondition" && postconditionVerifications === 1
          ? ["synthetic conformance interruption"]
          : [];
      },
    };
    const recovery: RepairExecutionRecovery = {
      recover: async () => recoveryResult,
      verify: async () => {
        recoveryVerifications += 1;
        if (phase === "final-recovery" && recoveryVerifications === 2) {
          throw new Error("synthetic final recovery interruption");
        }
      },
    };
    const journal: RepairExecutionJournalStore = {
      read: async () => [...events],
      append: async (event) => {
        events.push(event);
      },
    };

    const interrupted = await executeRepairPlan({
      plan,
      mode: "apply",
      resume: false,
      drive,
      recovery,
      journal,
    });
    assert.equal(interrupted.outcome, "partially-completed");

    const inspected = await executeRepairPlan({
      plan,
      mode: "apply",
      resume: false,
      drive,
      recovery,
      journal,
    });
    assert.equal(inspected.outcome, "safely-resumable");

    const resumed = await executeRepairPlan({
      plan,
      mode: "apply",
      resume: true,
      drive,
      recovery,
      journal,
    });
    assert.equal(resumed.outcome, "completed");
  });
}

test("reconciles unlink completed before local retirement journal publication", async () => {
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
  const { repairApprovalDigest, repairDecisionDigest } = await import(
    "../../src/repair/index.js"
  );
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);
  const plan = createRepairPlan(draft);
  const events: RepairJournalEvent[] = [];
  let artifactExists = true;
  let interruptPublication = true;
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
  const drive: RepairExecutionDrive = {
    inventory: async () => ({
      ...plan.inventory,
      localArtifacts: artifactExists ? [artifact] : [],
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
  const journal: RepairExecutionJournalStore = {
    read: async () => [...events],
    append: async (event) => {
      if (
        interruptPublication &&
        event.type === "operation-completed" &&
        event.operationId === "retire-finder-metadata"
      ) {
        interruptPublication = false;
        throw new Error("journal publication interrupted");
      }
      events.push(event);
    },
  };
  const input = {
    plan,
    mode: "apply" as const,
    drive,
    recovery: {
      recover: async () => recoveryResult,
      verify: async () => undefined,
    },
    local: {
      retireArtifact: async () => {
        artifactExists = false;
        return {
          itemId: "local:10:20",
          parentId: "/snapshot",
          name: artifact.relativePath,
          mimeType: "application/vnd.academic-os.retired-local-artifact",
        };
      },
      verifyRetired: async () => !artifactExists,
    },
    journal,
  };
  const interrupted = await executeRepairPlan({ ...input, resume: false });
  assert.equal(interrupted.outcome, "partially-completed");

  const inspected = await executeRepairPlan({ ...input, resume: false });
  assert.equal(inspected.outcome, "safely-resumable");
  assert.ok(inspected.completedOperations.includes("retire-finder-metadata"));

  const resumed = await executeRepairPlan({ ...input, resume: true });
  assert.equal(resumed.outcome, "completed");
});
