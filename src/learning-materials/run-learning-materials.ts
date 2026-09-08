import { planCohortAudit } from "../cohort/index.js";
import type { AcademicConfig } from "../config/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { inspectMountedModule, OperationalError } from "../mounted/index.js";
import { assessLearningMaterials } from "./assess-learning-materials.js";
import type {
  LearningMaterialsAssessment,
  LearningMaterialsReport,
} from "./types.js";

export async function runLearningMaterials(
  config: AcademicConfig,
): Promise<LearningMaterialsReport> {
  const plan = planCohortAudit(config);
  const modules: LearningMaterialsReport["modules"] = [];
  for (const targetConfig of plan.targets) {
    try {
      const mounted = await inspectMountedModule(targetConfig);
      const sourceMap = mounted.inventory.entries.some(
        ({ path, kind }) =>
          path === moduleControlPaths.sourceMap && kind === "file",
      )
        ? mounted.controls.sourceMap
        : undefined;
      const assessment = assessLearningMaterials(sourceMap, mounted.inventory);
      modules.push({
        module: {
          semester: targetConfig.semester,
          module: targetConfig.module,
        },
        outcome: assessment.outcome,
        assessment,
      });
    } catch (error) {
      const operationalError =
        error instanceof OperationalError
          ? error
          : new OperationalError(
              "operational-failure",
              "Learning materials could not read the module target.",
            );
      modules.push({
        module: {
          semester: targetConfig.semester,
          module: targetConfig.module,
        },
        outcome: "incomplete",
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
  return {
    schemaVersion: 1,
    mode: "learning-materials",
    activeSemester: config.activeSemester,
    outcome: cohortOutcome(
      modules.map(({ outcome }) => outcome),
      plan.selection.unresolved.length,
    ),
    selection: plan.selection,
    modules,
  };
}

function cohortOutcome(
  outcomes: LearningMaterialsAssessment["outcome"][],
  unresolved: number,
): LearningMaterialsAssessment["outcome"] {
  if (unresolved > 0 || outcomes.includes("incomplete")) return "incomplete";
  if (outcomes.includes("invalid")) return "invalid";
  return outcomes.includes("gaps") ? "gaps" : "available";
}
