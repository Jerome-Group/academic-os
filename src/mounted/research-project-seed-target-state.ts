import { readdir } from "node:fs/promises";

import type { ResolvedResearchProject } from "../config/index.js";
import {
  planResearchProjectConformance,
  type ResearchProjectControls,
  researchProjectControlPaths,
  type ResearchProjectInventory,
} from "../conformance/index.js";
import { loadResearchProjectContract } from "../contract/load-research-project-contract.js";
import type { ResearchProjectSeedPlan } from "../seed/index.js";
import { seedFileByteLength } from "../seed/seed-operation-bytes.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { inventoryDirectory } from "./inventory-mounted-module.js";
import { readResearchProjectControls } from "./read-research-project-controls.js";
import type { ResolvedConfiguredResearchProjectRoots } from "./resolve-configured-research-project-roots.js";
import type { ResearchProjectSeedTargetIdentity } from "./seed-operation-journal.js";
import { optionalLstat } from "./seed-target-state.js";

export function researchProjectSeedTargetIdentity(
  roots: ResolvedConfiguredResearchProjectRoots,
): ResearchProjectSeedTargetIdentity {
  return {
    kind: "research-project",
    projectKey: roots.project.key,
    folder: roots.project.folder,
    parentRoot: roots.researchRoot,
    projectRoot: roots.projectRoot,
  };
}

export async function inspectResearchProjectSeedTarget(
  target: ResearchProjectSeedTargetIdentity,
  plan: ResearchProjectSeedPlan,
): Promise<string[]> {
  const matchingNames = (await readdir(target.parentRoot))
    .filter((name) => name.toUpperCase() === target.folder.toUpperCase())
    .sort();
  if (matchingNames.length > 1) {
    return [
      `Multiple research targets differ only by case: ${matchingNames.join(", ")}.`,
    ];
  }
  if (matchingNames.length === 1 && matchingNames[0] !== target.folder) {
    return [
      `Expected ${target.folder}, found case variant ${matchingNames[0]}.`,
    ];
  }
  const metadata = await optionalLstat(target.projectRoot);
  if (metadata === undefined) return [];
  if (metadata.isSymbolicLink()) {
    return [`Existing research target ${target.folder} is a symbolic link.`];
  }
  if (!metadata.isDirectory()) {
    return [`Existing research target ${target.folder} is not a directory.`];
  }
  await ensureMaterialized(target.projectRoot);
  const entries = await inventoryDirectory(target.projectRoot);
  const symlinks = entries.filter(({ kind }) => kind === "symlink");
  if (symlinks.length > 0) {
    return [
      `Existing research target contains symbolic links: ${symlinks
        .map(({ path }) => path)
        .join(", ")}.`,
    ];
  }
  const approvedRootPaths = new Set(
    plan.operations
      .map(({ path }) => path)
      .filter((path) => !path.includes("/")),
  );
  const unexpectedRoots = entries
    .filter(({ path }) => !path.includes("/") && !approvedRootPaths.has(path))
    .map(({ path }) => path);
  return unexpectedRoots.length === 0
    ? []
    : [
        `RP-ROOT-002 research-project root: Unexpected root content blocks additive seeding: ${unexpectedRoots.join(", ")}.`,
      ];
}

export async function auditProjectedResearchProjectSeedTarget(input: {
  target: ResearchProjectSeedTargetIdentity;
  project: ResolvedResearchProject;
  plan: ResearchProjectSeedPlan;
}): Promise<string[]> {
  const targetMetadata = await optionalLstat(input.target.projectRoot);
  const existingEntries =
    targetMetadata?.isDirectory() === true
      ? await inventoryDirectory(input.target.projectRoot)
      : [];
  const paths = new Set(existingEntries.map(({ path }) => path));
  const projectedEntries = [...existingEntries];
  for (const operation of input.plan.operations) {
    if (paths.has(operation.path)) continue;
    projectedEntries.push({
      path: operation.path,
      kind: operation.kind,
      modifiedAt: "1970-01-01T00:00:00.000Z",
      ...(operation.kind === "file"
        ? { size: seedFileByteLength(operation) }
        : {}),
    });
  }
  projectedEntries.sort((left, right) => left.path.localeCompare(right.path));
  const contentsByPath = new Map(
    input.plan.operations
      .filter(({ contents }) => contents !== undefined)
      .map(({ path, contents }) => [path, contents ?? ""]),
  );
  const controls = Object.fromEntries(
    Object.entries(researchProjectControlPaths).flatMap(([name, path]) => {
      const contents = contentsByPath.get(path);
      return contents === undefined ? [] : [[name, contents]];
    }),
  ) as ResearchProjectControls;
  return await auditResearchInventory({
    project: input.project,
    inventory: {
      projectKey: input.project.key,
      entries: projectedEntries,
    },
    controls,
    prefix: "Projected ",
  });
}

export async function auditResearchProjectSeedRoot(input: {
  root: string;
  project: ResolvedResearchProject;
}): Promise<string[]> {
  return await auditResearchInventory({
    project: input.project,
    inventory: {
      projectKey: input.project.key,
      entries: await inventoryDirectory(input.root),
    },
    controls: await readResearchProjectControls(input.root),
    prefix: "",
  });
}

export async function auditResearchProjectSeedTarget(input: {
  target: ResearchProjectSeedTargetIdentity;
  project: ResolvedResearchProject;
}): Promise<string[]> {
  const metadata = await optionalLstat(input.target.projectRoot);
  if (metadata === undefined || !metadata.isDirectory()) {
    return [
      `Expected research-project target is absent: ${input.target.folder}.`,
    ];
  }
  await ensureMaterialized(input.target.projectRoot);
  const entries = await inventoryDirectory(input.target.projectRoot);
  const symlinks = entries.filter(({ kind }) => kind === "symlink");
  if (symlinks.length > 0) {
    return [
      `Existing research target contains symbolic links: ${symlinks
        .map(({ path }) => path)
        .join(", ")}.`,
    ];
  }
  return await auditResearchProjectSeedRoot({
    root: input.target.projectRoot,
    project: input.project,
  });
}

async function auditResearchInventory(input: {
  project: ResolvedResearchProject;
  inventory: ResearchProjectInventory;
  controls: ResearchProjectControls;
  prefix: string;
}): Promise<string[]> {
  const audit = planResearchProjectConformance({
    target: input.project,
    inventory: input.inventory,
    controls: input.controls,
    contract: await loadResearchProjectContract(),
  });
  return audit.findings
    .filter(({ status }) => status === "fail" || status === "requires-decision")
    .map(
      ({ ruleId, path, evidence }) =>
        `${input.prefix}${ruleId} ${path}: ${evidence}`,
    );
}
