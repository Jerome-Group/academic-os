import { loadLocalConfig } from "../config/index.js";
import {
  type CurationRederivationReport,
  executeCurationRederivation,
  observeCohortCurationRederivations,
  planCurationRederivation,
} from "../curation/index.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";
import { quantity } from "./quantity.js";

const usage =
  "Usage: academic-os curation rederive --config <path> [--apply] [--json]";

export async function runCurationRederiveCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseRederiveArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Correcting a split source reads the active cohort, which this config does not declare.",
    );
  }
  const cohort = await observeCohortCurationRederivations(config);
  const report = await executeCurationRederivation({
    plan: planCurationRederivation({
      modules: cohort.modules,
      now: new Date().toISOString(),
    }),
    cohort,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode = exitCodeForRederivation(report);
}

function parseRederiveArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "rederive",
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

// The same ladder `curation migrate` uses, for the same reasons: a refusal, a half-finished run, an
// unreadable module and a malformed register all exit 2; splits still to correct exit 1, so a
// preview that found work is a failing command until somebody applies it; items only the Owner or a
// curation walk can settle exit 3.
function exitCodeForRederivation(
  report: CurationRederivationReport,
): 0 | 1 | 2 | 3 {
  if (
    report.outcome === "refused" ||
    report.outcome === "partially-corrected" ||
    report.unresolved.length > 0 ||
    report.modules.some(({ blockers }) => blockers.length > 0)
  ) {
    return 2;
  }
  if (report.counts.rederiving > 0) return 1;
  return report.modules.some(({ discrepancies }) => discrepancies.length > 0)
    ? 3
    : 0;
}

function renderHuman(report: CurationRederivationReport): string {
  const { counts } = report;
  return [
    `Curation register split sources: ${report.outcome} (${report.mode})`,
    `Sources: ${counts.settled} settled, ${counts.rederiving} to rederive, ${counts.changed} changed, ${counts["legacy-identity"]} on legacy identity, ${counts["missing-source"]} missing at source, ${counts.unprovable} unprovable`,
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

function renderModule(module: CurationRederivationReport["modules"][number]) {
  return [
    `${module.module}: ${quantity(module.counts.rederiving, "split source")} to correct of ${sourcesSeen(module.counts)}`,
    ...module.rederivations.flatMap(renderRederivation),
    ...module.discrepancies.map(
      ({ key, state, evidence }) => `  ${state} ${key}: ${evidence}`,
    ),
    ...module.blockers.map((blocker) => `  Blocked: ${blocker}`),
  ];
}

// What the correction retires, what it leaves standing, and what it could not read — all three,
// because a `derived` list shorter than the batch it supersedes is the one thing a reader of the
// preview would otherwise have to count for themselves.
function renderRederivation(
  correction: CurationRederivationReport["modules"][number]["rederivations"][number],
) {
  return [
    `  Rederive ${correction.sourceLocation}: supersedes ${correction.supersedes}, ${quantity(correction.derived.length, "artifact")} derived`,
    ...correction.derived.map((path) => `    derived  ${path}`),
    ...correction.copies.map((path) => `    stays curated  ${path}`),
    ...correction.unreadable.map((path) => `    digest unreadable  ${path}`),
    ...correction.missing.map((path) => `    not on the mount  ${path}`),
  ];
}

function sourcesSeen(counts: CurationRederivationReport["counts"]): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function closingLine(report: CurationRederivationReport): string {
  if (report.counts.rederiving === 0 && report.appended === 0) {
    return "No standing batch records one source as a curated line per artifact.";
  }
  return report.mode === "preview"
    ? "Preview only. Re-run with --apply."
    : `Appended ${quantity(report.appended, "rederived line")}.`;
}
