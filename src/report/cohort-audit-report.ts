import type { CohortAuditReport } from "../cohort/types.js";
import { renderHumanJsonAuditReport } from "./audit-report.js";
import { renderHumanResearchProjectAuditReport } from "./research-project-audit-report.js";

export function renderHumanCohortReport(report: CohortAuditReport): string {
  return [
    `Cohort audit (${report.activeSemester})`,
    `Outcome: ${report.outcome}`,
    `Modules audited: ${report.modules.length}`,
    ...(report.selection.included.length === 0 ? ["Included: none"] : []),
    ...report.selection.included.map(
      ({ semester, module }) => `Included: ${semester}/${module}`,
    ),
    ...report.selection.excluded.map(
      ({ semester, module, reason }) =>
        `Excluded [${reason}]: ${semester}/${module}`,
    ),
    ...report.selection.unresolved.map(
      ({ semester, module, reason }) =>
        `Unresolved [${reason}]: ${semester}/${module}`,
    ),
    ...(report.researchSelection === undefined ||
    report.researchProjects === undefined
      ? []
      : [
          `Research projects audited: ${report.researchProjects.length}`,
          ...report.researchSelection.included.map(
            ({ key, folder }) => `Research included: ${key} (${folder})`,
          ),
          ...report.researchSelection.excluded.map(
            ({ key, folder, reason }) =>
              `Research excluded [${reason}]: ${key} (${folder})`,
          ),
          ...report.researchSelection.unresolved.map(
            ({ key, folder, reason }) =>
              `Research unresolved [${reason}]: ${key} (${folder})`,
          ),
        ]),
    ...report.modules.flatMap((module) => [
      "",
      module.outcome === "operational-failure"
        ? [
            `Audit ${module.module.code} (${module.module.semester})`,
            "Outcome: operational-failure",
            `Operational failure [${module.error.code}]: ${module.error.message}`,
          ].join("\n")
        : renderHumanJsonAuditReport(module),
    ]),
    ...(report.researchProjects ?? []).flatMap((project) => [
      "",
      project.outcome === "operational-failure"
        ? [
            `Audit ${project.project.folder} (${project.project.key})`,
            "Outcome: operational-failure",
            `Operational failure [${project.error.code}]: ${project.error.message}`,
          ].join("\n")
        : renderHumanResearchProjectAuditReport(project),
    ]),
  ].join("\n");
}
