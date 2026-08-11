import type { CohortAuditReport } from "../cohort/types.js";
import { renderHumanJsonAuditReport } from "./audit-report.js";

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
  ].join("\n");
}
