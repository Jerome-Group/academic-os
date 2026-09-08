import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import { runImportStatus, type ImportStatusReport } from "../imports/index.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const defaultMaxAgeHours = 36;
const usage =
  "Usage: academic-os imports status --config <path> [--max-age-hours <number>] [--json]";

export async function runImportsStatusCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseArguments(arguments_);
  const loaded = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in loaded)) {
    throw new OperationalError(
      "invalid-config",
      "Import status requires the active cohort configuration.",
    );
  }
  const report = await runImportStatus({
    config: loaded as AcademicConfig,
    observedAt: new Date().toISOString(),
    maxAgeHours: parsed.maxAgeHours,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode =
    report.outcome === "current" ? 0 : report.outcome === "attention" ? 1 : 2;
}

function parseArguments(arguments_: string[]): {
  configPath: string;
  maxAgeHours: number;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "status",
    valueFlags: ["--config", "--max-age-hours"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const maxAgeSource = values.get("--max-age-hours");
  const maxAgeHours =
    maxAgeSource === undefined ? defaultMaxAgeHours : Number(maxAgeSource);
  if (
    configPath === undefined ||
    !Number.isFinite(maxAgeHours) ||
    maxAgeHours <= 0
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, maxAgeHours };
}

function renderHuman(report: ImportStatusReport): string {
  const lines = [
    `Import status ${report.activeSemester}: ${report.outcome}`,
    `Observed: ${report.observedAt}`,
    `Maximum age: ${report.maxAgeHours} hours`,
    `Included: ${renderModules(report.selection.included)}`,
    `Excluded: ${renderSelections(report.selection.excluded)}`,
    `Unresolved: ${renderSelections(report.selection.unresolved)}`,
  ];
  for (const module of report.modules) {
    lines.push(
      `Module ${module.module.module} (${module.module.semester}): ${module.status}`,
    );
    if (module.error !== undefined) {
      lines.push(`  Error [${module.error.code}]: ${module.error.message}`);
    }
    for (const root of module.roots) {
      lines.push(
        `  ${root.destination}: ${root.status}; action=${root.action}; counts=${renderCounts(root.counts)}; started=${root.startedAt ?? "none"}; finished=${root.finishedAt ?? "none"}; lastSuccess=${root.lastSuccessfulAt ?? "none"}; unread=${root.unread?.join(",") || "none"}`,
      );
      if (root.error !== undefined) lines.push(`    Error: ${root.error}`);
    }
  }
  lines.push(
    `Root statuses: ${Object.entries(report.summary.roots)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`,
    `Invalid modules: ${report.summary.invalidModules}`,
  );
  return lines.join("\n");
}

function renderCounts(
  counts: ImportStatusReport["modules"][number]["roots"][number]["counts"],
): string {
  return counts === null
    ? "unavailable"
    : Object.entries(counts)
        .map(([name, count]) => `${name}:${count}`)
        .join(",");
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
