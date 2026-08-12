import { readFile } from "node:fs/promises";

import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import {
  type LocalConfig,
  OperationalError,
  seedMountedModule,
} from "../mounted/index.js";
import { createModuleSeedPlan, type SeedReport } from "../seed/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os seed --config <path> --profile <path> --definition <path> [--apply [--resume]] [--json]";

export async function runSeedCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseSeedArguments(arguments_);
  const config = requireTargetConfig(await loadLocalConfig(parsed.configPath));
  const [profile, definition] = await Promise.all([
    readApprovedControl(parsed.profilePath),
    readApprovedControl(parsed.definitionPath),
  ]);
  const plan = createModuleSeedPlan({
    module: config.module,
    semester: config.semester,
    profile,
    definition,
  });
  const report = await seedMountedModule(
    config,
    plan,
    parsed.apply ? "apply" : "preview",
    { resume: parsed.resume },
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
  apply: boolean;
  resume: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "seed",
    valueFlags: ["--config", "--profile", "--definition"],
    booleanFlags: ["--apply", "--resume", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const profilePath = values.get("--profile");
  const definitionPath = values.get("--definition");
  if (
    configPath === undefined ||
    profilePath === undefined ||
    definitionPath === undefined ||
    (flags.has("--resume") && !flags.has("--apply"))
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    profilePath,
    definitionPath,
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

function writeSeedReport(report: SeedReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${[
      `Seed ${report.module.code} (${report.module.semester})`,
      `Outcome: ${report.outcome}`,
      ...report.operations.map(({ kind, path }) => `Create ${kind}: ${path}`),
      ...report.evidence.map((line) => `Evidence: ${line}`),
    ].join("\n")}\n`,
  );
}
