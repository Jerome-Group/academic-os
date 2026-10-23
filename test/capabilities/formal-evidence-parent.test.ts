import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("../../../.agents/skills/seed-ownership/run.mjs", import.meta.url),
);
const repository = fileURLToPath(new URL("../../../", import.meta.url));

test("formal runner admits an ordinary two-dot temporary child before tool startup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "..academic-formal-admission-"));
  try {
    const result = run(parent);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const children = await readdir(parent);
    assert.equal(children.length, 1, result.stdout + result.stderr);
    assert.match(children[0] ?? "", /^seed-ownership-/u);
    const record: unknown = JSON.parse(
      await readFile(join(parent, children[0] ?? "", "results.json"), "utf8"),
    );
    assert.ok(record !== null && typeof record === "object");
    assert.ok("outcome" in record && record.outcome === "failed");
    assert.ok("models" in record);
    assert.deepEqual(record.models, []);
    assert.ok("error" in record && typeof record.error === "string");
    assert.match(record.error, /not-installed-java/u);
    assert.match(result.stdout, /Evidence /u);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("formal runner refuses an actual parent traversal before allocating evidence", async () => {
  const outside = dirname(await realpath("/tmp"));
  const before = await readdir(outside);
  const result = run(outside);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /evidence stays in an OS temporary directory/u);
  assert.doesNotMatch(result.stdout, /Evidence /u);
  const after = await readdir(outside);
  assert.deepEqual(
    after.filter((name) => name.startsWith("seed-ownership-")),
    before.filter((name) => name.startsWith("seed-ownership-")),
  );
});

function run(parent: string) {
  return spawnSync(
    process.execPath,
    [
      runner,
      "--product-root",
      repository,
      "--candidate-revision",
      "0".repeat(40),
      "--evidence-parent",
      parent,
    ],
    {
      cwd: repository,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        JAVA: join(parent, "not-installed-java"),
      },
    },
  );
}
