import { isAbsolute, normalize } from "node:path";

import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { OperationalError, type LocalConfig } from "../mounted/index.js";
import type { CohortSelection, ExcludedModule } from "./types.js";

export interface CohortAuditPlan {
  selection: CohortSelection;
  targets: LocalConfig[];
}

export function resolveConfiguredAuditTarget(
  config: AcademicConfig,
  semester: string,
  module: string,
): LocalConfig {
  validateCohortConfig(config);
  const matchingMappings = Object.entries(config.semesters).filter(
    ([, value]) => value.modules.includes(module),
  );
  if (matchingMappings.length !== 1 || matchingMappings[0]?.[0] !== semester) {
    throw new OperationalError(
      matchingMappings.length > 1 ? "ambiguous-target" : "missing-target",
      matchingMappings.length > 1
        ? `Module ${module} is mapped to multiple semesters.`
        : `Module ${module} is not mapped to semester ${semester}.`,
    );
  }
  const semesterConfig = config.semesters[semester];
  if (semesterConfig === undefined) {
    throw new OperationalError(
      "missing-target",
      `Semester ${semester} is not configured.`,
    );
  }
  return {
    driveMount: config.driveMount,
    stateRoot: config.stateRoot,
    semester,
    module,
    semesterRoots: { [semester]: semesterConfig.root },
    ...driveApiTarget(config, semester, module),
  };
}

export function planCohortAudit(config: AcademicConfig): CohortAuditPlan {
  validateCohortConfig(config);
  const included: ConfiguredModule[] = [];
  const excluded: ExcludedModule[] = [];
  const unresolved: CohortSelection["unresolved"] = [];
  const unresolvedKeys = new Set<string>();
  const targets: LocalConfig[] = [];
  const moduleCounts = new Map<string, number>();
  for (const semester of Object.values(config.semesters)) {
    for (const module of semester.modules) {
      moduleCounts.set(module, (moduleCounts.get(module) ?? 0) + 1);
    }
  }

  for (const [semester, semesterConfig] of Object.entries(
    config.semesters,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    for (const module of [...semesterConfig.modules].sort()) {
      if ((moduleCounts.get(module) ?? 0) > 1) {
        const key = `${semester}\u0000${module}`;
        if (!unresolvedKeys.has(key)) {
          unresolved.push({
            semester,
            module,
            reason: "duplicated-module",
          });
          unresolvedKeys.add(key);
        }
        continue;
      }
      if (semester === config.activeSemester) {
        included.push({ semester, module });
        targets.push({
          driveMount: config.driveMount,
          stateRoot: config.stateRoot,
          semester,
          module,
          semesterRoots: { [semester]: semesterConfig.root },
          ...driveApiTarget(config, semester, module),
        });
      } else {
        excluded.push({
          semester,
          module,
          reason: semesterConfig.status === "past" ? "past" : "future",
        });
      }
    }
  }

  return {
    selection: { included, excluded, unresolved },
    targets,
  };
}

function driveApiTarget(
  config: AcademicConfig,
  semester: string,
  module: string,
): Pick<LocalConfig, "driveApi"> | Record<string, never> {
  const moduleFolderIds = config.driveApi?.moduleFolderIds;
  const semesterFolderIds = moduleFolderIds?.[semester];
  const moduleFolderId = semesterFolderIds?.[module];
  return typeof moduleFolderId !== "string" || moduleFolderId.length === 0
    ? {}
    : { driveApi: { moduleFolderId } };
}

function validateCohortConfig(config: AcademicConfig): void {
  for (const [semester, value] of Object.entries(config.semesters)) {
    if (
      value.root.length === 0 ||
      isAbsolute(value.root) ||
      normalize(value.root).startsWith("..")
    ) {
      throw new OperationalError(
        "invalid-config",
        `Semester mapping ${semester} is invalid.`,
      );
    }
  }
  const activeSemesters = Object.entries(config.semesters).filter(
    ([, semester]) => semester.status === "active",
  );
  if (
    activeSemesters.length !== 1 ||
    activeSemesters[0]?.[0] !== config.activeSemester
  ) {
    throw new OperationalError(
      "invalid-config",
      "Exactly one semester must be active and match activeSemester.",
    );
  }
}
