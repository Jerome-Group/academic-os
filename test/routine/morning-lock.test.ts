import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withMorningLock } from "../../src/commands/routine-morning-command.js";
import { runMaintenanceProcess } from "../../src/routine/maintenance-process.js";

test("morning lock excludes concurrent and interrupted runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "morning-lock-"));
  try {
    await withMorningLock(root, async () => {
      await assert.rejects(
        withMorningLock(root, async () => {}),
        /lock exists/u,
      );
      assert.match(
        await readFile(join(root, "routine/run.lock"), "utf8"),
        /pid/u,
      );
    });
    await withMorningLock(root, async () => {});
    await writeFile(join(root, "routine/run.lock"), "interrupted");
    await assert.rejects(
      withMorningLock(root, async () => {}),
      /interrupted/u,
    );
    assert.equal(
      await readFile(join(root, "routine/run.lock"), "utf8"),
      "interrupted",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unbounded process completes after a slow start", async () => {
  const result = await runMaintenanceProcess({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => process.exit(0), 350)"],
    cwd: tmpdir(),
    env: process.env,
  });
  assert.deepEqual(result, { code: 0, signal: null });
});

test("interrupting the controller stops its detached session", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(join(tmpdir(), "morning-cancel-"));
  const marker = join(root, "pid");
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "dist/src/routine/maintenance-process.js"),
  ).href;
  const script = `import { runMaintenanceProcess } from ${JSON.stringify(moduleUrl)};
await runMaintenanceProcess({executable:process.execPath,args:['-e',${JSON.stringify("require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)")},${JSON.stringify(marker)}],cwd:process.cwd(),env:process.env});`;
  const controller = spawn(
    process.execPath,
    ["--input-type=module", "-e", script],
    { stdio: "ignore" },
  );
  let childPid = 0;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        childPid = Number(await readFile(marker, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.ok(childPid > 0);
    const exited = new Promise((resolve) => controller.once("exit", resolve));
    controller.kill("SIGTERM");
    await exited;
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) {
      try {
        process.kill(childPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 20));
      } catch {
        alive = false;
      }
    }
    assert.equal(
      alive,
      false,
      "detached session survived controller termination",
    );
  } finally {
    controller.kill("SIGKILL");
    if (childPid > 0) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("separate controllers cannot hold the same morning lock", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(join(tmpdir(), "morning-overlap-"));
  const marker = join(root, "ready");
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "dist/src/commands/routine-morning-command.js"),
  ).href;
  const script = `import {withMorningLock} from ${JSON.stringify(moduleUrl)}; import {writeFile} from 'node:fs/promises'; await withMorningLock(${JSON.stringify(root)},async()=>{await writeFile(${JSON.stringify(marker)},'ready'); await new Promise(resolve=>setTimeout(resolve,1500));});`;
  const controller = spawn(
    process.execPath,
    ["--input-type=module", "-e", script],
    { stdio: "ignore" },
  );
  const exited = new Promise<number | null>((resolve) =>
    controller.once("exit", resolve),
  );
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        await readFile(marker);
        ready = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.equal(ready, true);
    await assert.rejects(
      withMorningLock(root, async () => {}),
      /lock exists/u,
    );
    assert.equal(await exited, 0);
    await withMorningLock(root, async () => {});
  } finally {
    if (controller.exitCode === null) controller.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
