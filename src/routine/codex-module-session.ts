import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import { planModuleConformance } from "../conformance/index.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { assessLearningMaterials } from "../learning-materials/index.js";
import {
  inspectMountedModule,
  observeModuleImportStatus,
} from "../mounted/index.js";
import { moduleSessionDirectory } from "./file-routine-artifacts.js";
import { MODULE_PASS_SCHEMA } from "./module-pass-schema.js";
import { morningSessionPrompt } from "./morning-session-prompt.js";
import {
  auditEvidence,
  createModuleMaintenanceWorkOrder,
  type MaintenanceImportObservation,
} from "./module-maintenance-work-order.js";
import { readModulePassOutcome } from "./read-module-pass-outcome.js";
import { failedModulePass, routineFailure } from "./routine-failure.js";
import type {
  ModulePassOutcome,
  ModuleSessionPort,
  RoutineFailure,
} from "./types.js";
import {
  validateWriteJournal,
  WRITE_JOURNAL_FILENAME,
} from "./write-journal.js";

export const MORNING_SESSION_MODEL = "gpt-6-astra";
export const MORNING_SESSION_REASONING_EFFORT = "medium";
export const MORNING_SESSION_SANDBOX = "workspace-write";
const MORNING_SESSION_TIMEOUT_MS = 20 * 60 * 1000;
const IMPORT_FRESHNESS_HOURS = 24;

const SESSION_LOG_FILENAME = "session.log";
const SESSION_SCHEMA_FILENAME = "result-schema.json";
export const MORNING_SESSION_RESULT_FILENAME = "result.json";
export const MORNING_SESSION_WORK_ORDER_FILENAME = "work-order.json";
export const MORNING_SESSION_AUDIT_BEFORE_FILENAME = "audit-before.json";
export const MORNING_SESSION_AUDIT_AFTER_FILENAME = "audit-after.json";
export const MORNING_SESSION_VALIDATED_OUTCOME_FILENAME =
  "validated-outcome.json";
export const MORNING_SESSION_ORIGINAL_CONTROLS_DIRECTORY = "original-controls";
export const MORNING_SESSION_WRITE_JOURNAL_DIRECTORY = "write-journal";

export interface CodexSessionRunnerInput {
  codexPath: string;
  moduleRoot: string;
  logPath: string;
  arguments: string[];
  timeoutMs: number;
}

export type CodexSessionRunner = (
  input: CodexSessionRunnerInput,
) => Promise<number>;

export function codexSessionArguments(input: {
  prompt: string;
  schemaPath: string;
  resultPath: string;
  writeJournalDirectory: string;
}): string[] {
  return [
    "exec",
    "--model",
    MORNING_SESSION_MODEL,
    "--config",
    `model_reasoning_effort="${MORNING_SESSION_REASONING_EFFORT}"`,
    "--sandbox",
    MORNING_SESSION_SANDBOX,
    "--skip-git-repo-check",
    "--add-dir",
    input.writeJournalDirectory,
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.resultPath,
    input.prompt,
  ];
}

export function createCodexModuleSession(input: {
  config: AcademicConfig;
  codexPath: string;
  date: string;
  runner?: CodexSessionRunner;
  clock?: () => Date;
}): ModuleSessionPort {
  return {
    run: async (module) => {
      const moduleArtifacts = moduleSessionDirectory({
        stateRoot: input.config.stateRoot,
        date: input.date,
        module: module.module,
      });
      await mkdir(moduleArtifacts, { recursive: true });
      let deadline: number | undefined;
      const completed: AttemptResult[] = [];
      let correction: string | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const artifacts = await mkdtemp(join(moduleArtifacts, "attempt-"));
        try {
          const result = await runSession({
            ...input,
            module,
            artifacts,
            ...(deadline === undefined ? {} : { deadline }),
            ...(correction === undefined ? {} : { correction }),
          });
          deadline ??= result.deadline;
          completed.push(result);
          if (!result.retryable || attempt === 1) break;
          correction = result.correction;
        } catch (error) {
          completed.push({
            artifacts,
            deadline: deadline ?? Number.NEGATIVE_INFINITY,
            retryable: false,
            correction: "",
            outcome: failedModulePass(error, "session-failed"),
          });
          break;
        }
      }
      const final = completed.at(-1);
      if (final === undefined) throw new Error("No maintenance attempt ran.");
      return {
        ...module,
        artifacts: final.artifacts,
        ...mergeAttemptOutcomes(completed.map(({ outcome }) => outcome)),
      };
    },
  };
}

interface AttemptResult {
  artifacts: string;
  deadline: number;
  retryable: boolean;
  correction: string;
  outcome: ModulePassOutcome;
}

