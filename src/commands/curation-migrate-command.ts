import { loadLocalConfig } from "../config/index.js";
import {
  type CurationIdentityReport,
  executeCurationIdentityMigration,
  observeCohortCurationRegisters,
  planCurationIdentityMigration,
} from "../curation/index.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { quantity } from "./quantity.js";

const usage =
  "Usage: academic-os curation migrate --config <path> [--apply] [--json]";

export async function runCurationMigrateCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseMigrateArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Migrating register identity reads the active cohort, which this config does not declare.",
    );
  }
  const cohort = await observeCohortCurationRegisters(config);
  const report = await executeCurationIdentityMigration({
    plan: planCurationIdentityMigration({
      modules: cohort.modules,
      now: new Date().toISOString(),
    }),
    cohort,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode = exitCodeForMigration(report);
}

function parseMigrateArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "migrate",
    valueFlags: ["--config"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, apply: flags.has("--apply") };
}

// A refusal, a half-finished run, an unreadable module and a register too malformed to append to
// all exit 2. Lines still to migrate exit 1, so a preview that found work is a failing command
// until somebody applies it. Items only the Owner or a curation walk can settle exit 3.
function exitCodeForMigration(report: CurationIdentityReport): 0 | 1 | 2 | 3 {
  if (
    report.outcome === "refused" ||
    report.outcome === "partially-migrated" ||
    report.unresolved.length > 0 ||
    report.modules.some(({ blockers }) => blockers.length > 0)
  ) {
    return 2;
  }
  if (report.counts.migrating > 0) return 1;
  return report.modules.some(({ discrepancies }) => discrepancies.length > 0)
    ? 3
    : 0;
}

function renderHuman(report: CurationIdentityReport): string {
  const { counts } = report;
  return [
    `Curation register identity: ${report.outcome} (${report.mode})`,
    `Items: ${counts["contract-v4"]} on contract v4, ${counts.migrating} to migrate, ${counts.changed} changed, ${counts["missing-source"]} missing at source, ${counts.unprovable} unprovable`,
    ...report.modules.flatMap(renderModule),
    ...report.unresolved.map(
      ({ module, semester, reason }) =>
        `Unresolved ${semester}/${module}: ${reason}`,
    ),
    ...report.refusals.map((refusal) => `Refused ${refusal}`),
    ...(report.journal === undefined ? [] : [`Journal: ${report.journal}`]),
    closingLine(report),
  ].join("\n");
}

function renderModule(module: CurationIdentityReport["modules"][number]) {
  return [
    `${module.module}: ${quantity(module.counts.migrating, "legacy line")} to migrate of ${module.counts["contract-v4"] + module.counts.migrating + module.counts.changed + module.counts.unprovable + module.counts["missing-source"]}`,
    ...module.migrations.map(
      ({ key, supersedes, to }) =>
        `  Migrate ${module.module} ${key}: supersedes ${supersedes}, becomes ${key} + ${to}`,
    ),
    ...module.discrepancies.map(
      ({ key, state, evidence }) => `  ${state} ${key}: ${evidence}`,
    ),
    ...module.blockers.map((blocker) => `  Blocked: ${blocker}`),
  ];
}

function closingLine(report: CurationIdentityReport): string {
  if (report.counts.migrating === 0 && report.appended === 0) {
    return "Every register line an arrival walk can meet already carries contract-v4 identity.";
  }
  return report.mode === "preview"
    ? "Preview only. Re-run with --apply."
    : `Appended ${quantity(report.appended, "superseding line")}.`;
}
