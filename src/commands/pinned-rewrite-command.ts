import { loadLocalConfig } from "../config/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import { OperationalError } from "../mounted/index.js";
import {
  executePinnedDocumentRewrite,
  observeCohortPinnedCopies,
  planPinnedDocumentRewrite,
  type PinnedRewriteReport,
} from "../pinned/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os pinned rewrite --config <path> [--apply] [--json]";

export async function runPinnedRewriteCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parsePinnedRewriteArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Rewriting pinned copies reads the active cohort, which this config does not declare.",
    );
  }
  const cohort = await observeCohortPinnedCopies(config);
  const contract = await loadModuleContract();
  const report = await executePinnedDocumentRewrite({
    plan: planPinnedDocumentRewrite({
      modules: cohort.modules,
      pinnedDocuments: contract.pinnedDocuments,
    }),
    cohort,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode = exitCodeForRewrite(report);
}

function parsePinnedRewriteArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "rewrite",
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

// A refusal, a half-finished run and a module that could not be read all exit 2, beside every other
// operational failure; anything merely left to rewrite exits 1, so a preview that found work is a
// failing command until somebody applies it.
function exitCodeForRewrite(report: PinnedRewriteReport): 0 | 1 | 2 {
  if (
    report.outcome === "refused" ||
    report.outcome === "partially-rewritten" ||
    report.unresolved.length > 0
  ) {
    return 2;
  }
  return report.outcome === "current" ? 0 : 1;
}

function renderHuman(report: PinnedRewriteReport): string {
  const { counts } = report;
  return [
    `Pinned document rewrite: ${report.outcome} (${report.mode})`,
    `Copies: ${counts.current} current, ${counts.stale} stale, ${counts.missing} missing`,
    ...report.rewrites.map(
      ({ module, path, evidence }) => `Rewrite ${module} ${path}: ${evidence}`,
    ),
    ...report.unresolved.map(
      ({ module, semester, reason }) =>
        `Unresolved ${semester}/${module}: ${reason}`,
    ),
    ...report.refusals.map((refusal) => `Refused ${refusal}`),
    ...(report.journal === undefined ? [] : [`Journal: ${report.journal}`]),
    closingLine(report),
  ].join("\n");
}

function closingLine(report: PinnedRewriteReport): string {
  if (report.rewrites.length === 0) return "Every pinned copy is current.";
  return report.mode === "preview"
    ? "Preview only. Re-run with --apply."
    : `Rewrote ${report.rewritten} of ${report.rewrites.length}.`;
}
