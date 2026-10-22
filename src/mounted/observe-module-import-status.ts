import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";

import { validateDefinition } from "../conformance/validate-definition.js";
import {
  actionForImportStatus,
  evaluateImportStatusReceipt,
  type ImportRootStatus,
} from "../imports/index.js";
import { OperationalError } from "../operational-error.js";
import { isContainedBy } from "./is-contained-by.js";
import { readNoFollow, readSafeFile } from "./read-safe-file.js";
import { resolveTarget } from "./resolve-target.js";
import type { LocalConfig } from "./types.js";

const definitionComponents = [
  "00 Module Admin",
  "10 Module Definition.yaml",
] as const;
const receiptName = "Sync status.json";
const maximumReceiptBytes = 16 * 1024;

export async function observeModuleImportStatus(input: {
  config: LocalConfig;
  observedAt: string;
  maxAgeHours: number;
}): Promise<{
  module: { semester: string; module: string };
  roots: ImportRootStatus[];
}> {
  const target = await resolveTarget(input.config);
  const definition = await readSafeFile(
    target.moduleRoot,
    definitionComponents,
    "Module Definition",
  );
  const validation = validateDefinition(
    definition,
    target.module,
    target.semester,
  );
  const definitionProblems = validation.findings.filter(
    ({ status }) => status !== "pass",
  );
  if (definitionProblems.length > 0) {
    throw new OperationalError(
      "invalid-target",
      `Module Definition is invalid for ${target.module}: ${definitionProblems
        .map(({ evidence }) => evidence)
        .join(" ")}`,
    );
  }
  const importerRoots = validation.importerRoots;
  const roots = await Promise.all(
    importerRoots.map((destination) =>
      observeRoot(
        target.moduleRoot,
        destination,
        input.observedAt,
        input.maxAgeHours,
      ),
    ),
  );
  return {
    module: { semester: target.semester, module: target.module },
    roots,
  };
}

async function observeRoot(
  moduleRoot: string,
  destination: string,
  observedAt: string,
  maxAgeHours: number,
): Promise<ImportRootStatus> {
  const rootPath = join(moduleRoot, destination);
  try {
    await requireSafeDirectory(moduleRoot, rootPath, destination);
  } catch (error) {
    return invalidRoot(destination, messageFrom(error));
  }
  const receiptPath = join(rootPath, receiptName);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(receiptPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyRootStatus(destination, "missing");
    }
    return invalidRoot(
      destination,
      `Receipt cannot be inspected: ${messageFrom(error)}`,
    );
  }
  if (metadata.isSymbolicLink()) {
    return invalidRoot(destination, `${receiptName} is a symbolic link.`);
  }
  if (!metadata.isFile()) {
    return invalidRoot(destination, `${receiptName} is not a regular file.`);
  }
  if (metadata.size > maximumReceiptBytes) {
    return invalidRoot(destination, `${receiptName} exceeds 16 KiB.`);
  }

  let source: string;
  try {
    source = await readNoFollow(receiptPath, maximumReceiptBytes);
  } catch (error) {
    return invalidRoot(
      destination,
      `Receipt cannot be read: ${messageFrom(error)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return invalidRoot(destination, `${receiptName} is not valid JSON.`);
  }
  const evaluated = evaluateImportStatusReceipt(value, observedAt, maxAgeHours);
  if (evaluated.status === "invalid" || evaluated.receipt === undefined) {
    return invalidRoot(
      destination,
      evaluated.validation.valid
        ? "Receipt is invalid."
        : evaluated.validation.problems.join(" "),
    );
  }
  return {
    destination,
    status: evaluated.status,
    action: actionForImportStatus(evaluated.status),
    counts: evaluated.receipt.counts,
    startedAt: evaluated.receipt.startedAt,
    finishedAt: evaluated.receipt.finishedAt,
    lastSuccessfulAt: evaluated.receipt.lastSuccessfulAt,
    unread: evaluated.receipt.unread,
  };
}

async function requireSafeDirectory(
  moduleRoot: string,
  path: string,
  destination: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Importer root ${destination} is a symbolic link.`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Importer root ${destination} is not a directory.`);
  }
  if (!isContainedBy(moduleRoot, await realpath(path))) {
    throw new Error(
      `Importer root ${destination} resolves outside the module root.`,
    );
  }
}

function emptyRootStatus(
  destination: string,
  status: "missing" | "invalid",
  error?: string,
): ImportRootStatus {
  return {
    destination,
    status,
    action: actionForImportStatus(status),
    counts: null,
    startedAt: null,
    finishedAt: null,
    lastSuccessfulAt: null,
    unread: null,
    ...(error === undefined ? {} : { error }),
  };
}

function invalidRoot(destination: string, error: string): ImportRootStatus {
  return emptyRootStatus(destination, "invalid", error);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown filesystem error.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
