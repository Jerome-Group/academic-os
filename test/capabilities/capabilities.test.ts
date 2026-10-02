import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import {
  capabilityIndex,
  cliCapabilities,
} from "../../src/capabilities/catalog.js";
import {
  observeProcess,
  privateProcessDiagnostics,
} from "../../src/capabilities/checks.js";
import { runCli, runCliWithEnvironment } from "../support/run-cli.js";

it("discovers commands, prerequisites, effects and feature verification without config", async () => {
  const result = await runCli("capabilities", "index", "--json");
  assert.equal(result.exitCode, 0, result.stdout);
  const index = JSON.parse(result.stdout) as {
    actions: typeof cliCapabilities;
  };
  assert.equal(
    new Set(index.actions.map((action) => action.id)).size,
    index.actions.length,
  );
  for (const action of index.actions) {
    assert.equal(action.status, "supported");
    assert.equal(action.health, "not-observed");
    assert.ok(action.prerequisites.length);
    await access(action.implementation);
    for (const test of action.tests) await access(test);
  }
  const source = await readFile("src/cli.ts", "utf8");
  for (const imported of source.matchAll(
    /from "\.\/commands\/([a-z-]+)-command\.js"/g,
  )) {
    assert.ok(
      cliCapabilities.some(
        (action) =>
          action.implementation === `src/commands/${imported[1]}-command.ts`,
      ),
      `Unmapped command ${imported[1]}`,
    );
  }
  assert.deepEqual(
    JSON.parse((await runCli("--help")).stdout).actions,
    index.actions,
  );
});

it("surfaces local write effects on diagnostic and cloud-read operations", () => {
  for (const id of [
    "audit",
    "tasks refresh",
    "calendar refresh",
    "textbooks sweep",
    "routine morning",
  ])
    assert.ok(
      cliCapabilities.find((action) => action.id === id)?.writes.length,
      id,
    );
  for (const id of ["imports status", "learning materials"])
    assert.deepEqual(
      cliCapabilities.find((action) => action.id === id)?.writes,
      [],
    );
  assert.ok(
    JSON.stringify(capabilityIndex()).includes(
      "does not prove scheduled maintenance recovery",
    ),
  );
  const actions = (capabilityIndex() as { actions: typeof cliCapabilities })
    .actions;
  for (const id of ["cheatsheet verify", "cheatsheet package-review"])
    assert.ok(
      actions
        .find((action) => action.id === id)
        ?.prerequisites.includes("latexmk and Poppler executables"),
    );
  for (const id of ["tasks_read_register", "research_tasks_read_register"]) {
    const action = actions.find((item) => item.id === id);
    assert.ok(action?.reads.includes("Google Tasks provider"));
    assert.ok(
      action?.writes.some((effect) => effect.includes("mounted task register")),
    );
    assert.ok(action?.riskFlags.includes("mounted-write"));
  }
  assert.ok(
    actions
      .find((action) => action.id === "routine morning")
      ?.riskFlags.includes("external-write"),
  );
  const morning = actions.find((action) => action.id === "routine morning");
  assert.deepEqual(Object.keys(morning?.options ?? {}).sort(), [
    "--model",
    "--modules-only",
    "--reasoning-effort",
    "--retain-artifacts",
  ]);
  assert.ok(morning?.writes.some((effect) => effect.includes("removed")));
  assert.ok(morning?.riskFlags.includes("retention-purge"));
  assert.ok(morning?.tests.includes("test/routine/cohort-prelude.test.ts"));
});

