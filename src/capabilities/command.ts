import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgumentTokens } from "../commands/argument-tokens.js";
import { loadLocalConfig, resolveRoutineConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import { inspectRoutineExecutables } from "../routine/index.js";
import { capabilityIndex } from "./catalog.js";
import {
  type CheckProfile,
  checkProfiles,
  observeProcess,
  privateProcessDiagnostics,
  runChecks,
  runWorkflowChecks,
  verificationWorkflows,
} from "./checks.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const usage =
  "Usage: academic-os capabilities index|health|check|verify [health: --config <private-config>] [--profile fast|tests|privacy|templates|coverage|full] [--workflow discovery|imports|recovery|services|teaching|maintenance] [--log <private-new-file>] [--json]";

export async function runCapabilitiesCommand(
  arguments_: string[],
): Promise<void> {
  const operation = arguments_[1];
  if (!["index", "health", "check", "verify"].includes(operation ?? ""))
    throw new OperationalError("invalid-arguments", usage);
  const { values } = parseArgumentTokens({
    arguments: [operation ?? "", ...arguments_.slice(2)],
    command: operation ?? "",
    valueFlags: ["--profile", "--workflow", "--log", "--config"],
    booleanFlags: ["--json"],
    usage,
  });
  if (
    (operation !== "check" && values.has("--profile")) ||
    (operation !== "verify" && values.has("--workflow")) ||
    (operation !== "health" && values.has("--config"))
  )
    throw new OperationalError("invalid-arguments", usage);
  const log = values.get("--log");
  const excludedLogRoots: string[] = [];
  if (log !== undefined) await validateLogDestination(log);
  let result: object;
  if (operation === "index") {
    const index = capabilityIndex() as {
      actions: {
        implementation: string;
        id: string;
        tests: string[];
        usage?: string[];
        verification?: object;
      }[];
    };
    for (const action of index.actions) {
      action.verification = {
        status: action.tests.length > 0 ? "mapped" : "untested",
        evidence: action.tests,
        scope: "mapping only; run checks for current evidence",
      };
      const source = await readFile(
        resolve(root, action.implementation),
        "utf8",
      );
      action.usage = [
        ...source.matchAll(/Usage:[^"`\n]+| {2}cheatsheet-tool [^`\n]+/g),
      ]
        .map((match) => match[0])
        .filter(
          (line) =>
            (!action.id.startsWith("tasks ") ||
              line.includes(`academic-os ${action.id} `)) &&
            (!action.id.startsWith("cheatsheet ") ||
              line.includes(
                `cheatsheet-tool ${action.id.slice("cheatsheet ".length)}`,
              )),
        );
    }
    result = {
      ...index,
      profiles: checkProfiles,
      workflows: verificationWorkflows,
      exitCodes: {
        capabilities: {
          0: "success",
          1: "observed check failure",
          2: "invalid invocation or unavailable operation",
        },
      },
    };
  } else if (operation === "health") {
    let configuredExecutables: object | undefined;
    const configPath = values.get("--config");
    if (configPath !== undefined) {
      const config = await loadLocalConfig(configPath);
      if (!("activeSemester" in config))
        throw new OperationalError(
          "invalid-config",
          "Configured health requires an academic configuration.",
        );
      configuredExecutables = {
        tools: await inspectRoutineExecutables(resolveRoutineConfig(config)),
        scope:
          "configured executable filesystem access only; scheduler recovery unverified",
      };
      if (typeof config.driveMount === "string") {
        excludedLogRoots.push(config.driveMount);
        if (log !== undefined)
          await validateLogDestination(log, excludedLogRoots);
      }
    }
    const tools = await Promise.all(
      [
        "node",
        "npm",
        "codex",
        "gh",
        "latexmk",
        "pdfinfo",
        "pdffonts",
        "pdftotext",
        "pdftoppm",
        "pdftohtml",
      ].map((executable) =>
        observeProcess({
          action: executable,
          executable,
          arguments: [executable.startsWith("pdf") ? "-v" : "--version"],
          timeoutMs: 3000,
        }),
      ),
    );
    result = {
      schemaVersion: 1,
      outcome: "observed",
      tools,
      ...(configuredExecutables === undefined ? {} : { configuredExecutables }),
      unverified: [
        "credentials and authorization",
        "live Drive/Tasks/Calendar/MCP status",
        "scheduled host PATH and launchd state",
        "maintenance recovery",
        "source freshness",
        "mathematical and visual artifact quality",
      ],
      evidenceScope:
        configPath === undefined
          ? "local executable invocation only; no config, credentials or live services read"
          : "private configuration and configured executable filesystem access; local version invocation; no credentials or live services read",
    };
  } else {
    const profile = values.get("--profile") ?? "fast";
    const workflow = values.get("--workflow") ?? "discovery";
    if (
      !(profile in checkProfiles) ||
      !verificationWorkflows.includes(
        workflow as (typeof verificationWorkflows)[number],
      )
    )
      throw new OperationalError("invalid-arguments", usage);
    const checks =
      operation === "check"
        ? await runChecks(profile as CheckProfile, root)
        : await runWorkflowChecks(root, workflow);
    const passed = checks.every((check) => check.outcome === "passed");
    result = {
      schemaVersion: 1,
      outcome: passed ? "passed" : "failed",
      ...(operation === "check" ? { profile } : { workflow }),
      checks,
      coveredChecks:
        profile === "full" || profile === "coverage"
          ? {
              tests: "rule-coverage:check runs every compiled test",
              privacy: "privacy tests are part of that same test run",
              contract:
                "coverage asserts behavioral rule evidence from that run",
            }
          : {},
      evidenceScope:
        "repository-owned checks and synthetic fixtures; no live recovery or semantic correctness claim",
    };
    if (!passed) process.exitCode = 1;
  }
  if (log !== undefined) {
    const destination = resolve(log);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await validateLogDestination(log, excludedLogRoots);
    await writeFile(
      destination,
      `${JSON.stringify(
        result,
        (_key, value: unknown) => {
          const diagnostic = privateProcessDiagnostics(value);
          return diagnostic === undefined
            ? value
            : { ...(value as object), privateDiagnostics: diagnostic };
        },
        2,
      )}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function validateLogDestination(
  log: string,
  excludedRoots: string[] = [],
): Promise<void> {
  const destination = resolve(log);
  const protectedRoots = [
    await realpath(root),
    ...(await Promise.all(
      excludedRoots.map(async (path) => {
        try {
          return await realpath(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return resolve(path);
          throw error;
        }
      }),
    )),
  ];
  const within = relative(root, destination);
  if (
    !isAbsolute(log) ||
    (!within.startsWith("../") && within !== ".." && !isAbsolute(within))
  )
    throw new OperationalError(
      "invalid-arguments",
      "Logs require an absolute private destination outside the repository.",
    );
  for (const excludedRoot of excludedRoots) {
    const excludedWithin = relative(resolve(excludedRoot), destination);
    if (
      !excludedWithin.startsWith("../") &&
      excludedWithin !== ".." &&
      !isAbsolute(excludedWithin)
    )
      throw new OperationalError(
        "invalid-arguments",
        "Logs must remain outside configured academic mounts.",
      );
  }
  for (let path = destination; ; path = dirname(path)) {
    try {
      const entry = await lstat(path);
      const canonical = await realpath(path);
      const canonicalDestination = resolve(
        canonical,
        relative(path, destination),
      );
      const protectedDestination = protectedRoots.some((protectedRoot) => {
        const within = relative(protectedRoot, canonicalDestination);
        return (
          !within.startsWith("../") && within !== ".." && !isAbsolute(within)
        );
      });
      if (
        path === destination ||
        (!entry.isDirectory() && !entry.isSymbolicLink()) ||
        protectedDestination
      )
        throw new OperationalError(
          "invalid-arguments",
          "Log paths must be new and resolve outside the repository and configured academic mounts.",
        );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    if (dirname(path) === path) break;
  }
}
