import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { planLaunchdJob } from "../../src/launchd/index.js";
import { describeStateRefreshLaunchdJob } from "../../src/routine/state-refresh-launchd.js";
import { runStateRefreshLaunchdJob } from "../../src/routine/run-state-refresh.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-state-refresh-"));
  roots.push(root);
  const stateRoot = join(root, "state");
  const driveMount = join(root, "drive");
  await mkdir(stateRoot);
  await mkdir(driveMount);
  const cliPath = join(root, "cli.mjs");
  const notificationPath = join(root, "notify.mjs");
  const configPath = join(root, "config.json");
  const calls = join(root, "calls.jsonl");
  const notices = join(root, "notices.jsonl");
  const outcomes = join(root, "outcomes.json");
  await writeFile(configPath, JSON.stringify({ stateRoot, driveMount }));
  await writeFile(outcomes, JSON.stringify({ calendar: 0, tasks: 0 }));
  await writeFile(
    cliPath,
    `import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
process.exitCode = JSON.parse(readFileSync(${JSON.stringify(outcomes)}, 'utf8'))[args[0]];
`,
  );
  await writeFile(
    notificationPath,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(notices)}, JSON.stringify(process.argv.slice(2)) + '\\n');
`,
  );
  await chmod(notificationPath, 0o755);
  return {
    root,
    stateRoot,
    cliPath,
    notificationPath,
    configPath,
    calls,
    notices,
    outcomes,
    nodePath: process.execPath,
  };
}

async function lines(path: string): Promise<string[]> {
  return await readFile(path, "utf8")
    .then((s) => s.trim().split("\n"))
    .catch(() => []);
}

describe("periodic private state refresh", () => {
  it("runs both pull commands, saves freshness, and stays quiet on healthy repeated runs", async () => {
    const input = await fixture();
    assert.equal(await runStateRefreshLaunchdJob(input), 0);
    assert.equal(await runStateRefreshLaunchdJob(input), 0);
    const calls = (await lines(input.calls)).map((s) => JSON.parse(s));
    assert.deepEqual(
      calls,
      ["calendar", "tasks", "calendar", "tasks"].map((service) => [
        service,
        "refresh",
        "--config",
        input.configPath,
        "--json",
      ]),
    );
    assert.deepEqual(await lines(input.notices), []);
    const status = JSON.parse(
      await readFile(
        join(input.stateRoot, "state-refresh/status.json"),
        "utf8",
      ),
    );
    assert.equal(status.services.tasks.exitCode, 0);
    assert.ok(status.services.tasks.lastSuccess);
  });

  it("isolates failures and notifies only failure/recovery transitions", async () => {
    const input = await fixture();
    await writeFile(input.outcomes, JSON.stringify({ calendar: 2, tasks: 0 }));
    assert.equal(await runStateRefreshLaunchdJob(input), 2);
    assert.equal(await runStateRefreshLaunchdJob(input), 2);
    assert.equal((await lines(input.notices)).length, 1);
    assert.equal((await lines(input.calls)).length, 4);
    let status = JSON.parse(
      await readFile(
        join(input.stateRoot, "state-refresh/status.json"),
        "utf8",
      ),
    );
    assert.equal(status.services.calendar.lastSuccess, null);
    const lastSuccess = status.services.tasks.lastSuccess;
    await writeFile(input.outcomes, JSON.stringify({ calendar: 0, tasks: 2 }));
    assert.equal(await runStateRefreshLaunchdJob(input), 2);
    const notices = await lines(input.notices);
    assert.equal(notices.length, 2);
    const transition = notices[1];
    assert.ok(transition);
    assert.match(transition, /calendar refresh recovered/u);
    assert.match(transition, /tasks refresh failed/u);
    status = JSON.parse(
      await readFile(
        join(input.stateRoot, "state-refresh/status.json"),
        "utf8",
      ),
    );
    assert.equal(status.services.tasks.lastSuccess, lastSuccess);
  });

  it("uses the actual runner entry point with private config", async () => {
    const input = await fixture();
    const runner = fileURLToPath(
      new URL(
        "../../src/routine/state-refresh-launchd-runner.js",
        import.meta.url,
      ),
    );
    const result = spawnSync(
      process.execPath,
      [runner, input.cliPath, input.configPath, input.notificationPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await lines(input.calls)).length, 2);
  });

  it("renders a 30-minute interval and rejects invalid interval values", () => {
    const description = describeStateRefreshLaunchdJob({
      nodePath: "/bin/node",
      runnerModulePath: "/app/runner.js",
      cliPath: "/app/cli.js",
      configPath: "/private/config.json",
      notificationPath: "/usr/bin/osascript",
    });
    const input = {
      description,
      homeDirectory: "/home/test",
      hostTimeZone: "UTC",
      uid: 501,
    };
    const plan = planLaunchdJob(input);
    assert.match(
      plan.plist,
      /<key>StartInterval<\/key>\n<integer>1800<\/integer>/u,
    );
    assert.equal(plan.runAtLoad, false);
    for (const seconds of [0, -1, 1.5, Number.NaN])
      assert.throws(
        () =>
          planLaunchdJob({
            ...input,
            description: {
              ...description,
              schedule: { kind: "interval", seconds },
            },
          }),
        /positive integer interval/u,
      );
  });

  it("previews installer wiring without changing the scheduler", {
    skip: process.platform !== "darwin",
  }, async () => {
    const input = await fixture();
    const installer = fileURLToPath(
      new URL(
        "../../../scripts/install-state-refresh-launchd.mjs",
        import.meta.url,
      ),
    );
    const result = spawnSync(
      process.execPath,
      [installer, "--config", input.configPath, "--dry-run"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.startInterval, 1800);
    assert.match(
      report.programArguments[1],
      /routine\/state-refresh-launchd-runner.js$/u,
    );
    assert.equal(report.programArguments[3], input.configPath);
  });
});
