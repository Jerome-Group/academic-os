import { type AcademicConfig, loadLocalConfig } from "../config/index.js";
import {
  evaluateResearchProjectAudit,
  resolveConfiguredAuditTarget,
  runCohortAudit,
} from "../cohort/index.js";
import {
  planModuleConformance,
  type ResearchProjectInventory,
} from "../conformance/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import { loadResearchProjectContract } from "../contract/load-research-project-contract.js";
import {
  createGoogleDriveFilesClient,
  inventoryDriveModule,
} from "../drive/index.js";
import {
  appendMountedAuditObservation,
  inspectMountedModule,
  inspectMountedResearchProject,
  type LocalConfig,
  OperationalError,
  readMountedAuditHistory,
} from "../mounted/index.js";
import {
  createJsonAuditReport,
  exitCodeForOutcome,
  renderHumanAuditReport,
  renderHumanCohortReport,
  renderHumanResearchProjectAuditReport,
} from "../report/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os audit --config <path> [--semester <semester> --module <module> [--migration] | --research-project <key>] [--inventory mounted|drive-api] [--json]";

export async function runAuditCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseAuditArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  if (parsed.researchProject !== undefined) {
    if (!("activeSemester" in config)) {
      throw new OperationalError(
        "invalid-config",
        "Research-project audit requires an academic configuration.",
      );
    }
    await runResearchProjectAudit(
      config,
      parsed.researchProject,
      parsed.inventory,
      json,
    );
    return;
  }
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
    contract: await loadModuleContract(),
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
  researchProject?: string;
  migration: boolean;
  inventory: "mounted" | "drive-api";
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "audit",
    valueFlags: [
      "--config",
      "--semester",
      "--module",
      "--research-project",
      "--inventory",
    ],
    booleanFlags: ["--migration", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  const semester = values.get("--semester");
  const module = values.get("--module");
  const researchProject = values.get("--research-project");
  const inventory = values.get("--inventory") ?? "mounted";
  if (
    configPath === undefined ||
    (semester === undefined) !== (module === undefined) ||
    (flags.has("--migration") && semester === undefined) ||
    (researchProject !== undefined && semester !== undefined) ||
    (researchProject !== undefined && flags.has("--migration")) ||
    !["mounted", "drive-api"].includes(inventory)
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return {
    configPath,
    ...(semester === undefined ? {} : { semester }),
    ...(module === undefined ? {} : { module }),
    ...(researchProject === undefined ? {} : { researchProject }),
    migration: flags.has("--migration"),
    inventory: inventory as "mounted" | "drive-api",
  };
}

async function runResearchProjectAudit(
  config: AcademicConfig,
  key: string,
  inventorySource: "mounted" | "drive-api",
  json: boolean,
): Promise<void> {
  const mounted = await inspectMountedResearchProject(config, key);
  const inventory =
    inventorySource === "drive-api"
      ? await readResearchDriveInventory(config, key)
      : mounted.inventory;
  const report = await evaluateResearchProjectAudit({
    contract: await loadResearchProjectContract(),
    target: mounted.target,
    inventory,
    controls: mounted.controls,
  });
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderHumanResearchProjectAuditReport(report)}\n`,
  );
  process.exitCode = exitCodeForOutcome(report.outcome);
}

async function readResearchDriveInventory(
  config: AcademicConfig,
  key: string,
): Promise<ResearchProjectInventory> {
  const folderId = config.driveApi?.researchProjectFolderIds?.[key];
  if (typeof folderId !== "string" || folderId.length === 0) {
    throw new OperationalError(
      "invalid-config",
      `Drive API inventory requires driveApi.researchProjectFolderIds.${key}.`,
    );
  }
  const inventory = await inventoryDriveModule(
    { moduleCode: key, moduleFolderId: folderId },
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
  return {
    projectKey: key,
    entries: inventory.entries,
    ...(inventory.excludedEntries === undefined
      ? {}
      : { excludedEntries: inventory.excludedEntries }),
    provenance: inventory.provenance,
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
