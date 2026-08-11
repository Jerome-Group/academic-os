#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { loadLocalConfig } from "./config/index.js";
import { auditModule } from "./conformance/index.js";
import {
  inspectMountedModule,
  OperationalError,
  seedMountedModule,
} from "./mounted/index.js";
import {
  createJsonAuditReport,
  exitCodeFor,
  renderHumanAuditReport,
} from "./report/index.js";
import { createModuleSeedPlan, type SeedReport } from "./seed/index.js";

await main(process.argv.slice(2));

async function main(arguments_: string[]): Promise<void> {
  const json = arguments_.includes("--json");
  try {
    if (arguments_[0] === "seed") {
      const seedArguments = parseSeedArguments(arguments_);
      const config = await loadLocalConfig(seedArguments.configPath);
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
    const configPath = parseAuditArguments(arguments_);
    const config = await loadLocalConfig(configPath);
    const { target, inventory, controls } = await inspectMountedModule(config);
    const result = auditModule({
      moduleCode: target.module,
      semester: target.semester,
      inventory,
      controls,
    });
    if (json) {
      process.stdout.write(
        `${JSON.stringify(createJsonAuditReport(target, result), null, 2)}\n`,
      );
    } else {
      process.stdout.write(`${renderHumanAuditReport(target, result)}\n`);
    }
    process.exitCode = exitCodeFor(result);
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

function parseAuditArguments(arguments_: string[]): string {
  if (arguments_[0] !== "audit") {
    throw new OperationalError(
      "invalid-arguments",
      "Usage: academic-os audit --config <path> [--json]",
    );
  }
  const supportedArguments = new Set(["audit", "--config", "--json"]);
  const configFlag = arguments_.indexOf("--config");
  const configPath = arguments_[configFlag + 1];
  if (
    configFlag === -1 ||
    configPath === undefined ||
    configPath.startsWith("--")
  ) {
    throw new OperationalError(
      "invalid-arguments",
      "Usage: academic-os audit --config <path> [--json]",
    );
  }
  const unexpected = arguments_.filter(
    (argument, index) =>
      index !== configFlag + 1 && !supportedArguments.has(argument),
  );
  if (unexpected.length > 0) {
    throw new OperationalError(
      "invalid-arguments",
      `Unexpected argument: ${unexpected[0]}.`,
    );
  }
  return configPath;
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
