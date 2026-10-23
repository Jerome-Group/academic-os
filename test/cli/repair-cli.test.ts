import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRepairPlan } from "../../src/repair/index.js";
import { repairPlanDraft } from "../repair/fixtures.js";
import { runCliWithEnvironment } from "../support/run-cli.js";

test("compiled repair CLI previews equivalent versioned JSON and human reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-repair-cli-"));
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const snapshotRoot = join(root, "Snapshot");
  const moduleRoot = join(driveMount, "Modules", "Y9S9", "ZZ9999");
  await mkdir(join(moduleRoot, "001 Source Material"), { recursive: true });
  await Promise.all([mkdir(stateRoot), mkdir(snapshotRoot)]);
  await writeFile(
    join(moduleRoot, "001 Source Material", "ZZ9999 Source A.pdf"),
    "Drive-backed placeholder",
  );
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y9S9",
      semesters: {
        Y9S9: { root: "Modules/Y9S9", status: "active", modules: ["ZZ9999"] },
      },
      driveApi: { moduleFolderIds: { Y9S9: { ZZ9999: "module-id" } } },
      repair: { driveRecoveryRootId: "recovery-root", snapshotRoot },
    }),
  );
  const planPath = join(root, "approved.repair-plan.json");
  await writeFile(
    planPath,
    JSON.stringify(createRepairPlan(repairPlanDraft())),
  );
  const preload = new URL(
    "../support/fake-repair-drive-preload.js",
    import.meta.url,
  ).href;
  const environment = { NODE_OPTIONS: `--import=${preload}` };

  const json = await runCliWithEnvironment(
    environment,
    "repair",
    "--config",
    configPath,
    "--plan",
    planPath,
    "--json",
  );
  const human = await runCliWithEnvironment(
    environment,
    "repair",
    "--config",
    configPath,
    "--plan",
    planPath,
  );

  assert.equal(json.exitCode, 0, `${json.stdout}\n${json.stderr}`);
  assert.equal(human.exitCode, 0, `${human.stdout}\n${human.stderr}`);
  const report = JSON.parse(json.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.outcome, "preview");
  for (const operationId of report.remainingOperations) {
    assert.match(human.stdout, new RegExp(operationId, "u"));
  }
  assert.match(human.stdout, /Outcome: preview/u);
  assert.deepEqual(await readdir(stateRoot), []);
});

for (const kind of ["ordinary", "two-dot", "alias", "outside"] as const) {
  test(`compiled repair snapshot containment checks ${kind} before provider reads`, async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-repair-snapshot-"));
    const driveMount = join(root, "Drive");
    const stateRoot = join(root, "State");
    const moduleRoot = join(driveMount, "Modules", "Y9S9", "ZZ9999");
    await mkdir(join(moduleRoot, "001 Source Material"), { recursive: true });
    await mkdir(stateRoot);
    await writeFile(
      join(moduleRoot, "001 Source Material", "ZZ9999 Source A.pdf"),
      "Drive-backed placeholder",
    );
    const inside = join(
      driveMount,
      kind === "ordinary" ? "Snapshot" : "..snapshot",
    );
    const outside = join(root, "Snapshot");
    await mkdir(inside);
    await mkdir(outside);
    const alias = join(root, "snapshot-alias");
    await symlink(inside, alias);
    const snapshotRoot =
      kind === "outside" ? outside : kind === "alias" ? alias : inside;
    const configPath = join(root, "config.json");
    const planPath = join(root, "plan.json");
    await writeFile(
      configPath,
      JSON.stringify({
        driveMount,
        stateRoot,
        activeSemester: "Y9S9",
        semesters: {
          Y9S9: { root: "Modules/Y9S9", status: "active", modules: ["ZZ9999"] },
        },
        driveApi: { moduleFolderIds: { Y9S9: { ZZ9999: "module-id" } } },
        repair: { driveRecoveryRootId: "recovery-root", snapshotRoot },
      }),
    );
    await writeFile(
      planPath,
      JSON.stringify(createRepairPlan(repairPlanDraft())),
    );
    const calls = join(root, "provider-calls.jsonl");
    await writeFile(calls, "");
    const preload = join(root, "count-provider.mjs");
    await writeFile(
      preload,
      `
      import { appendFile } from "node:fs/promises";
      await import(${JSON.stringify(new URL("../support/fake-repair-drive-preload.js", import.meta.url).href)});
      const { GoogleAuth } = await import(${JSON.stringify(import.meta.resolve("google-auth-library"))});
      const request = GoogleAuth.prototype.request;
      GoogleAuth.prototype.request = async function(options) {
        await appendFile(${JSON.stringify(calls)}, JSON.stringify(options) + "\\n");
        return request.call(this, options);
      };
    `,
    );
    const result = await runCliWithEnvironment(
      { NODE_OPTIONS: `--import=${preload}` },
      "repair",
      "--config",
      configPath,
      "--plan",
      planPath,
      "--json",
    );
    const report = JSON.parse(result.stdout);
    const requests = (await readFile(calls, "utf8")).trim();
    if (kind === "outside") {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(report.outcome, "preview");
      assert.notEqual(requests, "");
    } else {
      assert.equal(result.exitCode, 2, `${result.stdout}\n${result.stderr}`);
      assert.equal(report.error.code, "out-of-root");
      assert.equal(requests, "");
    }
    assert.deepEqual(await readdir(stateRoot), []);
    assert.deepEqual(await readdir(inside), []);
    assert.deepEqual(await readdir(outside), []);
  });
}
