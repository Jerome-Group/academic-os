import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { runCli, runCliWithEnvironment } from "../support/run-cli.js";
import {
  canonicalFixture,
  file,
  generationPath,
  headPath,
  identityPath,
  legacyFixture,
  moduleCode,
  sha,
} from "./fixtures.js";
import type { ControlObservation } from "../../src/controls/index.js";
import {
  controlFor,
  evidence,
  known,
  moduleDataControls,
  moduleDataFixture,
} from "./module-data-fixtures.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(files: ControlObservation[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aos-controls-")));
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
  it("validates a full candidate through the public CLI, exposes all controls and leaves every byte unchanged", async () => {
    const target = await fixture(moduleDataFixture());
    const before = await manifest(target.root);
    for (const command of ["inspect", "validate"]) {
      const result = await runCli(
        "module",
        command,
        "--root",
        target.moduleRoot,
        "--json",
      );
      assert.equal(result.exitCode, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(
        report.outcome,
        command === "validate" ? "validated-module-data" : "read",
      );
      assert.equal(report.coverage, "validated-module-data");
      assert.equal(report.controls.length, 18);
      assert.deepEqual(report.unsupportedReads, [
        "publication",
        "workflows",
        "module-conformance",
        "migration-readiness",
      ]);
      assert.deepEqual(report.diagnostics, []);
      assert.deepEqual(await manifest(target.root), before);
    }
    const configured = await runCli(
      "module",
      "validate",
      "--config",
      target.config,
      "--json",
    );
    assert.equal(configured.exitCode, 0, configured.stderr);
    assert.equal(
      JSON.parse(configured.stdout).coverage,
      "validated-module-data",
    );
    const audit = await runCli("audit", "--config", target.config, "--json");
    assert.equal(audit.exitCode, 2, audit.stderr);
    assert.equal(JSON.parse(audit.stdout).outcome, "unsupported-controls");
    assert.deepEqual(await manifest(target.root), before);
  });

  it("refuses contradictory native records and impossible dates through module validate without writes", async () => {
    for (const name of [
      "xattr-bytes",
      "xattr-duplicate",
      "link-bytes",
      "root-kind",
      "hardlink-data",
      "bundle-cycle",
      "date",
    ]) {
      const controls = moduleDataControls();
      const artifacts = controlFor(controls, "artifacts").artifacts;
      const artifact = artifacts[0];
      assert.ok(artifact);
      const entry = artifact.representation.entries[0];
      assert.ok(entry);
      let code = "invalid-control-schema";
      if (name === "xattr-bytes" || name === "xattr-duplicate") {
        const attribute = {
          nameBytesBase64:
            name === "xattr-bytes"
              ? "%%%not-base64"
              : Buffer.from("user.same").toString("base64"),
          valueSha256: "1".repeat(64),
          byteLength: 1,
        };
        entry.xattrs = {
          kind: "known",
          entries:
            name === "xattr-duplicate" ? [attribute, attribute] : [attribute],
          evidence: evidence(),
        };
        if (name === "xattr-duplicate") code = "duplicate-native-xattr-name";
      } else if (name === "link-bytes") {
        artifact.representation.kind = "symlink";
        entry.kind = "symlink";
        entry.symlinkTargetBytesBase64 = known(
          Buffer.from("a\0b").toString("base64"),
        );
      } else if (name === "root-kind") {
        artifact.representation.kind = "symlink";
        code = "conflicting-native-representation-root";
      } else if (name === "date") {
        const record = controlFor(controls, "learning-records").records[1];
        assert.ok(record?.kind === "current");
        record.date = known("2026-99-99");
      } else {
        const second = structuredClone(artifact);
        second.id = "artifact:second";
        second.path = "native-second";
        const other = second.representation.entries[0];
        assert.ok(other);
        other.pathBytesBase64 = Buffer.from(second.path).toString("base64");
        if (name === "bundle-cycle") {
          artifact.representation.kind = second.representation.kind =
            "native-bundle";
          entry.kind = other.kind = "directory";
          artifact.representation.bundleMembers = [
            { kind: "artifact", id: second.id },
          ];
          second.representation.bundleMembers = [
            { kind: "artifact", id: artifact.id },
          ];
          code = "native-bundle-cycle";
        } else {
          entry.hardlinkGroup = other.hardlinkGroup = known("inode-1");
          entry.data = known("1".repeat(64));
          other.data = known("2".repeat(64));
          code = "conflicting-native-hardlink";
        }
        artifacts.push(second);
      }
      const target = await fixture(moduleDataFixture(controls));
      const before = await manifest(target.root);
      const observed = await runCli(
        "module",
        "validate",
        "--root",
        target.moduleRoot,
        "--json",
      );
      assert.equal(observed.exitCode, 2, `${name}: ${observed.stderr}`);
      const report = JSON.parse(observed.stdout);
      assert.equal(report.outcome, "refused");
      assert.ok(
        report.diagnostics.some((item: { code: string }) => item.code === code),
        JSON.stringify(report.diagnostics),
      );
      assert.deepEqual(await manifest(target.root), before);
    }
  });

  it("refuses partial candidates and cross-unit targets through the same CLI owner without writes", async () => {
    const controls = moduleDataControls();
    const record = controlFor(controls, "learning-records").records[1];
    assert.ok(record?.kind === "current" && record.target.kind === "revision");
    record.target.topics = [
      { kind: "topic", id: "topic:c" },
      { kind: "topic", id: "topic:d" },
    ];
    for (const [files, code] of [
      [legacyFixture(), "full-module-data-required"],
      [canonicalFixture(), "full-module-data-required"],
      [moduleDataFixture(controls), "invalid-learning-target"],
    ] as const) {
      const target = await fixture([...files]);
      const before = await manifest(target.root);
      const result = await runCli(
        "module",
        "validate",
        "--root",
        target.moduleRoot,
        "--json",
      );
      assert.equal(result.exitCode, 2, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.outcome, "refused");
      assert.ok(
        report.diagnostics.some((item: { code: string }) => item.code === code),
      );
      assert.deepEqual(await manifest(target.root), before);
    }
  });
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

  it("reads every supported generation reference filename through portable and configured routes", async () => {
    for (const identityFile of [
      "identity",
      "identity.JSON",
      "nested/identity.data",
    ]) {
      const target = await fixture(canonicalFixture({ identityFile }));
      const before = await manifest(target.root);
      for (const route of [
        ["--root", target.moduleRoot],
        ["--config", target.config],
      ]) {
        const result = await runCli("module", "inspect", ...route, "--json");
        assert.equal(result.exitCode, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.kind, "canonical");
        assert.equal(
          report.controls[0].path,
          `.academic-os/control-generations/g1/${identityFile}`,
        );
        assert.deepEqual(report.diagnostics, []);
      }
      assert.deepEqual(await manifest(target.root), before);
    }
  });

  it("refuses a parent-directory swap before opening a canonical reference without reporting outside bytes", async () => {
    const outsideTitle = "Outside content must never enter the observation";
    const files = canonicalFixture({ identity: { title: outsideTitle } });
    const identity = files.find((item) => item.path === identityPath);
    const generation = files.find((item) => item.path === generationPath);
    assert.ok(identity && generation);
    const target = await fixture(
      files.map((item) =>
        item.path === identityPath ? file(identityPath, "{}") : item,
      ),
    );
    const outside = join(target.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "identity.json"), identity.bytes);
    await writeFile(join(outside, "generation.json"), generation.bytes);
    const beforeOutside = await manifest(outside);
    const generationRoot = dirname(join(target.moduleRoot, identityPath));
    const preload = join(target.root, "swap-before-open.mjs");
    const swapReceipt = join(target.root, "swap-performed.txt");
    await writeFile(
      preload,
      `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const open = fs.promises.open;
let swapped = false;
fs.promises.open = async function(path, ...args) {
  if (path === ${JSON.stringify(join(target.moduleRoot, identityPath))} && !swapped) {
    swapped = true;
    await fs.promises.rename(${JSON.stringify(generationRoot)}, ${JSON.stringify(`${generationRoot}-retained`)});
    await fs.promises.symlink(${JSON.stringify(outside)}, ${JSON.stringify(generationRoot)});
    await fs.promises.writeFile(${JSON.stringify(swapReceipt)}, "swapped");
  }
  return open.call(this, path, ...args);
};
syncBuiltinESMExports();
`,
    );
    const result = await runCliWithEnvironment(
      { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
      "module",
      "inspect",
      "--root",
      target.moduleRoot,
      "--json",
    );
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(await readFile(swapReceipt, "utf8"), "swapped");
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "unsupported");
    assert.ok(
      report.diagnostics.some(
        (item: { code: string }) =>
          item.code === "unreadable-canonical-control",
      ),
    );
    assert.equal(
      report.evidence.some(
        (item: { path: string }) => item.path === identityPath,
      ),
      false,
    );
    assert.equal(result.stdout.includes(outsideTitle), false);
    assert.deepEqual(await manifest(outside), beforeOutside);
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
