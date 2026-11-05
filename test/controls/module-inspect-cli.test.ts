import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { runCli } from "../support/run-cli.js";
import {
  canonicalFixture,
  file,
  generationPath,
  headPath,
  legacyFixture,
  moduleCode,
  sha,
} from "./fixtures.js";
import type { ControlObservation } from "../../src/controls/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(files: ControlObservation[]) {
  const root = await mkdtemp(join(tmpdir(), "aos-controls-"));
  roots.push(root);
  const moduleRoot = join(root, "Drive", "Modules", "Y1S1", moduleCode);
  const stateRoot = join(root, "State");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot);
  for (const observation of files)
    if (observation.kind === "file") {
      const path = join(moduleRoot, observation.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, observation.bytes);
    }
  const config = join(root, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      driveMount: join(root, "Drive"),
      stateRoot,
      semester: "Y1S1",
      module: moduleCode,
      semesterRoots: { Y1S1: "Modules/Y1S1" },
    }),
  );
  return { root, moduleRoot, config };
}
async function manifest(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(
    paths.map(async (path) => ({ path, sha256: sha(await readFile(path)) })),
  );
}

describe("read-only module inspection through the compiled CLI", () => {
  it("reads portable legacy controls and exact fingerprints without writing files or state", async () => {
    const target = await fixture(legacyFixture());
    const before = await manifest(target.root);
    const result = await runCli(
      ...["module", "inspect", "--root", target.moduleRoot, "--json"],
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "legacy");
    assert.equal(report.outcome, "read");
    assert.deepEqual(
      report.sourceMap.units.map((unit: { unit: string }) => unit.unit),
      ["10", "2"],
    );
    assert.equal(report.records[0].target.kind, "unknown");
    assert.deepEqual(await manifest(target.root), before);
  });

  it("reads a configured canonical envelope with incomplete coverage and refuses full audit without writes", async () => {
    const target = await fixture([...legacyFixture(), ...canonicalFixture()]);
    const before = await manifest(target.root);
    const result = await runCli(
      ...["module", "inspect", "--config", target.config, "--json"],
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "canonical");
    assert.equal(report.coverage, "incomplete-module-contract");
    assert.equal(report.controls[0].role, "module-identity");
    assert.equal(report.evidence.length, 11);
    const audit = await runCli(
      ...["audit", "--config", target.config, "--json"],
    );
    assert.equal(audit.exitCode, 2, audit.stderr);
    const refusal = JSON.parse(audit.stdout);
    assert.equal(refusal.outcome, "unsupported-controls");
    assert.equal(refusal.controlShape.kind, "canonical");
    assert.match(refusal.remediation, /module inspect/u);
    assert.deepEqual(await manifest(target.root), before);
  });

  it("refuses a missing generation and a changed generation through public commands without legacy fallback", async () => {
    for (const files of [
      canonicalFixture().filter((file) => file.path !== generationPath),
      canonicalFixture().map((item) =>
        item.path === generationPath ? file(generationPath, "{}\n") : item,
      ),
    ]) {
      const target = await fixture([...legacyFixture(), ...files]);
      const before = await manifest(target.root);
      const result = await runCli(
        ...["module", "inspect", "--root", target.moduleRoot, "--json"],
      );
      assert.equal(result.exitCode, 2, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.kind, "unsupported");
      assert.equal(report.outcome, "refused");
      assert.ok(
        report.diagnostics.some((diagnostic: { code: string }) =>
          ["missing-canonical-reference", "canonical-hash-mismatch"].includes(
            diagnostic.code,
          ),
        ),
      );
      assert.deepEqual(await manifest(target.root), before);
    }
  });

  it("refuses a symlinked canonical head without reading its target", async () => {
    const target = await fixture(legacyFixture());
    const outside = join(target.root, "outside.json");
    await writeFile(outside, "must remain unread\n");
    await symlink(outside, join(target.moduleRoot, headPath));
    const before = await manifest(target.root);
    const result = await runCli(
      ...["module", "inspect", "--root", target.moduleRoot, "--json"],
    );
    assert.equal(result.exitCode, 2);
    const report = JSON.parse(result.stdout);
    assert.ok(
      report.diagnostics.some(
        (diagnostic: { code: string }) =>
          diagnostic.code === "unreadable-canonical-control",
      ),
    );
    assert.deepEqual(await manifest(target.root), before);
  });
});
