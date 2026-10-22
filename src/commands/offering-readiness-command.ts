import { loadLocalConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import {
  runOfferingReadiness,
  type OfferingReadinessReport,
} from "../offering/readiness.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os offering readiness --config <path> [--max-age-hours <number>] [--json]";

export async function runOfferingReadinessCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "readiness",
    valueFlags: ["--config", "--max-age-hours"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const maxAgeHours = Number(values.get("--max-age-hours") ?? 36);
  if (
    configPath === undefined ||
    !Number.isFinite(maxAgeHours) ||
    maxAgeHours <= 0
  )
    throw new OperationalError("invalid-arguments", usage);
  const config = await loadLocalConfig(configPath);
  if (!("activeSemester" in config))
    throw new OperationalError(
      "invalid-config",
      "Offering readiness requires the active cohort configuration.",
    );
  const report = await runOfferingReadiness({
    config,
    observedAt: new Date().toISOString(),
    maxAgeHours,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode =
    report.outcome === "ready" ? 0 : report.outcome === "attention" ? 1 : 2;
}

function renderHuman(report: OfferingReadinessReport): string {
  const lines = [
    `Offering readiness ${report.activeSemester}: ${report.outcome}`,
    `Observed: ${report.observedAt}; import maximum age: ${report.maxAgeHours} hours`,
    `Evidence: ${report.evidence}; unverified: ${report.unverified.join(", ")}`,
    `Included: ${renderSelections(report.selection.included)}`,
    `Excluded: ${renderSelections(report.selection.excluded)}`,
    `Unresolved: ${renderSelections(report.selection.unresolved)}`,
  ];
  for (const outcome of ["ready", "attention", "unobserved"] as const) {
    lines.push(`${outcome}: ${renderSelections(report.groups[outcome])}`);
    for (const module of report.modules.filter(
      (module) => module.outcome === outcome,
    )) {
      lines.push(
        `Module ${module.module.module} (${module.module.semester}): ${outcome}`,
      );
      for (const [name, check] of Object.entries(module.checks)) {
        lines.push(`  ${name}: ${check.status}`);
        if (check.kind === "unavailable")
          lines.push(`    Error [${check.error.code}]: ${check.error.message}`);
      }
      const { controls, imports, learningMaterials, tasks } = module.checks;
      if (controls.kind === "observed")
        for (const finding of controls.evidence.findings.filter(
          ({ status }) => status !== "pass" && status !== "not-applicable",
        ))
          lines.push(
            `    ${finding.ruleId} ${finding.path}: ${finding.status}; ${finding.evidence}`,
          );
      if (imports.kind === "observed")
        for (const root of imports.evidence)
          lines.push(
            `    ${root.destination}: ${root.status}; finished=${root.finishedAt ?? "none"}${root.error === undefined ? "" : `; ${root.error}`}`,
          );
      if (learningMaterials.kind === "observed") {
        const assessment = learningMaterials.evidence;
        for (const unit of assessment.units)
          lines.push(
            `    Unit ${unit.unit}: ${unit.status}; topics=${unit.topics.join(", ")}`,
          );
        lines.push(
          `    Missing: ${assessment.missingFiles.join(", ") || "none"}; non-files: ${assessment.nonFiles.join(", ") || "none"}; unavailable: ${assessment.unavailableFiles.join(", ") || "none"}`,
        );
        for (const gap of assessment.declaredTutorialGaps)
          lines.push(
            `    Tutorial gap ${gap.unit}/${gap.block}/${gap.file}: ${gap.missing.join(", ")}`,
          );
        for (const problem of assessment.problems)
          lines.push(`    Source Map: ${problem}`);
      }
      if (tasks.kind === "observed")
        lines.push(
          `    Tasks ${tasks.evidence.binding}${tasks.evidence.binding === "bound" ? ` (${tasks.evidence.listId})` : ""}; local-register; freshness unverified; ${tasks.evidence.validation.evidence}`,
        );
      for (const action of module.nextActions)
        lines.push(`  Suggested ${action.command}: ${action.reason}`);
    }
  }
  return lines.join("\n");
}

function renderSelections(
  modules: Array<{ semester: string; module: string; reason?: string }>,
): string {
  return (
    modules
      .map(
        ({ semester, module, reason }) =>
          `${semester}/${module}${reason === undefined ? "" : ` (${reason})`}`,
      )
      .join(", ") || "none"
  );
}
