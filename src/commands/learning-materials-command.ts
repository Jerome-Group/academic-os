import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import {
  runLearningMaterials,
  type LearningMaterialsReport,
} from "../learning-materials/index.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage = "Usage: academic-os learning materials --config <path> [--json]";

export async function runLearningMaterialsCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const configPath = parseConfigPath(arguments_);
  const loaded = await loadLocalConfig(configPath);
  if (!("activeSemester" in loaded)) {
    throw new OperationalError(
      "invalid-config",
      "Learning materials requires the active cohort configuration.",
    );
  }
  const report = await runLearningMaterials(loaded as AcademicConfig);
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode =
    report.outcome === "available" ? 0 : report.outcome === "gaps" ? 1 : 2;
}

function parseConfigPath(arguments_: string[]): string {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "materials",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return configPath;
}

function renderHuman(report: LearningMaterialsReport): string {
  const lines = [
    `Learning materials ${report.activeSemester}: ${report.outcome}`,
    `Included: ${renderModules(report.selection.included)}`,
    `Excluded: ${renderSelections(report.selection.excluded)}`,
    `Unresolved: ${renderSelections(report.selection.unresolved)}`,
  ];
  for (const module of report.modules) {
    lines.push(
      `Module ${module.module.module} (${module.module.semester}): ${module.outcome}`,
    );
    if (module.error !== undefined) {
      lines.push(`  Error [${module.error.code}]: ${module.error.message}`);
      continue;
    }
    const assessment = module.assessment;
    if (assessment === undefined) continue;
    for (const unit of assessment.units) {
      lines.push(`  Unit ${unit.unit}: ${unit.status}`);
      lines.push(`    Topics: ${unit.topics.join(", ") || "none"}`);
      for (const reference of unitReferences(unit)) {
        lines.push(
          `    ${reference.category}: ${reference.file} — ${reference.availability}${
            reference.actualKind === undefined
              ? ""
              : ` (${reference.actualKind})`
          }`,
        );
      }
    }
    lines.push(
      `  Missing files: ${assessment.missingFiles.join(", ") || "none"}`,
      `  Non-files: ${assessment.nonFiles.join(", ") || "none"}`,
      `  Unavailable: ${assessment.unavailableFiles.join(", ") || "none"}`,
      `  Empty units: ${assessment.emptyUnits.join(", ") || "none"}`,
    );
    for (const gap of assessment.declaredTutorialGaps) {
      lines.push(
        `  Declared tutorial gap: ${gap.unit}/${gap.block}/${gap.file} (${gap.role}) — ${gap.missing.join(", ")}`,
      );
    }
    for (const problem of assessment.problems)
      lines.push(`  Invalid: ${problem}`);
  }
  return lines.join("\n");
}

function unitReferences(
  unit: NonNullable<
    LearningMaterialsReport["modules"][number]["assessment"]
  >["units"][number],
) {
  return [
    ...unit.lectures,
    ...unit.textbook,
    ...unit.tutorials.flatMap((tutorial) =>
      tutorial.kind === "file" ? [tutorial.source] : tutorial.sources,
    ),
    ...unit.supplementaryMaterials,
    ...unit.pastPapers,
    ...unit.practiceTests,
    ...unit.historicalReference,
  ];
}

function renderModules(
  modules: Array<{ semester: string; module: string }>,
): string {
  return modules.length === 0
    ? "none"
    : modules.map(({ semester, module }) => `${semester}/${module}`).join(", ");
}

function renderSelections(
  modules: Array<{ semester: string; module: string; reason: string }>,
): string {
  return modules.length === 0
    ? "none"
    : modules
        .map(
          ({ semester, module, reason }) => `${semester}/${module} (${reason})`,
        )
        .join(", ");
}
