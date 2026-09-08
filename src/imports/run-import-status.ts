import { planCohortAudit } from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import {
  observeModuleImportStatus,
  OperationalError,
} from "../mounted/index.js";
import type {
  ImportStatus,
  ImportStatusReport,
  ImportStatusSummary,
  ModuleImportStatus,
} from "./index.js";

export async function runImportStatus(input: {
  config: AcademicConfig;
  observedAt: string;
  maxAgeHours: number;
}): Promise<ImportStatusReport> {
  const plan = planCohortAudit(input.config);
  const modules: ModuleImportStatus[] = [];
  for (const targetConfig of plan.targets) {
    try {
      const observed = await observeModuleImportStatus({
        config: targetConfig,
        observedAt: input.observedAt,
        maxAgeHours: input.maxAgeHours,
      });
      modules.push({
        module: observed.module,
        status: "observed",
        roots: observed.roots,
      });
    } catch (error) {
      const operationalError =
        error instanceof OperationalError
          ? error
          : new OperationalError(
              "operational-failure",
              "Import status could not read the module target.",
            );
      modules.push({
        module: {
          semester: targetConfig.semester,
          module: targetConfig.module,
        },
        status: "invalid",
        roots: [],
        error: {
          code: operationalError.code,
          message: operationalError.message,
        },
      });
      plan.selection.unresolved.push({
        semester: targetConfig.semester,
        module: targetConfig.module,
        reason: operationalError.code,
      });
    }
  }
  const summary = summarize(modules);
  const outcome =
    plan.selection.unresolved.length > 0 ||
    summary.invalidModules > 0 ||
    summary.roots.invalid > 0
      ? "invalid"
      : Object.entries(summary.roots).some(
            ([status, count]) => status !== "current" && count > 0,
          )
        ? "attention"
        : "current";
  return {
    schemaVersion: 1,
    mode: "imports-status",
    activeSemester: input.config.activeSemester,
    observedAt: input.observedAt,
    maxAgeHours: input.maxAgeHours,
    outcome,
    selection: plan.selection,
    summary,
    modules,
  };
}

function summarize(modules: ModuleImportStatus[]): ImportStatusSummary {
  const roots = Object.fromEntries(
    (
      [
        "current",
        "stale",
        "running",
        "partial",
        "failed",
        "missing",
        "invalid",
      ] satisfies ImportStatus[]
    ).map((status) => [status, 0]),
  ) as Record<ImportStatus, number>;
  for (const root of modules.flatMap(
    ({ roots: observedRoots }) => observedRoots,
  )) {
    roots[root.status] += 1;
  }
  return {
    roots,
    invalidModules: modules.filter(({ status }) => status === "invalid").length,
  };
}
