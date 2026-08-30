import { planModuleConformance } from "../conformance/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import {
  type AcademicConfig,
  resolveConfiguredResearchProjects,
} from "../config/index.js";
import { loadResearchProjectContract } from "../contract/load-research-project-contract.js";
import {
  inspectMountedModule,
  inspectMountedResearchProject,
  appendMountedAuditObservation,
  OperationalError,
  readMountedAuditHistory,
  resolveConfiguredSemesterRoots,
} from "../mounted/index.js";
import { createJsonAuditReport } from "../report/index.js";
import { evaluateResearchProjectAudit } from "./evaluate-research-project-audit.js";
import { planCohortAudit } from "./plan-cohort-audit.js";
import type { CohortAuditReport } from "./types.js";

export async function runCohortAudit(
  config: AcademicConfig,
): Promise<CohortAuditReport> {
  const plan = planCohortAudit(config);
  const configuredResearchProjects =
    config.research === undefined
      ? undefined
      : resolveConfiguredResearchProjects(config);
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
  const contract = await loadModuleContract();
  const modules: CohortAuditReport["modules"] = [];
  for (const targetConfig of plan.targets) {
    try {
      const { target, inventory, controls } =
        await inspectMountedModule(targetConfig);
      const history = await readMountedAuditHistory(target);
      const result = planModuleConformance({
        contract,
        target: {
          moduleCode: target.module,
          semester: target.semester,
          identity: target.moduleRoot,
        },
        inventory,
        controls,
        ...(history.previous === undefined
          ? {}
          : { priorObservation: history.previous }),
        observedAt: new Date().toISOString(),
      });
      const recorded = await appendMountedAuditObservation({
        target,
        observation: result.observation,
        comparison: result.comparison,
        historyDiagnostics: history.diagnostics,
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
  const researchSelection: CohortAuditReport["researchSelection"] =
    configuredResearchProjects === undefined
      ? undefined
      : {
          included: configuredResearchProjects
            .filter(({ status }) => status === "active")
            .map(({ key, folder }) => ({ key, folder })),
          excluded: configuredResearchProjects
            .filter(({ status }) => status === "inactive")
            .map(({ key, folder }) => ({
              key,
              folder,
              reason: "inactive" as const,
            })),
          unresolved: [],
        };
  const researchProjects: CohortAuditReport["researchProjects"] =
    configuredResearchProjects === undefined ? undefined : [];
  if (
    configuredResearchProjects !== undefined &&
    researchProjects !== undefined &&
    researchSelection !== undefined
  ) {
    let researchContract:
      | ReturnType<typeof loadResearchProjectContract>
      | undefined;
    for (const project of configuredResearchProjects.filter(
      ({ status }) => status === "active",
    )) {
      try {
        const inspected = await inspectMountedResearchProject(
          config,
          project.key,
        );
        if (researchContract === undefined) {
          researchContract = loadResearchProjectContract();
        }
        researchProjects.push(
          await evaluateResearchProjectAudit({
            contract: await researchContract,
            target: inspected.target,
            inventory: inspected.inventory,
            controls: inspected.controls,
          }),
        );
      } catch (error) {
        const operationalError = asOperationalError(
          error,
          "Research-project audit failed unexpectedly.",
        );
        researchProjects.push({
          project: { key: project.key, folder: project.folder },
          outcome: "operational-failure",
          error: {
            code: operationalError.code,
            message: operationalError.message,
          },
        });
        researchSelection.unresolved.push({
          key: project.key,
          folder: project.folder,
          reason: operationalError.code,
        });
      }
    }
  }
  const outcome = aggregateOutcome(
    plan.selection.unresolved.length,
    modules.map(({ outcome: moduleOutcome }) => moduleOutcome),
    researchSelection?.unresolved.length ?? 0,
    researchProjects?.map(({ outcome: researchOutcome }) => researchOutcome) ??
      [],
  );
  return {
    schemaVersion: 1,
    mode: "cohort",
    activeSemester: config.activeSemester,
    outcome,
    selection: plan.selection,
    modules,
    ...(researchSelection === undefined || researchProjects === undefined
      ? {}
      : { researchSelection, researchProjects }),
  };
}

function asOperationalError(error: unknown, message: string): OperationalError {
  return error instanceof OperationalError
    ? error
    : new OperationalError("operational-failure", message);
}

function aggregateOutcome(
  unresolvedModules: number,
  moduleOutcomes: CohortAuditReport["modules"][number]["outcome"][],
  unresolvedResearchProjects: number,
  researchOutcomes: NonNullable<
    CohortAuditReport["researchProjects"]
  >[number]["outcome"][],
): CohortAuditReport["outcome"] {
  const outcomes = [...moduleOutcomes, ...researchOutcomes];
  if (
    unresolvedModules > 0 ||
    unresolvedResearchProjects > 0 ||
    outcomes.includes("operational-failure")
  ) {
    return "operational-failure";
  }
  if (outcomes.includes("requires-decision")) return "requires-decision";
  return outcomes.includes("deviation") ? "deviation" : "conformant";
}
