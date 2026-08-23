import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { resolveConfiguredAuditTarget } from "../cohort/index.js";
import { resolveTarget } from "../mounted/index.js";
import { moduleSessionDirectory } from "./file-routine-artifacts.js";
import {
  MORNING_SESSION_RESULT_FILENAME,
  morningSessionPrompt,
} from "./morning-session-prompt.js";
import { readModulePassOutcome } from "./read-module-pass-outcome.js";
import { failedModulePass } from "./routine-failure.js";
import type {
  ModulePassOutcome,
  ModulePassReport,
  ModuleSessionPort,
} from "./types.js";

// `luna max` as the Owner names it — passed explicitly rather than left to the machine's Codex
// defaults, so an edit to that file cannot quietly change what curates the degree.
export const MORNING_SESSION_MODEL = "gpt-5.6-luna";
export const MORNING_SESSION_REASONING_EFFORT = "max";

// A pass curates across the Drive mount and writes its result under the private state root, which
// is required to sit outside that mount — two roots no workspace sandbox spans. Stating the escape
// here rather than inheriting it means a narrowed Codex config cannot silently fail every pass.
export const MORNING_SESSION_SANDBOX = "danger-full-access";

// A hung session would hold the whole cohort behind it until the Owner woke, which is the one
// failure the morning cannot absorb. The bound is generous for a morning's arrivals and short
// enough that a full cohort of hangs still finishes before breakfast.
const MORNING_SESSION_TIMEOUT_MS = 20 * 60 * 1000;

const SESSION_LOG_FILENAME = "session.log";

export function codexSessionArguments(prompt: string): string[] {
  return [
    "exec",
    "--model",
    MORNING_SESSION_MODEL,
    "--config",
    `model_reasoning_effort="${MORNING_SESSION_REASONING_EFFORT}"`,
    "--sandbox",
    MORNING_SESSION_SANDBOX,
    "--skip-git-repo-check",
    prompt,
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
  await mkdir(input.artifacts, { recursive: true });
  await rm(resultPath, { force: true });
  const exitCode = await spawnCodex({
    codexPath: input.codexPath,
    moduleRoot: target.moduleRoot,
    logPath: join(input.artifacts, SESSION_LOG_FILENAME),
    prompt: morningSessionPrompt({ module: input.module.module, resultPath }),
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

function spawnCodex(input: {
  codexPath: string;
  moduleRoot: string;
  logPath: string;
  prompt: string;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(input.logPath);
    const session = spawn(
      input.codexPath,
      codexSessionArguments(input.prompt),
      {
        cwd: input.moduleRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: MORNING_SESSION_TIMEOUT_MS,
      },
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
