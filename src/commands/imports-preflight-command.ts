import { isAbsolute } from "node:path";

import { loadLocalConfig } from "../config/index.js";
import {
  type ImportPreflightReport,
  runImportPreflight,
} from "../imports/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os imports preflight --config <path> --ntulearn-config <filename> --ntulearn-root <absolute-checkout> [--json]";

export async function runImportsPreflightCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "preflight",
    valueFlags: ["--config", "--ntulearn-config", "--ntulearn-root"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const ntulearnConfigPath = values.get("--ntulearn-config");
  const ntulearnRoot = values.get("--ntulearn-root");
  if (
    !configPath ||
    !ntulearnConfigPath ||
    !ntulearnRoot ||
    !isAbsolute(ntulearnRoot)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  const config = await loadLocalConfig(configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Import preflight requires the active cohort configuration.",
    );
  }
  const report = await runImportPreflight({
    config,
    ntulearnConfigPath,
    ntulearnRoot,
    observedAt: new Date().toISOString(),
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode =
    report.outcome === "ready" ? 0 : report.outcome === "attention" ? 1 : 2;
}

function renderHuman(report: ImportPreflightReport): string {
  const lines = [
    `Import preflight ${report.activeSemester}: ${report.outcome}`,
    `Observed: ${report.observedAt}`,
    `Included: ${renderModules(report.selection.included)}`,
    `Excluded: ${report.selection.excluded.map((module) => `${module.semester}/${module.module} (${module.reason})`).join(", ") || "none"}`,
    `Unresolved: ${report.selection.unresolved.map((module) => `${module.semester}/${module.module} (${module.reason})`).join(", ") || "none"}`,
  ];
  for (const module of report.modules) {
    lines.push(
      `Module ${module.module.module} (${module.module.semester}): ${module.kind}`,
    );
    for (const root of module.roots) {
      const matches =
        root.coverage.kind === "matched"
          ? root.coverage.courses
          : root.coverage.kind === "unobserved"
            ? root.coverage.knownMatches
            : [];
      lines.push(
        `  ${root.destination}: ${root.coverage.kind}; course rows=${matches.join(",") || "none"}`,
      );
    }
  }
  for (const course of report.courses) {
    lines.push(
      `Course row ${course.index} (${course.key.kind === "observed" ? course.key.value : "invalid key"}): ${course.scope.kind}; destination=${course.destination.kind === "observed" ? course.destination.value.lexical : "unobserved"}`,
    );
  }
  for (const finding of report.findings) {
    const subject =
      finding.kind === "missing"
        ? `${finding.module.semester}/${finding.module.module}/${finding.destination}`
        : finding.kind === "conflict"
          ? `course rows ${finding.courses.join(", ")} (${finding.reasons.join(", ")})`
          : `course row ${finding.course}`;
    lines.push(`${finding.kind}: ${subject}. ${finding.action}`);
  }
  for (const problem of report.problems)
    lines.push(
      `Unobserved [${problem.code}]: ${problem.message} ${problem.action}`,
    );
  lines.push(`Unverified: ${report.unverified.join(", ")}`);
  return lines.join("\n");
}

function renderModules(
  modules: Array<{ semester: string; module: string }>,
): string {
  return (
    modules.map(({ semester, module }) => `${semester}/${module}`).join(", ") ||
    "none"
  );
}
