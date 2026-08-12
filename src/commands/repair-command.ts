import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import {
  OperationalError,
  resolveConfiguredRoots,
  type LocalConfig,
} from "../mounted/index.js";
import {
  createFileRepairJournalStore,
  createGoogleDriveRepairClient,
  executeRepairPlan,
  inventoryLocalRepairArtifacts,
  recoverRepairPlan,
  type RepairExecutionReport,
  type LocalRepairArtifact,
  type RepairPlan,
  verifyRepairPlan,
  verifyRepairRecovery,
} from "../repair/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os repair --config <path> --plan <path> [--apply [--resume]] [--json]";

export async function runRepairCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseRepairArguments(arguments_);
  const plan = await readRepairPlan(parsed.planPath);
  const academic = requireAcademicConfig(
    await loadLocalConfig(parsed.configPath),
  );
  const local = resolveConfiguredAuditTarget(
    academic,
    plan.module.semester,
    plan.module.code,
  );
  const repair = requireRepairConfig(academic, local, plan);
  const roots = await resolveConfiguredRoots(local);
  const moduleRoot = join(roots.semesterRoot, local.module);
  const snapshotRoot = await validateSnapshotRoot(
    repair.snapshotRoot,
    roots.driveMount,
    roots.stateRoot,
  );
  const [sourceStorage, snapshotStorage] = await Promise.all([
    stat(roots.driveMount),
    stat(snapshotRoot),
  ]);
  const driveClient = createGoogleDriveRepairClient();
  const resolveVerifiedLocalArtifact = async (
    artifact: LocalRepairArtifact,
  ) => {
    const candidate = resolve(moduleRoot, artifact.relativePath);
    const path = await realpath(candidate);
    if (!isWithin(path, moduleRoot)) {
      throw new OperationalError(
        "out-of-root",
        "Local-only repair artifact escapes the module root.",
      );
    }
    const metadata = await lstat(path, { bigint: true });
    if (
      metadata.isSymbolicLink() ||
      String(metadata.dev) !== artifact.device ||
      String(metadata.ino) !== artifact.inode ||
      String(metadata.size) !== artifact.size ||
      metadata.mtimeNs.toString() !== artifact.modifiedTime
    ) {
      throw new OperationalError(
        "unsafe-inventory",
        `Local-only artifact changed after approval: ${artifact.relativePath}.`,
      );
    }
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw new OperationalError(
        "unsafe-inventory",
        `Local-only artifact checksum changed: ${artifact.relativePath}.`,
      );
    }
    return { path, bytes };
  };
  const readLocalArtifact = async (artifact: LocalRepairArtifact) =>
    (await resolveVerifiedLocalArtifact(artifact)).bytes;
  const drive = {
    ...driveClient,
    inventory: async (rootId: string) => {
      const inventory = await driveClient.inventory(rootId);
      if (rootId !== plan.module.rootId) return inventory;
      return {
        ...inventory,
        localArtifacts: await inventoryLocalRepairArtifacts(
          moduleRoot,
          inventory,
        ),
      };
    },
  };
  const recovery = {
    recover: async (approved: RepairPlan) =>
      await recoverRepairPlan({
        plan: approved,
        drive,
        driveRecoveryRootId: repair.driveRecoveryRootId,
        snapshotRoot,
        sourceDevice: String(sourceStorage.dev),
        snapshotDevice: String(snapshotStorage.dev),
        readLocalArtifact,
      }),
    verify: async (evidence: Awaited<ReturnType<typeof recoverRepairPlan>>) =>
      await verifyRepairRecovery(evidence, drive),
  };
  const report = await executeRepairPlan({
    plan,
    mode: parsed.apply ? "apply" : "preview",
    resume: parsed.resume,
    drive,
    recovery,
    journal: createFileRepairJournalStore(roots.stateRoot),
    local: {
      retireArtifact: async (artifact, evidence) => {
        if (
          !evidence.bytes.localArtifacts.some(
            (candidate) =>
              candidate.device === artifact.device &&
              candidate.inode === artifact.inode &&
              candidate.sha256 === artifact.sha256,
          )
        ) {
          throw new OperationalError(
            "unsafe-inventory",
            "Local artifact lacks verified byte recovery evidence.",
          );
        }
        const verified = await resolveVerifiedLocalArtifact(artifact);
        const finalMetadata = await lstat(verified.path, { bigint: true });
        if (
          String(finalMetadata.dev) !== artifact.device ||
          String(finalMetadata.ino) !== artifact.inode
        ) {
          throw new OperationalError(
            "unsafe-inventory",
            "Local artifact identity changed at retirement boundary.",
          );
        }
        await unlink(verified.path);
        return {
          itemId: `local:${artifact.device}:${artifact.inode}`,
          parentId: evidence.bytes.path,
          name: artifact.relativePath,
          mimeType: "application/vnd.academic-os.retired-local-artifact",
        };
      },
      verifyRetired: async (artifact) => {
        try {
          await lstat(resolve(moduleRoot, artifact.relativePath));
          return false;
        } catch (error) {
          return isNodeError(error) && error.code === "ENOENT";
        }
      },
    },
  });
  writeRepairReport(report, json);
  process.exitCode = [
    "blocked",
    "safely-resumable",
    "partially-completed",
  ].includes(report.outcome)
    ? 1
    : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseRepairArguments(arguments_: string[]): {
  configPath: string;
  planPath: string;
  apply: boolean;
  resume: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "repair",
    valueFlags: ["--config", "--plan"],
    booleanFlags: ["--apply", "--resume", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const planPath = values.get("--plan");
  if (
    configPath === undefined ||
    planPath === undefined ||
    (flags.has("--resume") && !flags.has("--apply"))
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    planPath,
    apply: flags.has("--apply"),
    resume: flags.has("--resume"),
  };
}

async function readRepairPlan(path: string): Promise<RepairPlan> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new OperationalError(
      "invalid-config",
      `Repair plan cannot be read: ${path}.`,
    );
  }
  try {
    verifyRepairPlan(value as RepairPlan);
  } catch (error) {
    throw new OperationalError(
      "invalid-config",
      error instanceof Error ? error.message : "Repair plan is invalid.",
    );
  }
  return value as RepairPlan;
}

