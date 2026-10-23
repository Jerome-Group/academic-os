import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export async function journalFixture(
  t: TestContext,
  name: string,
): Promise<string> {
  const root = await mkdtemp(
    join(process.env.AOS_JOURNAL_EVIDENCE_ROOT ?? tmpdir(), `journal-${name}-`),
  );
  if (!process.env.AOS_JOURNAL_EVIDENCE_ROOT)
    t.after(() => rm(root, { recursive: true, force: true }));
  return await realpath(root);
}

export function journalProcess(
  t: TestContext,
  root: string,
  name: string,
  args: string[],
  environment: NodeJS.ProcessEnv = {},
) {
  const messages: unknown[] = [];
  const waiters: Array<{
    kind: string;
    resolve: () => void;
    reject: (reason: Error) => void;
  }> = [];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  assert.ok(child.stdout);
  assert.ok(child.stderr);
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 45_000);
  t.after(() => {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  child.on("message", (message) => {
    messages.push(message);
    if (typeof message !== "object" || message === null || !("kind" in message))
      return;
    for (const waiter of waiters.splice(0)) {
      if (message.kind === waiter.kind) waiter.resolve();
      else waiters.push(waiter);
    }
  });
  const done = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", async (code, signal) => {
      clearTimeout(watchdog);
      const result = { code, signal, stdout, stderr };
      try {
        await writeFile(
          join(root, `${name}.json`),
          JSON.stringify({ args, messages, ...result }, null, 2),
        );
        for (const waiter of waiters.splice(0))
          waiter.reject(
            new Error(
              `Child exited before ${waiter.kind}: ${stderr} ${stdout}`,
            ),
          );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
  return {
    child,
    done,
    async wait(kind: string) {
      if (
        messages.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            "kind" in message &&
            message.kind === kind,
        )
      )
        return;
      if (child.exitCode !== null || child.signalCode !== null)
        assert.fail(`Child already exited before ${kind}`);
      await new Promise<void>((resolve, reject) =>
        waiters.push({ kind, resolve, reject }),
      );
    },
  };
}

export async function optionalBytes(path: string): Promise<Buffer> {
  return await readFile(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return Buffer.alloc(0);
    throw error;
  });
}
