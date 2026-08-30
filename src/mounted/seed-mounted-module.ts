import type { SeedMode, SeedPlan, SeedReport } from "../seed/index.js";
import { resolveConfiguredRoots } from "./resolve-configured-roots.js";
import type {
  ModuleSeedTargetIdentity,
  SeedTargetIdentity,
} from "./seed-operation-journal.js";
import { seedMountedTarget } from "./seed-mounted-target.js";
import {
  auditProjectedSeedTarget,
  auditSeedRoot,
  auditSeedTarget,
  inspectSeedTarget,
  seedContractVersion,
  seedTargetIdentity,
} from "./seed-target-state.js";
import type { LocalConfig, SeedExecutionOptions } from "./types.js";

export async function seedMountedModule(
  config: LocalConfig,
  plan: SeedPlan,
  mode: SeedMode,
  options: SeedExecutionOptions = {},
): Promise<SeedReport> {
  const roots = await resolveConfiguredRoots(config);
  const target = seedTargetIdentity(roots.semesterRoot, plan);
  const result = await seedMountedTarget(
    {
      parentRoot: roots.semesterRoot,
      stateRoot: roots.stateRoot,
      target,
      plan,
      contractVersion: seedContractVersion(plan),
      stagingPrefix: `.academic-os-stage-${plan.module}-`,
      inspectTarget: async () => await inspectSeedTarget(target, plan),
      auditProjectedTarget: async () =>
        await auditProjectedSeedTarget(target, plan),
      auditRoot: async (root) => await auditSeedRoot(root, plan),
      auditTarget: async () => await auditSeedTarget(target, plan),
      sameTarget: sameModuleTarget,
      completedEvidence:
        "Existing module matches the approved plan; no changes proposed and repeated resume is a no-op.",
    },
    mode,
    options,
  );
  return {
    schemaVersion: 1,
    module: { code: plan.module, semester: plan.semester },
    ...result,
  };
}

function sameModuleTarget(
  left: SeedTargetIdentity,
  right: SeedTargetIdentity,
): boolean {
  if (!isModuleTarget(left) || !isModuleTarget(right)) return false;
  return (
    left.module === right.module &&
    left.semester === right.semester &&
    left.semesterRoot === right.semesterRoot &&
    left.moduleRoot === right.moduleRoot
  );
}

function isModuleTarget(
  target: SeedTargetIdentity,
): target is ModuleSeedTargetIdentity {
  return !("kind" in target);
}
