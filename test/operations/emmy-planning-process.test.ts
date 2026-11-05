import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  createEmmyPlanningProcess,
  type EmmyPlanningProcessResult,
} from "../../src/operations/emmy-planning-process.js";
import { isJsonObject } from "../../src/operations/json-object.js";
import { emmyPlanningTestSources } from "../support/emmy-planning-source.js";

function reported(result: EmmyPlanningProcessResult, status: string) {
  assert.equal(result.kind, "reported");
  if (result.kind !== "reported") throw new Error("Expected producer report.");
  assert.equal(result.data.status, status);
  return result.data;
}

test("pinned real Emmy subprocess publishes, discovers, acquires and revalidates synthetic authority", async () => {
  const { releasePath, fixturesPath, sourceCommit, manifestSha256 } =
    await emmyPlanningTestSources();
  const scratch = await realpath(
    await mkdtemp(join(tmpdir(), "aos-emmy-process-")),
  );
  try {
    const releaseRoot = join(scratch, "release");
    const privateRoot = join(scratch, "private");
    await cp(releasePath, releaseRoot, { recursive: true });
    await mkdir(privateRoot, { mode: 0o700 });
    await chmod(scratch, 0o700);
    const adapter = createEmmyPlanningProcess({
      releaseRoot,
      privateRoot,
      manifestSha256,
      sourceCommit,
    });
    const fixtureModule: unknown = await import(
      pathToFileURL(
        join(fixturesPath, "verification/academic-os-planning-fixtures.mjs"),
      ).href
    );
    assert.ok(
      isJsonObject(fixtureModule) &&
        typeof fixtureModule.academicOsPlanningFixture === "function",
    );
    const fixture: unknown = fixtureModule.academicOsPlanningFixture();
    assert.ok(
      isJsonObject(fixture) &&
        isJsonObject(fixture.request) &&
        isJsonObject(fixture.catalogInput) &&
        isJsonObject(fixture.observation),
    );
    const catalog = reported(
      await adapter.run({
        schemaVersion: 1,
        stage: "publish",
        catalog: fixture.catalogInput,
      }),
      "planning-catalog-ready",
    ).catalog;
    reported(
      await adapter.run({ schemaVersion: 1, stage: "validate", catalog }),
      "planning-catalog-valid",
    );
    const selector = {
      target: fixture.request.target,
      listId: fixture.request.listId,
      taskId: fixture.request.taskId,
    };
    reported(
      await adapter.run({
        schemaVersion: 1,
        stage: "discover",
        catalog,
        selector,
      }),
      "planning-authorizations-discovered",
    );
    const acquired = reported(
      await adapter.run({
        schemaVersion: 1,
        stage: "acquire",
        catalog,
        request: fixture.request,
        observation: fixture.observation,
      }),
      "api-plan-ready-reported",
    );
    reported(
      await adapter.run({
        schemaVersion: 1,
        stage: "revalidate",
        catalog,
        prepared: acquired.prepared,
        observation: fixture.observation,
      }),
      "api-plan-current-reported",
    );
    assert.deepEqual(
      await adapter.run({
        schemaVersion: 1,
        stage: "acquire",
        catalog,
        request: fixture.request,
        observation: {
          ...fixture.observation,
          policy: fixture.catalogInput.policy,
        },
      }),
      { kind: "refused", code: "producer-rejected" },
    );
    assert.deepEqual(
      await adapter.run({ schemaVersion: 1, stage: "validate", catalog: {} }),
      { kind: "refused", code: "producer-rejected" },
    );
    const expired: unknown = fixtureModule.academicOsPlanningFixture(
      new Date(Date.now() - 120_000).toISOString(),
    );
    assert.ok(isJsonObject(expired));
    assert.deepEqual(
      await adapter.run({
        schemaVersion: 1,
        stage: "publish",
        catalog: expired.catalogInput,
      }),
      { kind: "refused", code: "producer-rejected" },
    );
    assert.deepEqual(await readdir(privateRoot), []);
    await writeFile(
      join(releaseRoot, "src/academic-os-planning.mjs"),
      "throw new Error('corrupt bundle');",
    );
    assert.deepEqual(
      await adapter.run({ schemaVersion: 1, stage: "validate", catalog }),
      { kind: "refused", code: "producer-unavailable" },
    );
    assert.deepEqual(await readdir(privateRoot), []);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("test producer source defaults and explicit overrides resolve the same reviewed bundle", async () => {
  const bundled = await emmyPlanningTestSources({});
  const explicit = await emmyPlanningTestSources({
    ACADEMIC_OS_TEST_EMMY_RELEASE: bundled.releasePath,
    ACADEMIC_OS_TEST_EMMY_FIXTURES: bundled.fixturesPath,
  });
  assert.deepEqual(explicit, bundled);
});

test("missing or changed producer test inputs fail instead of skipping", async (t) => {
  const bundled = await emmyPlanningTestSources({});
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aos-emmy-inputs-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    emmyPlanningTestSources({
      ACADEMIC_OS_TEST_EMMY_RELEASE: join(root, "missing"),
    }),
  );
  const releaseRoot = join(root, "release");
  await cp(bundled.releasePath, releaseRoot, { recursive: true });
  await writeFile(join(releaseRoot, "planning-source-manifest.json"), "{}\n");
  await assert.rejects(
    emmyPlanningTestSources({ ACADEMIC_OS_TEST_EMMY_RELEASE: releaseRoot }),
    /does not match its pin/u,
  );
  await assert.rejects(
    emmyPlanningTestSources({ ACADEMIC_OS_TEST_EMMY_FIXTURES: root }),
  );
  await cp(bundled.fixturesPath, join(root, "fixtures"), { recursive: true });
  await writeFile(
    join(root, "fixtures/verification/academic-os-plan-fixtures.mjs"),
    "export const changed = true;\n",
  );
  await assert.rejects(
    emmyPlanningTestSources({
      ACADEMIC_OS_TEST_EMMY_FIXTURES: join(root, "fixtures"),
    }),
    /does not match its pin/u,
  );
});

async function scopedProducer(script: string) {
  const scratch = await realpath(
    await mkdtemp(join(tmpdir(), "aos-emmy-fault-")),
  );
  const releaseRoot = join(scratch, "release");
  const privateRoot = join(scratch, "private");
  await mkdir(join(releaseRoot, "scripts"), { recursive: true, mode: 0o700 });
  await mkdir(privateRoot, { mode: 0o700 });
  const entry = "scripts/academic-os-planning.mjs";
  await writeFile(join(releaseRoot, entry), script, { mode: 0o600 });
  const sourceCommit = "0".repeat(40);
  const manifest = JSON.stringify({
    schemaVersion: 1,
    kind: "emmy-academic-planning-compact-runtime",
    sourceCommit,
    entrypoint: entry,
    files: {
      [entry]: {
        bytes: Buffer.byteLength(script),
        sha256: createHash("sha256").update(script).digest("hex"),
      },
    },
  });
  await writeFile(
    join(releaseRoot, "planning-source-manifest.json"),
    manifest,
    { mode: 0o600 },
  );
  const configuration = {
    releaseRoot,
    privateRoot,
    sourceCommit,
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
  };
  return {
    scratch,
    configuration,
    adapter: createEmmyPlanningProcess(configuration),
  };
}

const emptyValidation = {
  schemaVersion: 1,
  stage: "validate",
  catalog: {},
} satisfies Parameters<ReturnType<typeof createEmmyPlanningProcess>["run"]>[0];

test("private cleanup failure returns explicit refusal and retains residue", async () => {
  const fixture = await scopedProducer(
    `import { chmodSync } from 'node:fs'; chmodSync(process.cwd(), 0o500); process.stdout.write(JSON.stringify({ok:true,command:'calendar-register',data:{schemaVersion:1,status:'planning-catalog-valid',execution:'none'}}));`,
  );
  try {
    assert.deepEqual(await fixture.adapter.run(emptyValidation), {
      kind: "refused",
      code: "producer-cleanup-failed",
    });
    const residue = await readdir(fixture.configuration.privateRoot);
    assert.equal(residue.length, 1);
    for (const entry of residue)
      await chmod(join(fixture.configuration.privateRoot, entry), 0o700);
  } finally {
    await rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("malformed producer output fails closed", async () => {
  const fixture = await scopedProducer(`process.stdout.write('not-json');`);
  try {
    assert.deepEqual(await fixture.adapter.run(emptyValidation), {
      kind: "refused",
      code: "producer-protocol-invalid",
    });
    assert.deepEqual(await readdir(fixture.configuration.privateRoot), []);
  } finally {
    await rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("symlinked release and permissive private root are rejected", async () => {
  const fixture = await scopedProducer(`process.stdout.write('must not run');`);
  try {
    const alias = join(fixture.scratch, "alias");
    await symlink(fixture.configuration.releaseRoot, alias);
    assert.deepEqual(
      await createEmmyPlanningProcess({
        ...fixture.configuration,
        releaseRoot: alias,
      }).run(emptyValidation),
      { kind: "refused", code: "producer-unavailable" },
    );
    await chmod(fixture.configuration.privateRoot, 0o755);
    assert.deepEqual(await fixture.adapter.run(emptyValidation), {
      kind: "refused",
      code: "producer-unavailable",
    });
    assert.deepEqual(await readdir(fixture.configuration.privateRoot), []);
  } finally {
    await rm(fixture.scratch, { recursive: true, force: true });
  }
});

test("hanging producer is killed within the fixed deadline and cleaned", {
  timeout: 15_000,
}, async () => {
  const fixture = await scopedProducer(`setInterval(() => {}, 1000);`);
  try {
    assert.deepEqual(await fixture.adapter.run(emptyValidation), {
      kind: "refused",
      code: "producer-unavailable",
    });
    assert.deepEqual(await readdir(fixture.configuration.privateRoot), []);
  } finally {
    await rm(fixture.scratch, { recursive: true, force: true });
  }
});
