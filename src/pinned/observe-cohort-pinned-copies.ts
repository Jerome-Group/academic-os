import { planCohortAudit } from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import { pinnedDocumentNames } from "../contract/pinned-documents.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import {
  type LocalConfig,
  OperationalError,
  readModuleControls,
  resolveConfiguredSemesterRoots,
  type ResolvedTarget,
  resolveTarget,
} from "../mounted/index.js";
import type {
  CohortPinnedCopies,
  ObservedModuleCopies,
  UnresolvedModule,
} from "./types.js";

// The active cohort's pinned copies, read through the same target resolution `audit` uses — so a
// case variant, a symlinked module or one outside its semester root stops this command too. Each
// module is materialized before it is read, because an undownloaded Drive file reads as empty and
// would otherwise be reported as a stale copy that needs rewriting.
export async function observeCohortPinnedCopies(
  config: AcademicConfig,
): Promise<CohortPinnedCopies> {
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
  const modules: ObservedModuleCopies[] = [];
  const moduleRoots = new Map<string, string>();
  const unresolved: UnresolvedModule[] = [];
  for (const target of planCohortAudit(config).targets) {
    const resolved = await readableModule(target);
    if ("reason" in resolved) {
      unresolved.push(resolved);
      continue;
    }
    const controls = await readModuleControls(resolved.moduleRoot);
    moduleRoots.set(resolved.module, resolved.moduleRoot);
    modules.push({
      module: resolved.module,
      semester: resolved.semester,
      controls: Object.fromEntries(
        pinnedDocumentNames
          .map((name) => [name, controls[name]])
          .filter(([, body]) => body !== undefined),
      ),
    });
  }
  return { driveMount, stateRoot, modules, moduleRoots, unresolved };
}

// Either the module, ready to read, or why it could not be — so one folder that has not synced is
// a line in the report rather than the end of the run.
async function readableModule(
  target: LocalConfig,
): Promise<ResolvedTarget | UnresolvedModule> {
  try {
    const resolved = await resolveTarget(target);
    await ensureMaterialized(resolved.moduleRoot);
    return resolved;
  } catch (error) {
    return {
      module: target.module,
      semester: target.semester,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
