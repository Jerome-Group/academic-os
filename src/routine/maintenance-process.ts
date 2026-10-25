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
  const log =
    input.log === undefined
      ? undefined
      : createWriteStream(input.log, {
          flags: "wx",
          mode: 0o600,
        });
  log?.on("error", fail);
  const logClosed =
    log === undefined
      ? Promise.resolve()
      : finished(log, { cleanup: true }).catch(fail);
  let timeout: NodeJS.Timeout | undefined;
  let result: { code: number | null; signal: NodeJS.Signals | null } = {
    code: null,
    signal: "SIGKILL",
  };
  try {
    if (log !== undefined)
      await new Promise<void>((resolve, reject) => {
        log.once("open", () => resolve());
        log.once("error", reject);
      });
    if (performance.now() < deadline) {
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
            if (!log?.destroyed) log?.write(chunk);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
      timeout = setTimeout(stop, Math.max(1, deadline - performance.now()));
      running.on("error", fail);
      running.on("exit", stop);
      result = await new Promise((resolve) => {
        running.on("close", (code, signal) => resolve({ code, signal }));
      });
    }
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearTimeout(timeout);
    stop();
    log?.end();
    await logClosed;
  }
  if (failure !== undefined) throw failure;
  return result;
}
