import { lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadLocalConfig } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { readControls } from "../controls/index.js";
import { inspectMountedModule, OperationalError } from "../mounted/index.js";
import { inventoryDirectory } from "../mounted/inventory-mounted-module.js";
import { observeModuleControls } from "../mounted/observe-module-controls.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os module inspect (--root <module-root> | --config <path> [--semester <semester> --module <module>]) [--json]";

export async function runModuleInspectCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "inspect",
    valueFlags: ["--root", "--config", "--semester", "--module"],
    booleanFlags: ["--json"],
    usage,
  });
  const root = values.get("--root");
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  if (
    (root === undefined) === (configPath === undefined) ||
    (semester === undefined) !== (module === undefined) ||
    (root !== undefined && semester !== undefined)
  )
    throw new OperationalError("invalid-arguments", usage);
  const read =
    root !== undefined
      ? await inspectRoot(root)
      : await inspectConfigured(configPath ?? "", semester, module);
  const report = {
    outcome: read.kind === "unsupported" ? "refused" : "read",
    ...read,
    evidence: read.evidence.map(({ bytesBase64: _bytes, ...item }) => item),
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.outcome}: ${report.kind}; coverage=${report.coverage}\n${report.diagnostics.map((item) => `${item.code} ${item.path}${item.pointer}: ${item.message} ${item.remediation}`).join("\n")}\n`,
  );
  process.exitCode = read.kind === "unsupported" ? 2 : 0;
}

async function inspectConfigured(
  path: string,
  semester: string | undefined,
  module: string | undefined,
) {
  const config = await loadLocalConfig(path);
  const target =
    "activeSemester" in config
      ? resolveConfiguredAuditTarget(config, semester ?? "", module ?? "")
      : config;
  if (
    !("activeSemester" in config) &&
    semester !== undefined &&
    (target.semester !== semester || target.module !== module)
  )
    throw new OperationalError(
      "invalid-arguments",
      "Explicit target conflicts with the local configuration.",
    );
  const mounted = await inspectMountedModule(target, { controls: "any" });
  return mounted.controlRead;
}

async function inspectRoot(input: string) {
  const requested = resolve(input);
  const metadata = await lstat(requested);
  const root = await realpath(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new OperationalError(
      "invalid-target",
      "Portable root must identify a directory and cannot itself be a symbolic link.",
    );
  const moduleCode = basename(root);
  if (!/^[A-Z]{2,4}\d{4}[A-Z]?$/u.test(moduleCode))
    throw new OperationalError(
      "invalid-target",
      "Portable root basename must be a 2–4 letter module code, four digits and optional uppercase suffix.",
    );
  const inventory = { moduleCode, entries: await inventoryDirectory(root) };
  return readControls({
    moduleCode,
    files: await observeModuleControls(root, inventory),
  });
}
