#!/usr/bin/env node

import { loadLocalConfig } from "./config/index.js";
import { auditModule } from "./conformance/index.js";
import { inspectMountedModule, OperationalError } from "./mounted/index.js";
import {
  createJsonAuditReport,
  exitCodeFor,
  renderHumanAuditReport,
} from "./report/index.js";

await main(process.argv.slice(2));

async function main(arguments_: string[]): Promise<void> {
  const json = arguments_.includes("--json");
  try {
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
            "Audit failed unexpectedly.",
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
