import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";

import {
  capabilityIndex,
  type Capability,
} from "../../src/capabilities/catalog.js";
import {
  verificationWorkflows,
  workflowTestFiles,
} from "../../src/capabilities/checks.js";

it("assigns every CLI suite once and includes every catalogued test", async () => {
  const selections = await Promise.all(
    verificationWorkflows.map((workflow) =>
      workflowTestFiles(process.cwd(), workflow),
    ),
  );
  const selected = selections.flat();
  for (const file of await readdir("dist/test/cli")) {
    if (!file.endsWith(".test.js")) continue;
    assert.equal(
      selected.filter((path) => path === resolve("dist/test/cli", file)).length,
      1,
      file,
    );
  }
  const index = capabilityIndex() as { actions: Capability[] };
  for (const action of index.actions)
    for (const file of action.tests)
      assert.ok(
        selected.includes(resolve("dist", file.replace(/\.ts$/u, ".js"))),
        `${action.id}: ${file}`,
      );
});

it("reports a failing selected CLI journey and a clean retry through the public command", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "academic-workflow-proof-"));
  const installation = join(fixture, "installation");
  try {
    await cp("dist/src", join(installation, "dist/src"), { recursive: true });
    await cp("dist/test/support", join(installation, "dist/test/support"), {
      recursive: true,
    });
    await writeFile(join(installation, "package.json"), '{"type":"module"}\n');
    await symlink(
      join(process.cwd(), "node_modules"),
      join(installation, "node_modules"),
      "junction",
    );
    for (const area of ["calendar", "tasks", "operations", "launchd", "cli"])
      await mkdir(join(installation, "dist/test", area), { recursive: true });
    await writeFile(
      join(installation, "dist/test/calendar/domain.test.js"),
      'import { test } from "node:test"; test("domain", () => {});\n',
    );
    const journey = join(
      installation,
      "dist/test/cli/calendar-refresh-cli.test.js",
    );
    const original = await readFile(
      "dist/test/cli/calendar-refresh-cli.test.js",
      "utf8",
    );
    const assertion = 'assert.equal(report.outcome, "refreshed");';
    assert.ok(original.includes(assertion));
    await writeFile(
      journey,
      original.replace(
        assertion,
        'assert.equal(report.outcome, "private-workflow-sentinel");',
      ),
    );
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const run = (log: string) =>
      spawnSync(
        process.execPath,
        [
          join(installation, "dist/src/cli.js"),
          "capabilities",
          "verify",
          "--workflow",
          "services",
          "--json",
          "--log",
          join(fixture, log),
        ],
        {
          cwd: installation,
          env: environment,
          encoding: "utf8",
        },
      );
    const failed = run("failed.json");
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal(JSON.parse(failed.stdout).outcome, "failed");
    assert.ok(!failed.stdout.includes("private-workflow-sentinel"));
    assert.match(
      await readFile(join(fixture, "failed.json"), "utf8"),
      /private-workflow-sentinel/u,
    );
    await writeFile(journey, original);
    const retry = run("retry.json");
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    assert.equal(JSON.parse(retry.stdout).outcome, "passed");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
