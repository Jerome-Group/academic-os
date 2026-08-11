import {
  auditModule,
  readDefinitionContractVersion,
} from "../conformance/index.js";
import type { AcademicConfig } from "../config/index.js";
import {
  inspectMountedModule,
  OperationalError,
  recordMountedAuditObservation,
  resolveConfiguredSemesterRoots,
} from "../mounted/index.js";
import { createJsonAuditReport } from "../report/index.js";
import { planCohortAudit } from "./plan-cohort-audit.js";
import type { CohortAuditReport } from "./types.js";

export async function runCohortAudit(
  config: AcademicConfig,
): Promise<CohortAuditReport> {
  const plan = planCohortAudit(config);
  const activeSemester = config.semesters[config.activeSemester];
  if (activeSemester === undefined) {
    throw new OperationalError(
      "invalid-config",
      `Active semester ${config.activeSemester} is not configured.`,
    );
  }
  await resolveConfiguredSemesterRoots({
    driveMount: config.driveMount,
    stateRoot: config.stateRoot,
    semester: config.activeSemester,
    semesterRoot: activeSemester.root,
  });
  const modules: CohortAuditReport["modules"] = [];
  for (const targetConfig of plan.targets) {
    try {
      const { target, inventory, controls } =
        await inspectMountedModule(targetConfig);
      const result = auditModule({
        moduleCode: target.module,
        semester: target.semester,
        inventory,
        controls,
      });
      const recorded = await recordMountedAuditObservation({
        target,
        inventory,
        controls,
        result,
        observedAt: new Date().toISOString(),
        contractVersion: readDefinitionContractVersion(controls.definition),
      });
      modules.push(
        createJsonAuditReport(target, result, recorded, "monitoring"),
      );
    } catch (error) {
      const operationalError =
        error instanceof OperationalError
          ? error
          : new OperationalError(
              "operational-failure",
              "Module audit failed unexpectedly.",
            );
      modules.push({
        module: {
          code: targetConfig.module,
          semester: targetConfig.semester,
        },
        outcome: "operational-failure",
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
  const outcomes = modules.map(({ outcome }) => outcome);
  const outcome =
    plan.selection.unresolved.length > 0 ||
    outcomes.includes("operational-failure")
      ? "operational-failure"
      : outcomes.includes("requires-decision")
        ? "requires-decision"
        : outcomes.includes("deviation")
          ? "deviation"
          : "conformant";
  return {
    schemaVersion: 1,
    mode: "cohort",
    activeSemester: config.activeSemester,
    outcome,
    selection: plan.selection,
    modules,
  };
}
