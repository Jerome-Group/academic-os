import {
  repairApprovalDigest,
  repairDecisionDigest,
  type RepairPlanDraft,
} from "../../src/repair/index.js";

export function repairPlanDraft(): RepairPlanDraft {
  const decisions: RepairPlanDraft["decisions"] = [
    {
      sourceId: "source-id",
      decision: "curated",
      destination: {
        parent: { kind: "planned", operationId: "create-materials" },
        name: "ZZ9999_Source_A.pdf",
      },
      evidence: ["Owner-approved synthetic repair fixture."],
    },
  ];
  const payload: Omit<RepairPlanDraft, "approval"> = {
    schemaVersion: 1,
    changeSetId: "11111111-1111-4111-8111-111111111111",
    module: { code: "ZZ9999", semester: "Y9S9", rootId: "module-id" },
    contractVersion: 2,
    inventory: {
      complete: true,
      observedAt: "2026-08-12T12:00:00.000Z",
      rootId: "module-id",
      items: [
        {
          id: "module-id",
          name: "ZZ9999",
          mimeType: "application/vnd.google-apps.folder",
          parentIds: ["semester-id"],
          modifiedTime: "2026-08-12T11:00:00.000Z",
          version: "1",
          capabilities: {
            canAddChildren: true,
            canListChildren: true,
            canMoveItemWithinDrive: true,
          },
        },
        {
          id: "legacy-materials-id",
          name: "001 Source Material",
          mimeType: "application/vnd.google-apps.folder",
          parentIds: ["module-id"],
          modifiedTime: "2026-08-12T11:00:00.000Z",
          version: "2",
          capabilities: {
            canAddChildren: true,
            canListChildren: true,
            canMoveItemWithinDrive: true,
          },
        },
        {
          id: "source-id",
          name: "ZZ9999 Source A.pdf",
          mimeType: "application/pdf",
          parentIds: ["legacy-materials-id"],
          modifiedTime: "2025-08-14T08:00:00.000Z",
          version: "7",
          size: "42",
          md5Checksum: "0123456789abcdef0123456789abcdef",
          capabilities: {
            canCopy: true,
            canDownload: true,
            canEdit: true,
            canMoveItemWithinDrive: true,
          },
        },
      ],
      localArtifacts: [],
    },
    decisions,
    operations: [
      {
        operationId: "create-admin",
        kind: "create-folder",
        parent: { kind: "existing", id: "module-id" },
        name: "00 Module Admin",
      },
      {
        operationId: "create-materials",
        kind: "create-folder",
        parent: { kind: "existing", id: "module-id" },
        name: "10 Learning Materials",
      },
      {
        operationId: "move-source",
        kind: "relocate-item",
        sourceId: "source-id",
        destination: {
          parent: { kind: "planned", operationId: "create-materials" },
          name: "ZZ9999_Source_A.pdf",
        },
      },
    ],
    curationRegisterParent: {
      kind: "planned",
      operationId: "create-admin",
    },
  };
  return {
    ...payload,
    approval: {
      approvedBy: "owner",
      approvedAt: "2026-08-12T12:05:00.000Z",
      decisionDigest: repairDecisionDigest(decisions),
      approvedPlanDigest: repairApprovalDigest(payload),
    },
  };
}
