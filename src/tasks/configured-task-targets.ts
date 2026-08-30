import {
  planCohortAudit,
  resolveConfiguredAuditTarget,
} from "../cohort/index.js";
import {
  type AcademicConfig,
  type ConfiguredModule,
  requireActiveResearchProject,
  resolveConfiguredResearchProject,
  type ResolvedResearchProject,
} from "../config/index.js";
import { researchTaskRegisterPath } from "../contract/research-project-structure.js";
import { researchTaskProvenanceKeys } from "../contract/task-register.js";
import {
  resolveConfiguredResearchProjectRoots,
  type LocalConfig,
} from "../mounted/index.js";
import {
  createDeferredPathTaskRegisterStore,
  createDeferredTaskRegisterStore,
} from "./deferred-task-register-store.js";
import type {
  TaskRefreshTarget,
  TaskRegisterTarget,
} from "./refresh-task-registers.js";

// Every Tasks caller — commands, the morning prelude and the Operations server — resolves target
// identity to the same register store here rather than rebuilding that mapping at each entry point.
export function configuredTaskTarget(
  config: AcademicConfig,
  module: ConfiguredModule,
): TaskRefreshTarget {
  return taskTarget(
    resolveConfiguredAuditTarget(config, module.semester, module.module),
  );
}

export function cohortTaskTargets(config: AcademicConfig): TaskRefreshTarget[] {
  return planCohortAudit(config).targets.map(taskTarget);
}

export function activeTaskRegisterTargets(
  config: AcademicConfig,
): TaskRegisterTarget[] {
  return [
    ...planCohortAudit(config).targets.map(taskRegisterTarget),
    ...activeResearchProjectTaskTargets(config),
  ];
}

export function configuredResearchProjectTaskTarget(
  config: AcademicConfig,
  key: string,
  options: { requireActive?: boolean } = {},
): TaskRegisterTarget {
  const project = resolveConfiguredResearchProject(config, key);
  return researchTaskTarget(
    config,
    options.requireActive === true
      ? requireActiveResearchProject(project)
      : project,
  );
}

export function activeResearchProjectTaskTargets(
  config: AcademicConfig,
): TaskRegisterTarget[] {
  return Object.keys(config.research?.projects ?? {})
    .sort()
    .map((key) => resolveConfiguredResearchProject(config, key))
    .filter(({ status }) => status === "active")
    .map((project) => researchTaskTarget(config, project));
}

function taskTarget(target: LocalConfig): TaskRefreshTarget {
  return {
    semester: target.semester,
    module: target.module,
    registerStore: createDeferredTaskRegisterStore(target),
  };
}

function taskRegisterTarget(target: LocalConfig): TaskRegisterTarget {
  return {
    identity: {
      kind: "module",
      key: `${target.semester}/${target.module}`,
      title: target.module,
    },
    registerStore: createDeferredTaskRegisterStore(target),
  };
}

function researchTaskTarget(
  config: AcademicConfig,
  project: ResolvedResearchProject,
): TaskRegisterTarget {
  return {
    identity: {
      kind: "research-project",
      key: project.key,
      title: project.taskListTitle ?? project.folder,
    },
    registerStore: createDeferredPathTaskRegisterStore({
      resolveRoot: async () =>
        (
          await resolveConfiguredResearchProjectRoots(config, project.key, {
            requireProject: true,
          })
        ).projectRoot,
      registerPath: researchTaskRegisterPath,
      provenanceKeys: researchTaskProvenanceKeys,
    }),
  };
}