async function runSession(input: {
  config: AcademicConfig;
  codexPath: string;
  date: string;
  module: ConfiguredModule;
  artifacts: string;
  runner?: CodexSessionRunner;
  clock?: () => Date;
  deadline?: number;
  correction?: string;
}): Promise<AttemptResult> {
  const configured = resolveConfiguredAuditTarget(
    input.config,
    input.module.semester,
    input.module.module,
  );
  const observedAt = (input.clock ?? (() => new Date()))().toISOString();
  const deadline =
    input.deadline ??
    new Date(observedAt).getTime() + MORNING_SESSION_TIMEOUT_MS;
  const contract = await loadModuleContract();
  const before = await inspectMountedModule(configured);
  const beforePlan = planModuleConformance({
    contract,
    target: observationTarget(before.target),
    controls: before.controls,
    inventory: before.inventory,
    observedAt,
  });

  await mkdir(input.artifacts, { recursive: true });
  const resultPath = join(input.artifacts, MORNING_SESSION_RESULT_FILENAME);
  const schemaPath = join(input.artifacts, SESSION_SCHEMA_FILENAME);
  const writeJournalDirectory = join(
    input.artifacts,
    MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
  );
  const writeJournalPath = join(writeJournalDirectory, WRITE_JOURNAL_FILENAME);
  await rm(resultPath, { force: true });
  await mkdir(writeJournalDirectory);
  await writeFile(writeJournalPath, "");
  await preserveOriginalControls(
    before.controls,
    before.inventory.entries,
    input.artifacts,
  );
  await writeJson(
    join(input.artifacts, MORNING_SESSION_AUDIT_BEFORE_FILENAME),
    auditEvidence(beforePlan),
  );

  const preflightFailures: RoutineFailure[] = [];
  const imports = await importObservation(
    configured,
    observedAt,
    preflightFailures,
  );
  const learningSources = assessLearningMaterials(
    before.inventory.entries.some(
      ({ path, kind }) =>
        path === moduleControlPaths.sourceMap && kind === "file",
    )
      ? before.controls.sourceMap
      : undefined,
    before.inventory,
  );
  const workOrder = createModuleMaintenanceWorkOrder({
    module: {
      code: input.module.module,
      semester: input.module.semester,
    },
    observedAt,
    plan: beforePlan,
    imports,
    learningSources,
    writeJournalDirectory,
    writeJournalPath,
  });
  await writeJson(
    join(input.artifacts, MORNING_SESSION_WORK_ORDER_FILENAME),
    workOrder,
  );
  await writeJson(schemaPath, MODULE_PASS_SCHEMA);

  let exitCode = 1;
  let runnerFailure: RoutineFailure | undefined;
  try {
    exitCode = await (input.runner ?? spawnCodex)({
      codexPath: input.codexPath,
      moduleRoot: before.target.moduleRoot,
      logPath: join(input.artifacts, SESSION_LOG_FILENAME),
      arguments: codexSessionArguments({
        prompt: morningSessionPrompt(
          input.module.module,
          workOrder,
          input.correction,
        ),
        schemaPath,
        resultPath,
        writeJournalDirectory,
      }),
      timeoutMs: Math.max(
        1,
        deadline - (input.clock ?? (() => new Date()))().getTime(),
      ),
    });
  } catch (error) {
    runnerFailure = routineFailure(error, "session-runner-failed");
  }

  let outcome: ModulePassOutcome;
  let parsed = true;
  try {
    outcome = readModulePassOutcome(await readFile(resultPath, "utf8"));
  } catch (error) {
    parsed = false;
    outcome = failedModulePass(error, "session-result-unreadable");
  }
  outcome.failures.push(...preflightFailures);
  if (runnerFailure !== undefined) outcome.failures.push(runnerFailure);
  if (runnerFailure === undefined && exitCode !== 0) {
    outcome.failures.push({
      code: "session-exit",
      message: `The session exited with status ${exitCode}.`,
    });
  }

  const postflight = await postflightAudit({
    configured,
    contract,
    beforePlan,
    beforeControls: before.controls,
    artifacts: input.artifacts,
    outcome,
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
  let journal = {
    valid: false,
    operations: 0,
    completedPaths: [] as string[],
    failures: [] as RoutineFailure[],
  };
  try {
    journal = validateWriteJournal({
      contents: await readFile(writeJournalPath, "utf8"),
      outcome,
      changedPaths: postflight.changedPaths,
    });
  } catch (error) {
    journal.failures.push({
      code: "write-journal-unreadable",
      message: `The session write journal cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  outcome.failures.push(...journal.failures);
  await writeJson(
    join(input.artifacts, MORNING_SESSION_VALIDATED_OUTCOME_FILENAME),
    { schemaVersion: 1, journal, outcome },
  );

  const retryFindings = [...postflight.regressions, ...postflight.residual];
  const nonAuditFailures = outcome.failures.filter(
    ({ code }) =>
      code !== "post-audit-regression" && code !== "post-audit-residual",
  );
  const remaining = deadline - (input.clock ?? (() => new Date()))().getTime();
  const retryable =
    remaining > 0 &&
    exitCode === 0 &&
    parsed &&
    journal.valid &&
    preflightFailures.length === 0 &&
    outcome.parked.length === 0 &&
    nonAuditFailures.length === 0 &&
    retryFindings.length > 0 &&
    retryFindings.every((finding) =>
      isSafeDeterministicCorrection(finding, postflight.proposedDirectories),
    );
  return {
    artifacts: input.artifacts,
    deadline,
    retryable,
    correction: `The first pass left these safe deterministic findings. Correct only these findings, then repeat the complete Maintenance report: ${findingNames(retryFindings)}.`,
    outcome,
  };
}

function observationTarget(target: {
  module: string;
  semester: string;
  moduleRoot: string;
}): { moduleCode: string; semester: string; identity: string } {
  return {
    moduleCode: target.module,
    semester: target.semester,
    identity: target.moduleRoot,
  };
}

async function importObservation(
  configured: ReturnType<typeof resolveConfiguredAuditTarget>,
  observedAt: string,
  failures: RoutineFailure[],
): Promise<MaintenanceImportObservation> {
  try {
    const report = await observeModuleImportStatus({
      config: configured,
      observedAt,
      maxAgeHours: IMPORT_FRESHNESS_HOURS,
    });
    const noncurrent = report.roots.filter(
      ({ status }) => status !== "current",
    );
    if (noncurrent.length > 0) {
      failures.push({
        code: "import-status-noncurrent",
        message: `Importer status is not current for ${noncurrent
          .map(({ destination, status }) => `${destination} (${status})`)
          .join(
            ", ",
          )}; withdrawal inference was disabled while the remaining maintenance continued.`,
      });
    }
    return { available: true, roots: report.roots };
  } catch (error) {
    const failure = routineFailure(error, "import-status-unavailable");
    failures.push(failure);
    return { available: false, roots: [], error: failure.message };
  }
}

async function postflightAudit(input: {
  configured: ReturnType<typeof resolveConfiguredAuditTarget>;
  contract: Awaited<ReturnType<typeof loadModuleContract>>;
  beforePlan: ReturnType<typeof planModuleConformance>;
  beforeControls: Record<string, string | undefined>;
  artifacts: string;
  outcome: ModulePassOutcome;
  clock?: () => Date;
}): Promise<{
  regressions: Array<{
    ruleId: string;
    path: string;
    enforcement: string;
  }>;
  residual: Array<{ ruleId: string; path: string; enforcement: string }>;
  changedPaths: string[];
  proposedDirectories: string[];
}> {
  try {
    const after = await inspectMountedModule(input.configured);
    const afterPlan = planModuleConformance({
      contract: input.contract,
      target: observationTarget(after.target),
      controls: after.controls,
      inventory: after.inventory,
      priorObservation: input.beforePlan.observation,
      observedAt: (input.clock ?? (() => new Date()))().toISOString(),
    });
    await writeJson(
      join(input.artifacts, MORNING_SESSION_AUDIT_AFTER_FILENAME),
      auditEvidence(afterPlan),
    );
    const regressions = afterPlan.comparison.new;
    if (regressions.length > 0) {
      input.outcome.failures.push({
        code: "post-audit-regression",
        message: `The postflight audit found ${regressions.length} new actionable finding(s): ${findingNames(regressions)}.`,
      });
    }
    const residual = afterPlan.findings.filter(
      ({ enforcement, status }) =>
        enforcement === "deterministic" &&
        status !== "pass" &&
        status !== "not-applicable",
    );
    if (residual.length > 0) {
      input.outcome.failures.push({
        code: "post-audit-residual",
        message: `The postflight audit retains ${residual.length} deterministic failure(s): ${findingNames(residual)}.`,
      });
    }
    return {
      regressions,
      residual,
      changedPaths: observedChangedPaths(
        input.beforeControls,
        after.controls,
        input.beforePlan.observation.inventory.entries,
        after.inventory.entries,
      ),
      proposedDirectories: afterPlan.proposedOperations
        .filter(({ kind }) => kind === "create-directory")
        .map(({ path }) => path),
    };
  } catch (error) {
    input.outcome.failures.push(routineFailure(error, "post-audit-unreadable"));
    return {
      regressions: [],
      residual: [],
      changedPaths: [],
      proposedDirectories: [],
    };
  }
}

function observedChangedPaths(
  beforeControls: Record<string, string | undefined>,
  afterControls: Record<string, string | undefined>,
  beforeEntries: Array<{
    path: string;
    kind: string;
    size?: number;
    modifiedAt?: string;
  }>,
  afterEntries: Array<{
    path: string;
    kind: string;
    size?: number;
    modifiedAt?: string;
  }>,
): string[] {
  const changed = new Set<string>();
  for (const name of new Set([
    ...Object.keys(beforeControls),
    ...Object.keys(afterControls),
  ])) {
    if (beforeControls[name] !== afterControls[name]) {
      const path = moduleControlPaths[name as keyof typeof moduleControlPaths];
      if (path !== undefined) changed.add(path);
    }
  }
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path);
    const right = after.get(path);
    if (
      left === undefined ||
      right === undefined ||
      left.kind !== right.kind ||
      (left.kind === "file" &&
        (left.size !== right.size || left.modifiedAt !== right.modifiedAt))
    )
      changed.add(path);
  }
  return [...changed].sort();
}

function isSafeDeterministicCorrection(
  finding: { path: string; enforcement: string },
  proposedDirectories: string[],
): boolean {
  if (finding.enforcement !== "deterministic") return false;
  const mutableControls = new Set<string>([
    moduleControlPaths.profile,
    moduleControlPaths.sourceMap,
    moduleControlPaths.textbookRegister,
    moduleControlPaths.curationRegister,
  ]);
  return (
    proposedDirectories.includes(finding.path) ||
    mutableControls.has(finding.path) ||
    finding.path === "RESOURCES.md" ||
    finding.path.endsWith("/RESOURCES.md")
  );
}

function mergeAttemptOutcomes(
  outcomes: ModulePassOutcome[],
): ModulePassOutcome {
  const final = outcomes.at(-1);
  if (final === undefined) throw new Error("No maintenance outcome exists.");
  const successful = outcomes.slice(0, -1);
  return {
    ...final,
    curated: mergeObjects([
      ...successful.flatMap(({ curated }) => curated),
      ...final.curated,
    ]),
    rederived: mergeObjects([
      ...successful.flatMap(({ rederived }) => rederived),
      ...final.rederived,
    ]),
    superseded: mergeObjects([
      ...successful.flatMap(({ superseded }) => superseded),
      ...final.superseded,
    ]),
    withdrawn: mergeObjects([
      ...successful.flatMap(({ withdrawn }) => withdrawn),
      ...final.withdrawn,
    ]),
    docWrites: mergeObjects([
      ...successful.flatMap(({ docWrites }) => docWrites),
      ...final.docWrites,
    ]),
    noted: mergeObjects([
      ...successful.flatMap(({ noted }) => noted),
      ...final.noted,
    ]),
  };
}

function mergeObjects<Entry>(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findingNames(
  findings: Array<{ ruleId: string; path: string }>,
): string {
  return findings
    .slice(0, 20)
    .map(({ ruleId, path }) => `${ruleId} at ${path}`)
    .join(", ");
}

async function preserveOriginalControls(
  controls: Record<string, string | undefined>,
  inventory: Array<{ path: string; kind: string }>,
  artifacts: string,
): Promise<void> {
  const regularFiles = new Set(
    inventory.filter(({ kind }) => kind === "file").map(({ path }) => path),
  );
  const root = join(artifacts, MORNING_SESSION_ORIGINAL_CONTROLS_DIRECTORY);
  await rm(root, { recursive: true, force: true });
  for (const [name, contents] of Object.entries(controls)) {
    if (contents === undefined) continue;
    const relativePath =
      moduleControlPaths[name as keyof typeof moduleControlPaths];
    if (relativePath === undefined || !regularFiles.has(relativePath)) continue;
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(contents, "utf8"));
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function spawnCodex(input: CodexSessionRunnerInput): Promise<number> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(input.logPath);
    const session = spawn(
      input.codexPath,
      input.arguments,
      sessionSpawnOptions({
        codexPath: input.codexPath,
        moduleRoot: input.moduleRoot,
        timeoutMs: input.timeoutMs,
      }),
    );
    session.stdout.pipe(log);
    session.stderr.pipe(log);
    session.on("error", reject);
    session.on("close", (code, signal) => {
      log.end();
      if (signal !== null) {
        reject(
          new Error(
            `The session was stopped by ${signal} after ${input.timeoutMs} ms.`,
          ),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export function sessionSpawnOptions(input: {
  codexPath: string;
  moduleRoot: string;
  timeoutMs?: number;
}): {
  cwd: string;
  stdio: ["ignore", "pipe", "pipe"];
  timeout: number;
  env: NodeJS.ProcessEnv;
} {
  return {
    cwd: input.moduleRoot,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: input.timeoutMs ?? MORNING_SESSION_TIMEOUT_MS,
    env: sessionEnvironment(input.codexPath),
  };
}

function sessionEnvironment(codexPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [dirname(codexPath), process.env.PATH]
      .filter((entry) => entry !== undefined && entry !== "")
      .join(delimiter),
  };
}
