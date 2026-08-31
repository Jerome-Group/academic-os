import type { AcademicConfig } from "../config/index.js";
import type {
  ResearchProjectControls,
  ResearchProjectInventory,
} from "../conformance/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { inventoryDirectory } from "./inventory-mounted-module.js";
import { readResearchProjectControls } from "./read-research-project-controls.js";
import {
  resolveConfiguredResearchProjectRoots,
  type ResolvedConfiguredResearchProjectRoots,
} from "./resolve-configured-research-project-roots.js";

export interface MountedResearchProjectAuditInput {
  target: ResolvedConfiguredResearchProjectRoots;
  inventory: ResearchProjectInventory;
  controls: ResearchProjectControls;
}

export async function inspectMountedResearchProject(
  config: AcademicConfig,
  key: string,
): Promise<MountedResearchProjectAuditInput> {
  const target = await resolveConfiguredResearchProjectRoots(config, key, {
    requireProject: true,
  });
  await ensureMaterialized(target.projectRoot);
  const inventory: ResearchProjectInventory = {
    projectKey: target.project.key,
    entries: await inventoryDirectory(target.projectRoot),
    provenance: {
      source: "mounted",
      target: target.projectRoot,
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 0,
    },
  };
  return {
    target,
    inventory,
    controls: await readResearchProjectControls(target.projectRoot),
  };
}
