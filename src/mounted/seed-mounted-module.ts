import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { auditModule } from "../conformance/index.js";
import type { SeedMode, SeedPlan, SeedReport } from "../seed/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { inventoryDirectory } from "./inventory-mounted-module.js";
import { OperationalError } from "./operational-error.js";
import { readModuleControls } from "./read-module-controls.js";
import { renameExclusive } from "./rename-exclusive.js";
import { resolveConfiguredRoots } from "./resolve-configured-roots.js";
import type { LocalConfig } from "./types.js";

export async function seedMountedModule(
  config: LocalConfig,
  plan: SeedPlan,
  mode: SeedMode,
): Promise<SeedReport> {
  const roots = await resolveConfiguredRoots(config);
  try {
    await ensureMaterialized(roots.semesterRoot);
  } catch (error) {
    if (
      error instanceof OperationalError &&
      error.code === "unresolved-placeholder"
    ) {
      return report(plan, "blocked", [error.message]);
    }
    throw error;
  }
  const planningBlockers = [...plan.blockers, ...unresolvedPlaceholders(plan)];
  if (planningBlockers.length > 0) {
    return report(plan, "blocked", planningBlockers);
  }

  const existing = await matchingTargets(roots.semesterRoot, plan.module);
  if (existing.length > 0) {
    return await reportExistingTarget(roots.semesterRoot, plan, existing);
  }

  const staleStages = (await readdir(roots.semesterRoot)).filter((name) =>
    name.startsWith(`.academic-os-stage-${plan.module}-`),
  );
  if (staleStages.length > 0) {
    return report(plan, "blocked", [
      `Existing staging artifacts require reconciliation: ${staleStages.sort().join(", ")}.`,
    ]);
  }
  const operations = plan.operations.map(({ kind, path }) => ({ kind, path }));
  if (mode === "preview") {
    return {
      ...report(plan, "preview", [
        "Preview only; no filesystem changes were made.",
      ]),
      operations,
    };
  }

  const stagingRoot = join(
    roots.semesterRoot,
    `.academic-os-stage-${plan.module}-${randomUUID()}`,
  );
  await mkdir(stagingRoot);
  for (const operation of plan.operations) {
    const path = containedOperationPath(stagingRoot, operation.path);
    if (operation.kind === "directory") {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, operation.contents ?? "", { flag: "wx" });
    }
  }

  await ensureMaterialized(stagingRoot);
  const audit = auditModule({
    moduleCode: plan.module,
    semester: plan.semester,
    inventory: {
      moduleCode: plan.module,
      entries: await inventoryDirectory(stagingRoot),
    },
    controls: await readModuleControls(stagingRoot),
  });
  if (audit.outcome !== "conformant") {
    return {
      ...report(
        plan,
        "staged",
        audit.findings
          .filter(({ status }) => status !== "pass")
          .map(
            ({ ruleId, path, evidence }) => `${ruleId} ${path}: ${evidence}`,
          ),
      ),
      operations,
    };
  }

  const moduleRoot = join(roots.semesterRoot, plan.module);
  const publicationConflicts = await matchingTargets(
    roots.semesterRoot,
    plan.module,
  );
  if (publicationConflicts.length > 0) {
    return report(plan, "blocked", [
      `Publication target appeared during staging: ${publicationConflicts.join(", ")}.`,
    ]);
  }
  const publication = await renameExclusive(stagingRoot, moduleRoot);
  if (publication === "destination-exists") {
    return report(plan, "blocked", [
      `Publication target appeared during atomic publication: ${plan.module}.`,
    ]);
  }
  return {
    ...report(plan, "published", [
      "Staged module audited conformant and was atomically published without clobbering.",
    ]),
    operations,
  };
}

