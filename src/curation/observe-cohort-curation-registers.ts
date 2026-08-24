import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { md5Bytes, sha256Bytes } from "../checksum.js";
import { planCohortAudit } from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import { writtenControlPaths } from "../conformance/control-paths.js";
import { readDefinitionImporterRoots } from "../conformance/index.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import {
  type LocalConfig,
  OperationalError,
  readModuleControls,
  resolveConfiguredSemesterRoots,
  type ResolvedTarget,
  resolveTarget,
} from "../mounted/index.js";
import {
  readCurationRegisterLines,
  standingCurationItems,
} from "./read-curation-register.js";
import type {
  CohortCurationRegisters,
  CurationItem,
  ObservedCurationSource,
  ObservedModuleRegister,
  UnresolvedCurationModule,
} from "./types.js";

// The active cohort's Curation registers, and the source bytes the legacy lines among them name.
// Read through the same target resolution `audit` uses, and materialized first: an undownloaded
// Drive file lists and reads as empty, and hashing that would record a checksum of nothing as the
// item's identity.
export async function observeCohortCurationRegisters(
  config: AcademicConfig,
): Promise<CohortCurationRegisters> {
  const activeSemester = config.semesters[config.activeSemester];
  if (activeSemester === undefined) {
    throw new OperationalError(
      "invalid-config",
      `Active semester ${config.activeSemester} is not configured.`,
    );
  }
  const { driveMount, stateRoot } = await resolveConfiguredSemesterRoots({
    driveMount: config.driveMount,
    stateRoot: config.stateRoot,
    semester: config.activeSemester,
    semesterRoot: activeSemester.root,
  });
  const modules: ObservedModuleRegister[] = [];
  const moduleRoots = new Map<string, string>();
  const unresolved: UnresolvedCurationModule[] = [];
  for (const target of planCohortAudit(config).targets) {
    const observed = await observeModule(target);
    if ("reason" in observed) {
      unresolved.push(observed);
      continue;
    }
    moduleRoots.set(observed.module, observed.moduleRoot);
    modules.push(observed.register);
  }
  return { driveMount, stateRoot, modules, moduleRoots, unresolved };
}

async function observeModule(
  target: LocalConfig,
): Promise<
  | { module: string; moduleRoot: string; register: ObservedModuleRegister }
  | UnresolvedCurationModule
> {
  let resolved: ResolvedTarget;
  try {
    resolved = await resolveTarget(target);
    await ensureMaterialized(resolved.moduleRoot);
  } catch (error) {
    return {
      module: target.module,
      semester: target.semester,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const controls = await readModuleControls(resolved.moduleRoot);
  const register = controls.curationRegister;
  if (register === undefined) {
    return {
      module: resolved.module,
      semester: resolved.semester,
      reason: `No readable control exists at ${writtenControlPaths.curationRegister}.`,
    };
  }
  const importerRoots = readDefinitionImporterRoots(controls.definition);
  return {
    module: resolved.module,
    moduleRoot: resolved.moduleRoot,
    register: {
      module: resolved.module,
      semester: resolved.semester,
      register,
      importerRoots,
      sources: await observeSources(
        resolved.moduleRoot,
        register,
        importerRoots,
      ),
    },
  };
}

// Only the sources whose standing line still carries legacy identity are read. Everything else is
// already joined, and a pass that hashed a whole mirror to prove that would be reading the Owner's
// material for no decision it can reach.
async function observeSources(
  moduleRoot: string,
  register: string,
  importerRoots: readonly string[],
): Promise<Map<string, ObservedCurationSource>> {
  const sources = new Map<string, ObservedCurationSource>();
  for (const item of legacyItems(register, importerRoots)) {
    const key = `${item.integration}/${item.sourcePath}`;
    const observed = await hashSource(moduleRoot, key);
    if (observed !== undefined) sources.set(key, observed);
  }
  return sources;
}

function legacyItems(
  register: string,
  importerRoots: readonly string[],
): CurationItem[] {
  try {
    return standingCurationItems(
      readCurationRegisterLines(register),
      importerRoots,
    ).filter(({ identity }) => identity === "legacy");
  } catch {
    // A register that will not parse is a blocker the plan reports; nothing is hashed for it.
    return [];
  }
}

async function hashSource(
  moduleRoot: string,
  relativePath: string,
): Promise<ObservedCurationSource | undefined> {
  const path = join(moduleRoot, relativePath);
  if (!isContainedBy(moduleRoot, path)) return undefined;
  const metadata = await lstat(path).catch(() => undefined);
  if (metadata === undefined || metadata.isSymbolicLink() || !metadata.isFile())
    return undefined;
  const resolvedPath = await realpath(path).catch(() => undefined);
  if (resolvedPath === undefined || !isContainedBy(moduleRoot, resolvedPath)) {
    return undefined;
  }
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined) return undefined;
  return { sha256: sha256Bytes(bytes), md5: md5Bytes(bytes) };
}