function requireAcademicConfig(
  config: LocalConfig | AcademicConfig,
): AcademicConfig {
  if (!("activeSemester" in config)) {
    throw new OperationalError(
      "invalid-config",
      "Repair requires semester-aware academic configuration.",
    );
  }
  return config;
}

function requireRepairConfig(
  config: AcademicConfig,
  local: LocalConfig,
  plan: RepairPlan,
): NonNullable<AcademicConfig["repair"]> {
  const repair = config.repair;
  const configuredId =
    config.driveApi?.moduleFolderIds[local.semester]?.[local.module];
  if (
    repair === undefined ||
    repair.driveRecoveryRootId.trim() === "" ||
    !isAbsolute(repair.snapshotRoot) ||
    configuredId !== plan.module.rootId
  ) {
    throw new OperationalError(
      "invalid-config",
      "Repair requires matching module/recovery Drive IDs and an absolute snapshotRoot.",
    );
  }
  return repair;
}

async function validateSnapshotRoot(
  snapshotRoot: string,
  driveMount: string,
  stateRoot: string,
): Promise<string> {
  const [snapshot, drive, state] = await Promise.all([
    realpath(snapshotRoot),
    realpath(driveMount),
    realpath(stateRoot),
  ]);
  const repository = await realpath(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  if (
    overlaps(snapshot, drive) ||
    overlaps(snapshot, state) ||
    overlaps(snapshot, repository)
  ) {
    throw new OperationalError(
      "out-of-root",
      "Repair snapshotRoot must be outside Drive, private state and the repository.",
    );
  }
  return snapshot;
}

function overlaps(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

function isWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function writeRepairReport(report: RepairExecutionReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${[
      `Repair ${report.module.code} (${report.module.semester})`,
      `Change set: ${report.changeSetId}`,
      `Outcome: ${report.outcome}`,
      `${report.completedOperations.length} operations completed; ${report.remainingOperations.length} remaining.`,
      `Completed: ${report.completedOperations.join(", ") || "none"}`,
      `Remaining: ${report.remainingOperations.join(", ") || "none"}`,
      ...report.evidence.map((evidence) => `Evidence: ${evidence}`),
    ].join("\n")}\n`,
  );
}
