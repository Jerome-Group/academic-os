import { lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadLocalConfig, requireLocalConfig } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { readControls } from "../controls/index.js";
import { inspectMountedModule, OperationalError } from "../mounted/index.js";
import { inventoryDirectory } from "../mounted/inventory-mounted-module.js";
import { observeModuleControls } from "../mounted/observe-module-controls.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runModuleInspectCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const operation = arguments_[0] === "validate" ? "validate" : "inspect";
  const usage =
    operation === "validate"
      ? "Usage: academic-os module validate (--root <module-root> | --config <path> [--semester <semester> --module <module>]) [--json]"
      : "Usage: academic-os module inspect (--root <module-root> | --config <path> [--semester <semester> --module <module>]) [--json]";
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: operation,
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
  const validModuleData =
    read.kind === "canonical" && read.coverage === "validated-module-data";
  const refused =
    read.kind === "unsupported" ||
    (operation === "validate" && !validModuleData);
  const report = {
    outcome: refused
      ? "refused"
      : operation === "validate"
        ? "validated-module-data"
        : "read",
    ...read,
    diagnostics:
      operation === "validate" &&
      read.kind !== "unsupported" &&
      !validModuleData
        ? [
            ...read.diagnostics,
            {
              code: "full-module-data-required",
              path: "00 Module Admin/00 Module.json",
              pointer: "/generation/schema",
              message:
                "Candidate validation requires a complete module-data generation2. Legacy and identity-only reads remain partial observations.",
              remediation:
                "Provide a separate complete candidate generation. Publication, executable workflows and migration readiness are not implemented by this validator.",
            },
          ]
        : read.diagnostics,
    evidence: read.evidence.map(({ bytesBase64: _bytes, ...item }) => item),
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.outcome}: ${report.kind}; coverage=${report.coverage}\n${read.kind === "canonical" && read.readiness.verification ? "verification: not-implemented; structural validation only.\n" : ""}${report.diagnostics.map((item) => `${item.code} ${item.path}${item.pointer}: ${item.message} ${item.remediation}`).join("\n")}\n`,
  );
  process.exitCode = refused ? 2 : 0;
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
      : requireLocalConfig(config);
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
