import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";

export async function runMaintenanceProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  log?: string;
  onOutput?: (chunk: Buffer) => boolean | undefined;
}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const deadline = performance.now() + input.timeoutMs;
  let child: ChildProcess | undefined;
  let failure: Error | undefined;
  const stop = () => {
    if (child?.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const fail = (error: Error) => {
    failure ??= error;
    stop();
  };
  const resumeOutput = () => {
    child?.stdout?.resume();
    child?.stderr?.resume();
  };
  const log =
    input.log === undefined
      ? undefined
      : createWriteStream(input.log, {
          flags: "wx",
          mode: 0o600,
        });
  log?.on("error", fail);
  log?.on("drain", resumeOutput);
  log?.on("close", resumeOutput);
  let timedOut = false;
  const logClosed =
    log === undefined
      ? Promise.resolve()
      : finished(log, { cleanup: true }).catch((error: Error) => {
          if (!timedOut) fail(error);
        });
  const timeout = setTimeout(
    () => {
      timedOut = true;
      stop();
      log?.destroy();
    },
    Math.max(1, deadline - performance.now()),
  );
  let result: { code: number | null; signal: NodeJS.Signals | null } = {
    code: null,
    signal: "SIGKILL",
  };
  try {
    if (log !== undefined)
      await new Promise<void>((resolve, reject) => {
        log.once("open", () => resolve());
        log.once("close", () => resolve());
        log.once("error", reject);
      });
    if (!timedOut && !log?.destroyed && performance.now() < deadline) {
      const running = spawn(input.executable, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      child = running;
      for (const stream of [running.stdout, running.stderr]) {
        stream.on("error", fail);
        stream.on("data", (chunk: Buffer) => {
          try {
            if (input.onOutput?.(chunk) === false) {
              stop();
              return;
            }
            if (log !== undefined && !log.destroyed && !log.write(chunk)) {
              running.stdout.pause();
              running.stderr.pause();
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
      running.on("error", fail);
      running.on("exit", stop);
      result = await new Promise((resolve) => {
        running.on("close", (code, signal) => resolve({ code, signal }));
      });
    }
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  } finally {
    stop();
    log?.end();
    await logClosed;
    clearTimeout(timeout);
  }
  if (failure !== undefined) throw failure;
  return timedOut ? { code: null, signal: "SIGKILL" } : result;
}
