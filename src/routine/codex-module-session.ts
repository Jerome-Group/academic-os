import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { resolveTarget } from "../mounted/index.js";
import { moduleSessionDirectory } from "./file-routine-artifacts.js";
import { MODULE_PASS_SCHEMA } from "./module-pass-schema.js";
import { morningSessionPrompt } from "./morning-session-prompt.js";
import { readModulePassOutcome } from "./read-module-pass-outcome.js";
import { failedModulePass } from "./routine-failure.js";
import type { ModulePassOutcome, ModuleSessionPort } from "./types.js";

// `luna max` as the Owner names it — passed explicitly rather than left to the machine's Codex
// defaults, so an edit to that file cannot quietly change what curates the degree.
export const MORNING_SESSION_MODEL = "gpt-5.6-luna";
export const MORNING_SESSION_REASONING_EFFORT = "max";

// Everything a pass writes is inside the module folder it was pointed at — importer roots are
// interior to it, and the result is written by the CLI rather than by the model. So the morning's
// unattended agent gets the workspace and nothing else, stated here rather than inherited from a
// machine's Codex configuration.
export const MORNING_SESSION_SANDBOX = "workspace-write";

// A hung session would hold the whole cohort behind it until the Owner woke, which is the one
// failure the morning cannot absorb. The bound is generous for a morning's arrivals and short
// enough that a full cohort of hangs still finishes before breakfast.
const MORNING_SESSION_TIMEOUT_MS = 20 * 60 * 1000;

const SESSION_LOG_FILENAME = "session.log";
const SESSION_SCHEMA_FILENAME = "result-schema.json";
export const MORNING_SESSION_RESULT_FILENAME = "result.json";

export function codexSessionArguments(input: {
  prompt: string;
  schemaPath: string;
  resultPath: string;
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
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.resultPath,
    input.prompt,
  ];
}

// One headless session per module, in its own folder, reporting through a file rather than through
// its transcript: the wrapper reads a result it can hold the report against, and keeps the
// transcript beside it for the morning the result is the argument.
export function createCodexModuleSession(input: {
  config: AcademicConfig;
  codexPath: string;
  date: string;
}): ModuleSessionPort {
  return {
    run: async (module) => {
      const artifacts = moduleSessionDirectory({
        stateRoot: input.config.stateRoot,
        date: input.date,
        module: module.module,
      });
      try {
        return {
          ...module,
          artifacts,
          ...(await runSession({ ...input, module, artifacts })),
        };
      } catch (error) {
        return {
          ...module,
          artifacts,
          ...failedModulePass(error, "session-failed"),
        };
      }
    },
  };
}

async function runSession(input: {
  config: AcademicConfig;
  codexPath: string;
  module: ConfiguredModule;
  artifacts: string;
}): Promise<ModulePassOutcome> {
  const target = await resolveTarget(
    resolveConfiguredAuditTarget(
      input.config,
      input.module.semester,
      input.module.module,
    ),
  );
  const resultPath = join(input.artifacts, MORNING_SESSION_RESULT_FILENAME);
  const schemaPath = join(input.artifacts, SESSION_SCHEMA_FILENAME);
  await mkdir(input.artifacts, { recursive: true });
  await rm(resultPath, { force: true });
  await writeFile(
    schemaPath,
    `${JSON.stringify(MODULE_PASS_SCHEMA, null, 2)}\n`,
  );
  const exitCode = await spawnCodex({
    codexPath: input.codexPath,
    moduleRoot: target.moduleRoot,
    logPath: join(input.artifacts, SESSION_LOG_FILENAME),
    arguments: codexSessionArguments({
      prompt: morningSessionPrompt(input.module.module),
      schemaPath,
      resultPath,
    }),
  });
  const outcome = readModulePassOutcome(await readFile(resultPath, "utf8"));
  return exitCode === 0
    ? outcome
    : {
        ...outcome,
        failures: [
          ...outcome.failures,
          {
            code: "session-exit",
            message: `The session exited with status ${exitCode}.`,
          },
        ],
      };
}

// Stdin is closed rather than inherited: `codex exec` reads it for extra instructions, and an open
// pipe with nothing coming holds the session — and behind it, the cohort — until the timeout.
function spawnCodex(input: {
  codexPath: string;
  moduleRoot: string;
  logPath: string;
  arguments: string[];
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(input.logPath);
    const session = spawn(
      input.codexPath,
      input.arguments,
      sessionSpawnOptions({
        codexPath: input.codexPath,
        moduleRoot: input.moduleRoot,
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
            `The session was stopped by ${signal} after ${MORNING_SESSION_TIMEOUT_MS} ms.`,
          ),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

// How the session is launched, built where a test can read it. The environment is the reason this is
// a seam rather than an object literal at the call site: it was written once, left uncalled, and
// every pass since searched without the ripgrep its own installation ships — a defect no test could
// see because nothing exercised the spawn. Returning the options makes the wiring itself assertable.
export function sessionSpawnOptions(input: {
  codexPath: string;
  moduleRoot: string;
}): {
  cwd: string;
  stdio: ["ignore", "pipe", "pipe"];
  timeout: number;
  env: NodeJS.ProcessEnv;
} {
  return {
    cwd: input.moduleRoot,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: MORNING_SESSION_TIMEOUT_MS,
    env: sessionEnvironment(input.codexPath),
  };
}

// A LaunchAgent runs with a minimal PATH, so a scheduled pass would search without the ripgrep its
// own installation ships — and quietly do worse work at 06:00 than the same pass does by hand. The
// tools beside the Codex binary are the ones it expects to find, so they go on the front.
function sessionEnvironment(codexPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [dirname(codexPath), process.env.PATH]
      .filter((entry) => entry !== undefined && entry !== "")
      .join(delimiter),
  };
}
