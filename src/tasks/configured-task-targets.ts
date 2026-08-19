import {
  planCohortAudit,
  resolveConfiguredAuditTarget,
} from "../cohort/index.js";
import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import type { LocalConfig } from "../mounted/index.js";
import { createDeferredTaskRegisterStore } from "./deferred-task-register-store.js";
import type { TaskRefreshTarget } from "./refresh-task-registers.js";

// Every Tasks caller — the commands and the Operations server alike — addresses a module by
// semester and code and needs the same register store behind it, so the walk from configuration
// to a target lives here rather than once per entry point.
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

function taskTarget(target: LocalConfig): TaskRefreshTarget {
  return {
    semester: target.semester,
    module: target.module,
    registerStore: createDeferredTaskRegisterStore(target),
  };
}
