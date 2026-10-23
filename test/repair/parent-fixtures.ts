import { createHash } from "node:crypto";

import {
  createRepairPlan,
  repairApprovalDigest,
  repairDecisionDigest,
  type RepairPlanDraft,
} from "../../src/repair/index.js";
import { repairPlanDraft } from "./fixtures.js";

export const repairChildKinds = [
  "create-folder",
  "create-file",
  "relocate-item",
  "curation-register",
] as const;

export function repairFileParentFixture(
  childKind: (typeof repairChildKinds)[number],
) {
  const draft = repairPlanDraft();
  const parent = { kind: "planned", operationId: "create-parent" } as const;
  draft.operations.unshift({
    operationId: parent.operationId,
    kind: "create-folder",
    parent: { kind: "existing", id: "module-id" },
    name: "Synthetic parent",
  });
  if (childKind === "create-folder" || childKind === "create-file") {
    draft.operations.splice(
      1,
      0,
      childKind === "create-folder"
        ? {
            operationId: "create-child",
            kind: "create-folder",
            parent,
            name: "Synthetic child",
          }
        : {
            operationId: "create-child",
            kind: "create-file",
            parent,
            name: "Synthetic child",
            mimeType: "text/plain",
            contents: "Synthetic child file.\n",
          },
    );
  } else if (childKind === "relocate-item") {
    const destination = { parent, name: "ZZ9999_Source_A.pdf" };
    draft.operations[3] = {
      operationId: "move-source",
      kind: "relocate-item",
      sourceId: "source-id",
      destination,
    };
    draft.decisions[0] = {
      sourceId: "source-id",
      decision: "curated",
      destination,
      evidence: ["Approved synthetic relocation."],
    };
  } else {
    draft.curationRegisterParent = parent;
  }
  approve(draft);
  const plan = createRepairPlan(draft);
  const fileParent = {
    operationId: parent.operationId,
    kind: "create-file",
    parent: { kind: "existing", id: "module-id" },
    name: "Synthetic parent",
    mimeType: "text/plain",
    contents: "Synthetic parent file.\n",
  } as const;
  draft.operations[0] = fileParent;
  approve(draft);
  plan.operations[0] = fileParent;
  plan.approval = draft.approval;
  const { planDigest: _planDigest, ...payload } = plan;
  plan.planDigest = createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex");
  return { draft, plan };
}

export function nestedRepairPlanDraft(): RepairPlanDraft {
  const draft = repairPlanDraft();
  draft.operations.splice(
    2,
    0,
    {
      operationId: "create-nested-folder",
      kind: "create-folder",
      parent: { kind: "planned", operationId: "create-materials" },
      name: "Synthetic nested folder",
    },
    {
      operationId: "create-nested-file",
      kind: "create-file",
      parent: { kind: "planned", operationId: "create-nested-folder" },
      name: "Synthetic nested file.txt",
      mimeType: "text/plain",
      contents: "Synthetic nested file.\n",
    },
  );
  approve(draft);
  return draft;
}

function approve(draft: RepairPlanDraft): void {
  draft.approval.decisionDigest = repairDecisionDigest(draft.decisions);
  draft.approval.approvedPlanDigest = repairApprovalDigest(draft);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
