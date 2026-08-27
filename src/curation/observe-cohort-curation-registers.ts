import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { planCohortAudit } from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import { writtenControlPaths } from "../conformance/control-paths.js";
import {
  type DeclaredImporterSource,
  readDefinitionImporterSources,
} from "../conformance/index.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import {
  type LocalConfig,
  OperationalError,
  readModuleControls,
  resolveConfiguredSemesterRoots,
  type ResolvedTarget,
  resolveTarget,
} from "../mounted/index.js";
import { hashSource } from "./hash-source.js";
import {
  closedCurationKeys,
  readCurationRegisterEvents,
  standingCurationItems,
  walkedCurationItems,
} from "./read-curation-register.js";
import { unnumberedSourcePath } from "./unnumbered-source-path.js";
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
  const sources = readDefinitionImporterSources(controls.definition);
  const integrations = sources.map(({ integration }) => integration);
  const mirror = await indexMirror(resolved.moduleRoot, sources);
  return {
    module: resolved.module,
    moduleRoot: resolved.moduleRoot,
    register: {
      module: resolved.module,
      semester: resolved.semester,
      register,
      integrations,
      ...(await observeSources(resolved.moduleRoot, {
        mirror,
        items: legacyItems(register, integrations),
      })),
    },
  };
}

// Only the sources whose standing line still carries legacy identity are read. Everything else is
// already joined, and a pass that hashed a whole mirror to prove that would be reading the Owner's
// material for no decision it can reach.
async function observeSources(
  moduleRoot: string,
  input: { mirror: MirrorIndex; items: readonly CurationItem[] },
): Promise<{
  sources: Map<string, ObservedCurationSource>;
  ambiguousSources: Set<string>;
}> {
  const sources = new Map<string, ObservedCurationSource>();
  const ambiguousSources = new Set<string>();
  for (const item of input.items) {
    const found = input.mirror.get(item.key);
    if (found === undefined) continue;
    if (found === ambiguous) {
      ambiguousSources.add(item.key);
      continue;
    }
    const digests = await hashSource(join(moduleRoot, found.location));
    if (digests !== undefined) {
      sources.set(item.key, {
        sourcePath: found.sourcePath,
        location: found.location,
        ...digests,
      });
    }
  }
  return { sources, ambiguousSources };
}

export const ambiguous = Symbol("two files answer to one unnumbered path");
type MirrorEntry = { sourcePath: string; location: string };
type MirrorIndex = Map<string, MirrorEntry | typeof ambiguous>;

// The mirror keyed the way contract-v4 identity names it, because the `NN ` prefix a standing line
// recorded is exactly what shifts when material is inserted or renumbered upstream. Looking an item
// up by the path it was filed under would miss the files legacy identity fails hardest for.
export async function indexMirror(
  moduleRoot: string,
  sources: readonly DeclaredImporterSource[],
): Promise<MirrorIndex> {
  const index: MirrorIndex = new Map();
  for (const { integration, destinations } of sources) {
    for (const destination of destinations) {
      const root = join(moduleRoot, destination);
      const entries = await readdir(root, {
        recursive: true,
        withFileTypes: true,
      }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const sourcePath = relative(root, join(entry.parentPath, entry.name))
          .split(sep)
          .join("/");
        // Keyed by the integration a register line records, so a mirror entry and the line naming
        // the same source meet; the location keeps the destination, which is where it actually is.
        const key = `${integration}/${unnumberedSourcePath(sourcePath)}`;
        index.set(
          key,
          index.has(key)
            ? ambiguous
            : { sourcePath, location: `${destination}/${sourcePath}` },
        );
      }
    }
  }
  return index;
}

function legacyItems(
  register: string,
  integrations: readonly string[],
): CurationItem[] {
  try {
    const walked = walkedCurationItems(
      readCurationRegisterEvents(register),
      integrations,
    );
    const closed = closedCurationKeys(walked);
    return standingCurationItems(walked).filter(
      (item) => item.identity === "legacy" && !closed.has(item.key),
    );
  } catch {
    // A register that will not parse is a blocker the plan reports; nothing is hashed for it.
    return [];
  }
}
