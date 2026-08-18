import { learningWorkspacePaths } from "../contract/learning-workspace.js";
import { requiredPathFindings } from "./required-paths.js";
import type { Finding, Inventory, InventoryEntryKind } from "./types.js";

const learningWorkspaceRule = {
  ruleId: "MF-LEARNING-001",
  subject: "workspace",
  applicability:
    "The Teaching workspace is seeded into every module folder, used or not.",
} as const;

// The activity areas and their contents, and nothing below them: a Lecture-unit folder, a tutorial
// folder or a past paper is outside every required path here, so it produces no finding at all.
export function auditLearningWorkspace(
  inventory: Inventory,
  expectedWorkspace: ReadonlyArray<
    readonly [string, InventoryEntryKind]
  > = learningWorkspacePaths,
): Finding[] {
  return requiredPathFindings(
    inventory,
    expectedWorkspace,
    learningWorkspaceRule,
  );
}
