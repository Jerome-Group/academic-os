import { readFile } from "node:fs/promises";

import {
  type AcademicConfig,
  loadLocalConfig,
  resolveConfiguredResearchProject,
} from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import {
  type LocalConfig,
  OperationalError,
  seedMountedModule,
  seedMountedResearchProject,
} from "../mounted/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import { loadResearchProjectContract } from "../contract/load-research-project-contract.js";
import {
  createModuleSeedPlan,
  createResearchProjectSeedPlan,
  loadResearchProjectInitialFilesManifest,
  type ResearchProjectInitialFile,
  type ResearchProjectSeedReport,
  type SeedReport,
} from "../seed/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os seed --config <path> [--research-project <key> [--initial-files-manifest <path>]] --profile <path> --definition <path> [--apply [--resume]] [--json]";

export async function runSeedCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseSeedArguments(arguments_);
  const loaded = await loadLocalConfig(parsed.configPath);
  const [profile, definition] = await Promise.all([
    readApprovedControl(parsed.profilePath),
    readApprovedControl(parsed.definitionPath),
  ]);
  const initialFiles =
    parsed.initialFilesManifestPath === undefined
      ? undefined
      : await loadResearchProjectInitialFilesManifest(
          parsed.initialFilesManifestPath,
        );
  const report =
    parsed.researchProject === undefined
      ? await runModuleSeed(loaded, parsed, profile, definition)
      : await runResearchProjectSeed(
          loaded,
          { ...parsed, researchProject: parsed.researchProject },
          profile,
          definition,
          initialFiles,
        );
  writeSeedReport(report, json);
  process.exitCode = [
    "blocked",
    "safely-resumable",
    "partially-completed",
    "abandoned-staging",
  ].includes(report.outcome)
    ? 1
    : 0;
}

function parseSeedArguments(arguments_: string[]): {
  configPath: string;
  profilePath: string;
  definitionPath: string;
  researchProject?: string;
  initialFilesManifestPath?: string;
  apply: boolean;
  resume: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "seed",
    valueFlags: [
      "--config",
      "--profile",
      "--definition",
      "--research-project",
      "--initial-files-manifest",
    ],
    booleanFlags: ["--apply", "--resume", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const profilePath = values.get("--profile");
  const definitionPath = values.get("--definition");
  const researchProject = values.get("--research-project");
  const initialFilesManifestPath = values.get("--initial-files-manifest");
  if (
    configPath === undefined ||
    profilePath === undefined ||
    definitionPath === undefined ||
    (flags.has("--resume") && !flags.has("--apply")) ||
    (initialFilesManifestPath !== undefined && researchProject === undefined)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    profilePath,
    definitionPath,
    ...(researchProject === undefined ? {} : { researchProject }),
    ...(initialFilesManifestPath === undefined
      ? {}
      : { initialFilesManifestPath }),
    apply: flags.has("--apply"),
    resume: flags.has("--resume"),
  };
}

function requireTargetConfig(
  config: LocalConfig | AcademicConfig,
): LocalConfig {
  if (!("activeSemester" in config)) return config;
  if (config.seedTarget === undefined) {
    throw new OperationalError(
      "invalid-config",
      "Seed requires a configured seedTarget.",
    );
  }
  return resolveConfiguredAuditTarget(
    config,
    config.seedTarget.semester,
    config.seedTarget.module,
  );
}

async function readApprovedControl(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new OperationalError(
      "invalid-config",
      `Approved control cannot be read: ${path}.`,
    );
  }
}

async function runModuleSeed(
  config: LocalConfig | AcademicConfig,
  parsed: ReturnType<typeof parseSeedArguments>,
  profile: string,
  definition: string,
): Promise<SeedReport> {
  const target = requireTargetConfig(config);
  const plan = createModuleSeedPlan({
    module: target.module,
    semester: target.semester,
    profile,
    definition,
    contract: await loadModuleContract(),
  });
  return await seedMountedModule(
    target,
    plan,
    parsed.apply ? "apply" : "preview",
    { resume: parsed.resume },
  );
}

async function runResearchProjectSeed(
  config: LocalConfig | AcademicConfig,
  parsed: ReturnType<typeof parseSeedArguments> & {
    researchProject: string;
  },
  profile: string,
  definition: string,
  initialFiles: readonly ResearchProjectInitialFile[] | undefined,
): Promise<ResearchProjectSeedReport> {
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Research-project seed requires an academic configuration.",
    );
  }
  const target = resolveConfiguredResearchProject(
    config,
    parsed.researchProject,
  );
  const plan = createResearchProjectSeedPlan({
    target,
    profile,
    definition,
    contract: await loadResearchProjectContract(),
    ...(initialFiles === undefined ? {} : { initialFiles }),
  });
  return await seedMountedResearchProject(
    config,
    plan,
    parsed.apply ? "apply" : "preview",
    { resume: parsed.resume },
  );
}

function writeSeedReport(
  report: SeedReport | ResearchProjectSeedReport,
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const label =
    "module" in report
      ? `${report.module.code} (${report.module.semester})`
      : `${report.project.folder} (${report.project.key})`;
  process.stdout.write(
    `${[
      `Seed ${label}`,
      `Outcome: ${report.outcome}`,
      ...report.operations.map(({ kind, path }) => `Create ${kind}: ${path}`),
      ...report.evidence.map((line) => `Evidence: ${line}`),
    ].join("\n")}\n`,
  );
}
