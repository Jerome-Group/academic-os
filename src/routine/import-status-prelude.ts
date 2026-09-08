import type { ImportStatusReport } from "../imports/index.js";
import type { PreludeStepReport } from "./types.js";

export function importStatusPrelude(
  report: ImportStatusReport,
): PreludeStepReport {
  const unresolved = report.selection.unresolved;
  const unhealthy = report.modules.flatMap(({ roots }) =>
    roots.filter(({ status }) => status !== "current"),
  );
  return {
    step: "import-status",
    outcome: report.outcome,
    parked: unhealthy.length + unresolved.length,
    detail: [
      `Observed ${report.observedAt}; maximum age ${report.maxAgeHours} hours`,
      ...report.modules.flatMap(({ module, roots, error }) => [
        ...(error === undefined
          ? []
          : [`${module.module}: ${error.code}; ${error.message}`]),
        ...roots.map(
          (root) =>
            `${module.module}/${root.destination}: ${root.status}; started ${root.startedAt ?? "unknown"}; finished ${root.finishedAt ?? "unknown"}; retained success ${root.lastSuccessfulAt ?? "unknown"}; unread ${root.unread?.join(", ") || "none"}; failed transfers ${root.counts?.failures ?? "unknown"}; ${root.error ?? root.action}`,
        ),
      ]),
      ...unresolved.map(
        ({ semester, module, reason }) =>
          `Unresolved ${semester}/${module}: ${reason}`,
      ),
      ...(report.outcome === "current"
        ? []
        : [
            "Inspect the named roots and the NTULearn run report; continue other module maintenance and defer source-withdrawal decisions.",
          ]),
    ],
    ...(report.outcome !== "invalid"
      ? {}
      : {
          failure: {
            code: "import-status-invalid",
            message:
              "Importer evidence is invalid or unreadable; the named roots and unresolved modules need inspection.",
          },
        }),
  };
}
