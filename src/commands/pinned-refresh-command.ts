import { loadLocalConfig } from "../config/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import { loadResearchProjectContract } from "../contract/load-research-project-contract.js";
import {
  inspectMountedResearchProject,
  OperationalError,
} from "../mounted/index.js";
import {
  executePinnedDocumentRefresh,
  executeResearchSharedControlRefresh,
  observeCohortPinnedCopies,
  planPinnedDocumentRefresh,
  planResearchSharedControlRefresh,
  type PinnedRefreshReport,
  type ResearchSharedControlRefreshReport,
} from "../pinned/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os pinned refresh --config <path> [--research-project <key>] [--apply] [--json]";

export async function runPinnedRefreshCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parsePinnedRefreshArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (parsed.researchProject !== undefined) {
    if (!("activeSemester" in config)) {
      throw new OperationalError(
        "invalid-config",
        "Research shared-control refresh requires a cohort configuration.",
      );
    }
    const inspected = await inspectMountedResearchProject(
      config,
      parsed.researchProject,
    );
    const contract = await loadResearchProjectContract();
    const report = await executeResearchSharedControlRefresh({
      plan: planResearchSharedControlRefresh({
        contract,
        projectKey: inspected.target.project.key,
        projectFolder: inspected.target.project.folder,
        controls: inspected.controls,
      }),
      target: inspected.target,
      mode: parsed.apply ? "apply" : "preview",
    });
    process.stdout.write(
      json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderHuman(report)}\n`,
    );
    process.exitCode = exitCodeForRefresh(report);
    return;
  }
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Refreshing pinned copies reads the active cohort, which this config does not declare.",
    );
  }
  const cohort = await observeCohortPinnedCopies(config);
  const contract = await loadModuleContract();
  const report = await executePinnedDocumentRefresh({
    plan: planPinnedDocumentRefresh({
      modules: cohort.modules,
      pinnedDocuments: contract.pinnedDocuments,
    }),
    cohort,
    mode: parsed.apply ? "apply" : "preview",
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  process.exitCode = exitCodeForRefresh(report);
}

function parsePinnedRefreshArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
  researchProject?: string;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "refresh",
    valueFlags: ["--config", "--research-project"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  const researchProject = values.get("--research-project");
  return {
    configPath,
    apply: flags.has("--apply"),
    ...(researchProject === undefined ? {} : { researchProject }),
  };
}

// A refusal, a half-finished run and a module that could not be read all exit 2, beside every other
// operational failure; anything merely left to rewrite exits 1, so a preview that found work is a
// failing command until somebody applies it.
function exitCodeForRefresh(
  report: PinnedRefreshReport | ResearchSharedControlRefreshReport,
): 0 | 1 | 2 {
  if (
    report.outcome === "refused" ||
    report.outcome === "partially-rewritten" ||
    report.unresolved.length > 0
  ) {
    return 2;
  }
  return report.outcome === "current" ? 0 : 1;
}

function renderHuman(
  report: PinnedRefreshReport | ResearchSharedControlRefreshReport,
): string {
  const { counts } = report;
  return [
    `Pinned document refresh: ${report.outcome} (${report.mode})`,
    `Copies: ${counts.current} current, ${counts.stale} stale, ${counts.missing} missing`,
    ...report.rewrites.map((rewrite) =>
      "module" in rewrite
        ? `Rewrite ${rewrite.module} ${rewrite.path}: ${rewrite.evidence}`
        : `Rewrite ${rewrite.project} ${rewrite.path}: ${rewrite.evidence}`,
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

function closingLine(
  report: PinnedRefreshReport | ResearchSharedControlRefreshReport,
): string {
  if (report.rewrites.length === 0) return "Every pinned copy is current.";
  return report.mode === "preview"
    ? "Preview only. Re-run with --apply."
    : `Rewrote ${report.rewritten} of ${report.rewrites.length}.`;
}
