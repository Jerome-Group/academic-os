import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  auditModule,
  readDefinitionContractVersion,
  type ModuleControls,
} from "../conformance/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import type { SeedOperation, SeedPlan } from "../seed/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { inventoryDirectory } from "./inventory-mounted-module.js";
import { OperationalError } from "../operational-error.js";
import { readModuleControls } from "./read-module-controls.js";
import type { SeedTargetIdentity } from "./seed-operation-journal.js";

export interface OperationState {
  matching: SeedOperation[];
  remaining: SeedOperation[];
  conflicts: string[];
}

export function seedTargetIdentity(
  semesterRoot: string,
  plan: SeedPlan,
): SeedTargetIdentity {
  return {
    module: plan.module,
    semester: plan.semester,
    semesterRoot,
    moduleRoot: join(semesterRoot, plan.module),
  };
}

export function seedContractVersion(plan: SeedPlan): number | "unavailable" {
  const definition = plan.operations.find(
    ({ path }) => path === "00 Module Admin/10 Module Definition.yaml",
  );
  return readDefinitionContractVersion(definition?.contents);
}

export function publicSeedOperation(operation: SeedOperation) {
  return { kind: operation.kind, path: operation.path };
}

export async function inspectSeedOperationState(
  root: string,
  operations: SeedOperation[],
): Promise<OperationState> {
  const matching: SeedOperation[] = [];
  const remaining: SeedOperation[] = [];
  const conflicts: string[] = [];
  for (const operation of operations) {
    const state = await inspectSeedOperation(root, operation);
    if (state === "matching") matching.push(operation);
    if (state === "absent") remaining.push(operation);
    if (state === "conflict") {
      conflicts.push(`Existing content conflicts with ${operation.path}.`);
    }
  }
  return { matching, remaining, conflicts };
}

export async function inspectSeedTarget(
  target: SeedTargetIdentity,
  plan: SeedPlan,
): Promise<string[]> {
  const matchingNames = (await readdir(target.semesterRoot))
    .filter((name) => name.toUpperCase() === target.module)
    .sort();
  if (matchingNames.length > 1) {
    return [
      `Multiple targets differ only by case: ${matchingNames.join(", ")}.`,
    ];
  }
  if (matchingNames.length === 1 && matchingNames[0] !== target.module) {
    return [
      `Expected ${target.module}, found case variant ${matchingNames[0]}.`,
    ];
  }
  const metadata = await optionalLstat(target.moduleRoot);
  if (metadata === undefined) return [];
  if (metadata.isSymbolicLink()) {
    return [`Existing target ${target.module} is a symbolic link.`];
  }
  if (!metadata.isDirectory()) {
    return [`Existing target ${target.module} is not a directory.`];
  }
  await ensureMaterialized(target.moduleRoot);
  const entries = await inventoryDirectory(target.moduleRoot);
  const symlinks = entries.filter(({ kind }) => kind === "symlink");
  if (symlinks.length > 0) {
    return [
      `Existing target contains symbolic links: ${symlinks.map(({ path }) => path).join(", ")}.`,
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
        `MF-UNIVERSAL-001 module root: Unexpected root content blocks additive seeding: ${unexpectedRoots.join(", ")}.`,
      ];
}

export async function auditSeedTarget(
  target: SeedTargetIdentity,
  plan: SeedPlan,
): Promise<string[]> {
  const metadata = await optionalLstat(target.moduleRoot);
  if (metadata === undefined || !metadata.isDirectory()) {
    return [`Expected module target is absent: ${target.module}.`];
  }
  await ensureMaterialized(target.moduleRoot);
  const entries = await inventoryDirectory(target.moduleRoot);
  const symlinks = entries.filter(({ kind }) => kind === "symlink");
  if (symlinks.length > 0) {
    return [
      `Existing target contains symbolic links: ${symlinks.map(({ path }) => path).join(", ")}.`,
    ];
  }
  return await auditSeedRoot(target.moduleRoot, plan);
}

export async function auditProjectedSeedTarget(
  target: SeedTargetIdentity,
  plan: SeedPlan,
): Promise<string[]> {
  const targetMetadata = await optionalLstat(target.moduleRoot);
  const existingEntries =
    targetMetadata?.isDirectory() === true
      ? await inventoryDirectory(target.moduleRoot)
      : [];
  const paths = new Set(existingEntries.map(({ path }) => path));
  const projectedEntries = [...existingEntries];
  for (const operation of plan.operations) {
    if (paths.has(operation.path)) continue;
    projectedEntries.push({
      path: operation.path,
      kind: operation.kind,
      modifiedAt: "1970-01-01T00:00:00.000Z",
      ...(operation.kind === "file"
        ? { size: (operation.contents ?? "").length }
        : {}),
    });
  }
  projectedEntries.sort((left, right) => left.path.localeCompare(right.path));
  const contentsByPath = new Map(
    plan.operations
      .filter(({ contents }) => contents !== undefined)
      .map(({ path, contents }) => [path, contents ?? ""]),
  );
  const controls = Object.fromEntries(
    Object.entries(moduleControlPaths).flatMap(([name, path]) => {
      const contents = contentsByPath.get(path);
      return contents === undefined ? [] : [[name, contents]];
    }),
  ) as ModuleControls;
  const audit = auditModule(
    {
      moduleCode: plan.module,
      semester: plan.semester,
      inventory: { moduleCode: plan.module, entries: projectedEntries },
      controls,
    },
    await loadModuleContract(),
  );
  return audit.outcome === "conformant"
    ? []
    : audit.findings
        .filter(({ status }) => status !== "pass")
        .map(
          ({ ruleId, path, evidence }) =>
            `Projected ${ruleId} ${path}: ${evidence}`,
        );
}

export async function auditSeedRoot(
  root: string,
  plan: SeedPlan,
): Promise<string[]> {
  const audit = auditModule(
    {
      moduleCode: plan.module,
      semester: plan.semester,
      inventory: {
        moduleCode: plan.module,
        entries: await inventoryDirectory(root),
      },
      controls: await readModuleControls(root),
    },
    await loadModuleContract(),
  );
  return audit.outcome === "conformant"
    ? []
    : audit.findings
        .filter(({ status }) => status !== "pass")
        .map(({ ruleId, path, evidence }) => `${ruleId} ${path}: ${evidence}`);
}

export async function inspectSeedOperation(
  root: string,
  operation: SeedOperation,
): Promise<"absent" | "matching" | "conflict"> {
  const path = containedSeedPath(root, operation.path);
  const metadata = await optionalLstat(path);
  if (metadata === undefined) return "absent";
  if (metadata.isSymbolicLink()) return "conflict";
  if (operation.kind === "directory") {
    return metadata.isDirectory() ? "matching" : "conflict";
  }
  if (!metadata.isFile()) return "conflict";
  return (await readFile(path, "utf8")) === (operation.contents ?? "")
    ? "matching"
    : "conflict";
}

export async function createSeedOperation(
  root: string,
  operation: SeedOperation,
): Promise<void> {
  const path = containedSeedPath(root, operation.path);
  if (operation.kind === "directory") {
    await mkdir(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, operation.contents ?? "", { flag: "wx" });
}

export async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function containedSeedPath(root: string, operationPath: string): string {
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
      `Seed operation escapes its target root: ${operationPath}.`,
    );
  }
  return candidate;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
