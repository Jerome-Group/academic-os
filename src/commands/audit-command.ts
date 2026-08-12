import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import {
  resolveConfiguredAuditTarget,
  runCohortAudit,
} from "../cohort/index.js";
import {
  currentModuleContract,
  planModuleConformance,
} from "../conformance/index.js";
import {
  createGoogleDriveFilesClient,
  inventoryDriveModule,
} from "../drive/index.js";
import {
  appendMountedAuditObservation,
  inspectMountedModule,
  type LocalConfig,
  OperationalError,
  readMountedAuditHistory,
} from "../mounted/index.js";
import {
  createJsonAuditReport,
  exitCodeForOutcome,
  renderHumanAuditReport,
  renderHumanCohortReport,
} from "../report/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os audit --config <path> [--semester <semester> --module <module> [--migration]] [--inventory mounted|drive-api] [--json]";

export async function runAuditCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseAuditArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (
    "activeSemester" in config &&
    parsed.semester === undefined &&
    parsed.module === undefined
  ) {
    await runActiveCohort(config, parsed.inventory, json);
    return;
  }
  const targetConfig =
    "activeSemester" in config
      ? resolveConfiguredAuditTarget(
          config,
          parsed.semester ?? "",
          parsed.module ?? "",
        )
      : config;
  requireMigrationTarget(config, parsed);
  await runTargetAudit(targetConfig, parsed, json);
}

async function runActiveCohort(
  config: AcademicConfig,
  inventory: "mounted" | "drive-api",
  json: boolean,
): Promise<void> {
  if (inventory === "drive-api") {
    throw new OperationalError(
      "invalid-arguments",
      "Drive API inventory requires an explicit semester and module target.",
    );
  }
  const report = await runCohortAudit(config);
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderHumanCohortReport(report)}\n`,
  );
  process.exitCode = exitCodeForOutcome(report.outcome);
}

async function runTargetAudit(
  config: LocalConfig,
  parsed: ReturnType<typeof parseAuditArguments>,
  json: boolean,
): Promise<void> {
  const mounted = await inspectMountedModule(config);
  const inventory =
    parsed.inventory === "drive-api"
      ? await readDriveInventory(config)
      : mounted.inventory;
  const { target, controls } = mounted;
  const history = await readMountedAuditHistory(target);
  const result = planModuleConformance({
    contract: currentModuleContract,
    target: {
      moduleCode: target.module,
      semester: target.semester,
      identity: target.moduleRoot,
    },
    inventory,
    controls,
    ...(history.previous === undefined
      ? {}
      : { priorObservation: history.previous }),
    observedAt: new Date().toISOString(),
  });
  const recorded = await appendMountedAuditObservation({
    target,
    observation: result.observation,
    comparison: result.comparison,
    historyDiagnostics: history.diagnostics,
  });
  const mode = parsed.migration ? "migration" : "target";
  process.stdout.write(
    json
      ? `${JSON.stringify(createJsonAuditReport(target, result, recorded, mode), null, 2)}\n`
      : `${renderHumanAuditReport(target, result, recorded, mode)}\n`,
  );
  process.exitCode = exitCodeForOutcome(result.outcome);
}

function requireMigrationTarget(
  config: LocalConfig | AcademicConfig,
  parsed: ReturnType<typeof parseAuditArguments>,
): void {
  if (
    parsed.migration &&
    (!("activeSemester" in config) ||
      config.semesters[parsed.semester ?? ""]?.status !== "past")
  ) {
    throw new OperationalError(
      "invalid-arguments",
      "Migration mode requires an explicitly configured past-semester target.",
    );
  }
}

function parseAuditArguments(arguments_: string[]): {
  configPath: string;
  semester?: string;
  module?: string;
  migration: boolean;
  inventory: "mounted" | "drive-api";
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "audit",
    valueFlags: ["--config", "--semester", "--module", "--inventory"],
    booleanFlags: ["--migration", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  const inventory = values.get("--inventory") ?? "mounted";
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined) ||
    (flags.has("--migration") && semester === undefined) ||
    !["mounted", "drive-api"].includes(inventory)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    ...(semester === undefined ? {} : { semester }),
    ...(module === undefined ? {} : { module }),
    migration: flags.has("--migration"),
    inventory: inventory as "mounted" | "drive-api",
  };
}

async function readDriveInventory(config: LocalConfig) {
  const moduleFolderId = config.driveApi?.moduleFolderId;
  if (typeof moduleFolderId !== "string" || moduleFolderId.length === 0) {
    throw new OperationalError(
      "invalid-config",
      `Drive API inventory requires driveApi.moduleFolderId for ${config.module}.`,
    );
  }
  const inventory = await inventoryDriveModule(
    { moduleCode: config.module, moduleFolderId },
    createGoogleDriveFilesClient(),
  );
  if (inventory.provenance.completeness === "partial") {
    const evidence = inventory.provenance.diagnostics
      .map(({ kind, evidence: detail }) => `${kind}: ${detail}`)
      .join(" ");
    throw new OperationalError(
      "unsafe-inventory",
      `Drive API inventory is incomplete. ${evidence}`,
      { inventoryProvenance: inventory.provenance },
    );
  }
  return inventory;
}
