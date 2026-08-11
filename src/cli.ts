#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { type AcademicConfig, loadLocalConfig } from "./config/index.js";
import {
  resolveConfiguredAuditTarget,
  runCohortAudit,
} from "./cohort/index.js";
import {
  auditModule,
  readDefinitionContractVersion,
} from "./conformance/index.js";
import {
  inspectMountedModule,
  type LocalConfig,
  OperationalError,
  recordMountedAuditObservation,
  seedMountedModule,
} from "./mounted/index.js";
import {
  createJsonAuditReport,
  exitCodeForOutcome,
  renderHumanAuditReport,
  renderHumanCohortReport,
} from "./report/index.js";
import { createModuleSeedPlan, type SeedReport } from "./seed/index.js";

await main(process.argv.slice(2));

async function main(arguments_: string[]): Promise<void> {
  const json = arguments_.includes("--json");
  try {
    if (arguments_[0] === "seed") {
      const seedArguments = parseSeedArguments(arguments_);
      const config = requireTargetConfig(
        await loadLocalConfig(seedArguments.configPath),
      );
      const [profile, definition] = await Promise.all([
        readApprovedControl(seedArguments.profilePath),
        readApprovedControl(seedArguments.definitionPath),
      ]);
      const plan = createModuleSeedPlan({
        module: config.module,
        semester: config.semester,
        profile,
        definition,
      });
      const report: SeedReport = await seedMountedModule(
        config,
        plan,
        seedArguments.apply ? "apply" : "preview",
      );
      writeSeedReport(report, json);
      process.exitCode = ["blocked", "staged"].includes(report.outcome) ? 1 : 0;
      return;
    }
    const auditArguments = parseAuditArguments(arguments_);
    const config = await loadLocalConfig(auditArguments.configPath);
    if (
      "activeSemester" in config &&
      auditArguments.semester === undefined &&
      auditArguments.module === undefined
    ) {
      const report = await runCohortAudit(config as AcademicConfig);
      if (json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`${renderHumanCohortReport(report)}\n`);
      }
      process.exitCode = exitCodeForOutcome(report.outcome);
      return;
    }
    const targetConfig =
      "activeSemester" in config
        ? resolveConfiguredAuditTarget(
            config,
            auditArguments.semester ?? "",
            auditArguments.module ?? "",
          )
        : config;
    if (
      auditArguments.migration &&
      (!("activeSemester" in config) ||
        config.semesters[auditArguments.semester ?? ""]?.status !== "past")
    ) {
      throw new OperationalError(
        "invalid-arguments",
        "Migration mode requires an explicitly configured past-semester target.",
      );
    }
    const { target, inventory, controls } =
      await inspectMountedModule(targetConfig);
    const result = auditModule({
      moduleCode: target.module,
      semester: target.semester,
      inventory,
      controls,
    });
    const recorded = await recordMountedAuditObservation({
      target,
      inventory,
      controls,
      result,
      observedAt: new Date().toISOString(),
      contractVersion: readDefinitionContractVersion(controls.definition),
    });
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          createJsonAuditReport(
            target,
            result,
            recorded,
            auditArguments.migration ? "migration" : "target",
          ),
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(
        `${renderHumanAuditReport(
          target,
          result,
          recorded,
          auditArguments.migration ? "migration" : "target",
        )}\n`,
      );
    }
    process.exitCode = exitCodeForOutcome(result.outcome);
  } catch (error) {
    const operationalError =
      error instanceof OperationalError
        ? error
        : new OperationalError(
            "operational-failure",
            "Command failed unexpectedly.",
          );
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            outcome: "operational-failure",
            error: {
              code: operationalError.code,
              message: operationalError.message,
            },
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stderr.write(
        `Operational failure [${operationalError.code}]: ${operationalError.message}\n`,
      );
    }
    process.exitCode = 2;
  }
}

function requireTargetConfig(
  config: LocalConfig | AcademicConfig,
): LocalConfig {
  if ("activeSemester" in config) {
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
  return config;
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

function parseAuditArguments(arguments_: string[]): {
  configPath: string;
  semester?: string;
  module?: string;
  migration: boolean;
} {
  const usage =
    "Usage: academic-os audit --config <path> [--semester <semester> --module <module> [--migration]] [--json]";
  if (arguments_[0] !== "audit") {
    throw new OperationalError("invalid-arguments", usage);
  }
  const values = new Map<string, string>();
  const valueFlags = new Set(["--config", "--semester", "--module"]);
  const supported = new Set(["audit", ...valueFlags, "--migration", "--json"]);
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !supported.has(argument)) {
      throw new OperationalError(
        "invalid-arguments",
        argument === undefined ? usage : `Unexpected argument: ${argument}.`,
      );
    }
    if (valueFlags.has(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new OperationalError("invalid-arguments", usage);
      }
      values.set(argument, value);
      index += 1;
    }
  }
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined) ||
    (arguments_.includes("--migration") && semester === undefined)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    ...(semester === undefined ? {} : { semester }),
    ...(module === undefined ? {} : { module }),
    migration: arguments_.includes("--migration"),
  };
}

function parseSeedArguments(arguments_: string[]): {
  configPath: string;
  profilePath: string;
  definitionPath: string;
  apply: boolean;
} {
  const usage =
    "Usage: academic-os seed --config <path> --profile <path> --definition <path> [--apply] [--json]";
  const values = new Map<string, string>();
  const valueFlags = new Set(["--config", "--profile", "--definition"]);
  const supported = new Set(["seed", ...valueFlags, "--apply", "--json"]);
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined || !supported.has(argument)) {
      throw new OperationalError(
        "invalid-arguments",
        argument === undefined ? usage : `Unexpected argument: ${argument}.`,
      );
    }
    if (valueFlags.has(argument)) {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new OperationalError("invalid-arguments", usage);
      }
      values.set(argument, value);
      index += 1;
    }
  }
  const configPath = values.get("--config");
  const profilePath = values.get("--profile");
  const definitionPath = values.get("--definition");
  if (
    configPath === undefined ||
    profilePath === undefined ||
    definitionPath === undefined
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    profilePath,
    definitionPath,
    apply: arguments_.includes("--apply"),
  };
}