async function reportExistingTarget(
  semesterRoot: string,
  plan: SeedPlan,
  candidates: string[],
): Promise<SeedReport> {
  if (candidates.length > 1) {
    return report(plan, "blocked", [
      `Multiple targets differ only by case: ${candidates.sort().join(", ")}.`,
    ]);
  }
  const candidate = candidates[0];
  if (candidate !== plan.module) {
    return report(plan, "blocked", [
      `Expected ${plan.module}, found case variant ${candidate}.`,
    ]);
  }
  const moduleRoot = join(semesterRoot, candidate);
  const metadata = await lstat(moduleRoot);
  if (metadata.isSymbolicLink()) {
    return report(plan, "blocked", [
      `Existing target ${plan.module} is a symbolic link.`,
    ]);
  }
  if (!metadata.isDirectory()) {
    return report(plan, "blocked", [
      `Existing target ${plan.module} is not a directory.`,
    ]);
  }
  await ensureMaterialized(moduleRoot);
  const entries = await inventoryDirectory(moduleRoot);
  const symlinks = entries.filter(({ kind }) => kind === "symlink");
  if (symlinks.length > 0) {
    return report(plan, "blocked", [
      `Existing target contains symbolic links: ${symlinks.map(({ path }) => path).join(", ")}.`,
    ]);
  }
  const approvedControlConflicts = await changedApprovedControls(
    moduleRoot,
    plan,
  );
  if (approvedControlConflicts.length > 0) {
    return report(plan, "blocked", approvedControlConflicts);
  }
  const controls = await readModuleControls(moduleRoot);
  const audit = auditModule({
    moduleCode: plan.module,
    semester: plan.semester,
    inventory: {
      moduleCode: plan.module,
      entries,
    },
    controls,
  });
  if (audit.outcome === "conformant") {
    return report(plan, "published", [
      "Existing module is conformant; no changes proposed.",
    ]);
  }
  return report(
    plan,
    "blocked",
    audit.findings
      .filter(({ status }) => status !== "pass")
      .map(({ ruleId, path, evidence }) => `${ruleId} ${path}: ${evidence}`),
  );
}

async function changedApprovedControls(
  moduleRoot: string,
  plan: SeedPlan,
): Promise<string[]> {
  const approvedPaths = new Set([
    "00 Module Admin/00 Module Profile.md",
    "00 Module Admin/10 Module Definition.yaml",
  ]);
  const conflicts: string[] = [];
  for (const operation of plan.operations) {
    if (
      operation.contents === undefined ||
      !approvedPaths.has(operation.path)
    ) {
      continue;
    }
    let existing: string;
    try {
      existing = await readFile(join(moduleRoot, operation.path), "utf8");
    } catch (error) {
      if (
        isNodeError(error) &&
        ["ENOENT", "EISDIR"].includes(error.code ?? "")
      ) {
        continue;
      }
      throw error;
    }
    if (existing !== operation.contents) {
      conflicts.push(
        `Existing approved control differs from the seed plan: ${operation.path}.`,
      );
    }
  }
  return conflicts;
}

function containedOperationPath(root: string, operationPath: string): string {
  const candidate = resolve(root, operationPath);
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new OperationalError(
      "out-of-root",
      `Seed operation escapes its staging root: ${operationPath}.`,
    );
  }
  return candidate;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function matchingTargets(
  root: string,
  module: string,
): Promise<string[]> {
  return (await readdir(root))
    .filter((name) => name.toUpperCase() === module)
    .sort();
}

function unresolvedPlaceholders(plan: SeedPlan): string[] {
  return plan.operations.flatMap(({ path, contents }) =>
    contents !== undefined &&
    /\{\{[^}]+\}\}|<[^>\n]*(?:TODO|PLACEHOLDER|official URL)[^>\n]*>/iu.test(
      contents,
    )
      ? [`Unresolved placeholder in ${path}.`]
      : [],
  );
}

function report(
  plan: SeedPlan,
  outcome: SeedReport["outcome"],
  evidence: string[],
): SeedReport {
  return {
    schemaVersion: 1,
    module: { code: plan.module, semester: plan.semester },
    outcome,
    operations: [],
    evidence,
  };
}
