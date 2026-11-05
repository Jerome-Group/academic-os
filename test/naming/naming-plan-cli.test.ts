import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { resolveArtifactNames } from "../../src/naming/index.js";
import { runCliWithEnvironment } from "../support/run-cli.js";
import { artifact, request } from "./fixtures.js";

it("drives the compiled naming CLI with locale-independent bytes and no fixture writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "aos-naming-cli-"));
  const inputPath = join(root, "accepted.json");
  const input = request([artifact({ titleTokens: ["École"] })]);
  await writeFile(inputPath, JSON.stringify(input));
  const before = await readFile(inputPath);
  const first = await runCliWithEnvironment(
    { LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Auckland" },
    "naming",
    "plan",
    "--input",
    inputPath,
    "--json",
  );
  const second = await runCliWithEnvironment(
    { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "America/New_York" },
    "naming",
    "plan",
    "--input",
    inputPath,
    "--json",
  );
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), resolveArtifactNames(input));
  assert.deepEqual(await readFile(inputPath), before);
  assert.deepEqual(await readdir(root), ["accepted.json"]);
});

it("exposes unresolved and refused plans through actual CLI exit and structured outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "aos-naming-refusal-"));
  const inputPath = join(root, "accepted.json");
  await writeFile(
    inputPath,
    JSON.stringify(request([artifact(), artifact({ id: "artifact:second" })])),
  );
  const collision = await runCliWithEnvironment(
    {},
    "naming",
    "plan",
    "--input",
    inputPath,
    "--json",
  );
  assert.equal(collision.exitCode, 2);
  assert.equal(JSON.parse(collision.stdout).outcome, "unresolved");
  await writeFile(inputPath, '{"schemaVersion":1,"schemaVersion":2}');
  const refused = await runCliWithEnvironment(
    {},
    "naming",
    "plan",
    "--input",
    inputPath,
    "--json",
  );
  assert.equal(refused.exitCode, 2);
  assert.equal(JSON.parse(refused.stdout).outcome, "refused");
  const flags = await runCliWithEnvironment(
    {},
    "naming",
    "plan",
    "--input",
    inputPath,
    "--input",
    inputPath,
    "--json",
  );
  assert.equal(flags.exitCode, 2);
});