it("distinguishes configured executable readiness from PATH presence and maintenance recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-health-"));
  try {
    const executable = join(root, "synthetic-codex");
    await writeFile(executable, "must never execute this synthetic file");
    await chmod(executable, 0o700);
    const config = join(root, "private-config.json");
    await writeFile(
      config,
      JSON.stringify({
        activeSemester: "SYNTHETIC",
        routine: { codexPath: executable, ghPath: join(root, "missing-gh") },
      }),
    );
    const result = await runCliWithEnvironment(
      { PATH: root },
      "capabilities",
      "health",
      "--config",
      config,
      "--json",
    );
    assert.equal(result.exitCode, 0);
    const health = JSON.parse(result.stdout);
    assert.deepEqual(health.configuredExecutables.tools, [
      { tool: "codex", status: "ready" },
      { tool: "gh", status: "missing" },
    ]);
    assert.ok(
      health.tools.every(
        (tool: { outcome: string }) => tool.outcome === "unavailable",
      ),
    );
    assert.ok(health.unverified.includes("maintenance recovery"));
    assert.ok(!result.stdout.includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses unknown commands and unsafe log destinations before useful work", async () => {
  for (const arguments_ of [
    ["not-a-command", "--json"],
    ["capabilities", "check", "--profile", "untrusted", "--json"],
    [
      "capabilities",
      "check",
      "--log",
      join(process.cwd(), "should-not-exist.log"),
      "--json",
    ],
    ["capabilities", "index", "--profile", "full", "--json"],
  ]) {
    const result = await runCli(...arguments_);
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  }
});

it("records bounded failure, timeout and retry evidence without raw child output", async () => {
  const failed = await observeProcess({
    action: "synthetic failure",
    executable: process.execPath,
    arguments: [
      "-e",
      "console.error('synthetic-private-evidence');process.exit(7)",
    ],
  });
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.outcome, "failed");
  assert.ok(failed.outputBytes > 0);
  assert.equal(failed.outputSha256.length, 64);
  assert.ok(!JSON.stringify(failed).includes("synthetic-private-evidence"));
  assert.ok(
    JSON.stringify(privateProcessDiagnostics(failed)).includes(
      "synthetic-private-evidence",
    ),
  );
  const interrupted = await observeProcess({
    action: "synthetic interruption",
    executable: process.execPath,
    arguments: ["-e", "setInterval(()=>{},1000)"],
    timeoutMs: 50,
  });
  assert.equal(interrupted.outcome, "timed-out");
  const retry = await observeProcess({
    action: "synthetic retry",
    executable: process.execPath,
    arguments: ["-e", "process.exit(0)"],
  });
  assert.equal(retry.outcome, "passed");
});

it("writes exclusive private result logs and refuses symlink containment bypass", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-capability-"));
  try {
    const log = join(root, "index.json");
    assert.equal(
      (await runCli("capabilities", "index", "--log", log, "--json")).exitCode,
      0,
    );
    assert.equal(JSON.parse(await readFile(log, "utf8")).outcome, "indexed");
    assert.equal((await stat(log)).mode & 0o777, 0o600);
    assert.equal(
      (await runCli("capabilities", "index", "--log", log, "--json")).exitCode,
      2,
    );
    await symlink(process.cwd(), join(root, "alias"));
    assert.equal(
      (
        await runCli(
          "capabilities",
          "index",
          "--log",
          join(root, "alias", "leak.json"),
          "--json",
        )
      ).exitCode,
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses logs through aliases into a configured academic mount", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-log-mount-"));
  try {
    const mount = join(root, "mount");
    const alias = join(root, "alias");
    await mkdir(mount);
    await symlink(mount, alias);
    const config = join(root, "private-config.json");
    for (const driveMount of [mount, alias]) {
      await writeFile(
        config,
        JSON.stringify({
          activeSemester: "SYNTHETIC",
          driveMount,
          routine: {
            codexPath: join(root, "missing-codex"),
            ghPath: join(root, "missing-gh"),
          },
        }),
      );
      for (const destination of [
        join(mount, "log.json"),
        join(alias, "nested", "log.json"),
      ]) {
        const result = await runCliWithEnvironment(
          { PATH: root },
          "capabilities",
          "health",
          "--config",
          config,
          "--log",
          destination,
          "--json",
        );
        assert.equal(result.exitCode, 2, JSON.stringify(result));
        assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
        await assert.rejects(access(destination));
      }
    }
    await assert.rejects(access(join(mount, "nested")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
