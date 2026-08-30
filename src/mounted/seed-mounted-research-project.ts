import {
  type AcademicConfig,
  requireActiveResearchProject,
} from "../config/index.js";
import type {
  ResearchProjectSeedPlan,
  ResearchProjectSeedReport,
  SeedMode,
} from "../seed/index.js";
import {
  auditProjectedResearchProjectSeedTarget,
  auditResearchProjectSeedRoot,
  auditResearchProjectSeedTarget,
  inspectResearchProjectSeedTarget,
  researchProjectSeedTargetIdentity,
} from "./research-project-seed-target-state.js";
import { resolveConfiguredResearchProjectRoots } from "./resolve-configured-research-project-roots.js";
import type {
  ResearchProjectSeedTargetIdentity,
  SeedTargetIdentity,
} from "./seed-operation-journal.js";
import { seedMountedTarget } from "./seed-mounted-target.js";
import type { SeedExecutionOptions } from "./types.js";

export async function seedMountedResearchProject(
  config: AcademicConfig,
  plan: ResearchProjectSeedPlan,
  mode: SeedMode,
  options: SeedExecutionOptions = {},
): Promise<ResearchProjectSeedReport> {
  const roots = await resolveConfiguredResearchProjectRoots(
    config,
    plan.target.key,
  );
  if (mode === "apply") requireActiveResearchProject(roots.project);
  const target = researchProjectSeedTargetIdentity(roots);
  const result = await seedMountedTarget(
    {
      parentRoot: roots.researchRoot,
      stateRoot: roots.stateRoot,
      target,
      plan,
      contractVersion: plan.contractVersion,
      stagingPrefix: `.academic-os-stage-research-${plan.target.key}-`,
      planningBlockers: targetPlanBlockers(target, plan),
      inspectTarget: async () =>
        await inspectResearchProjectSeedTarget(target, plan),
      auditProjectedTarget: async () =>
        await auditProjectedResearchProjectSeedTarget({
          target,
          project: roots.project,
          plan,
        }),
      auditRoot: async (root) =>
        await auditResearchProjectSeedRoot({ root, project: roots.project }),
      auditTarget: async () =>
        await auditResearchProjectSeedTarget({
          target,
          project: roots.project,
        }),
      sameTarget: sameResearchTarget,
      completedEvidence:
        "Existing research project matches the approved plan; no changes proposed and repeated resume is a no-op.",
    },
    mode,
    options,
  );
  return {
    schemaVersion: 1,
    project: { key: plan.target.key, folder: plan.target.folder },
    ...result,
  };
}

function targetPlanBlockers(
  target: ResearchProjectSeedTargetIdentity,
  plan: ResearchProjectSeedPlan,
): string[] {
  return target.projectKey === plan.target.key &&
    target.folder === plan.target.folder
    ? []
    : ["Configured research target does not match the approved seed plan."];
}

function sameResearchTarget(
  left: SeedTargetIdentity,
  right: SeedTargetIdentity,
): boolean {
  if (!isResearchTarget(left) || !isResearchTarget(right)) return false;
  return (
    left.projectKey === right.projectKey &&
    left.folder === right.folder &&
    left.parentRoot === right.parentRoot &&
    left.projectRoot === right.projectRoot
  );
}

function isResearchTarget(
  target: SeedTargetIdentity,
): target is ResearchProjectSeedTargetIdentity {
  return "kind" in target && target.kind === "research-project";
}
