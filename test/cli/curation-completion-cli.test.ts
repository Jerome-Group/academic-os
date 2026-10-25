import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

import { md5Bytes, sha256Bytes } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import { runCli } from "../support/run-cli.js";

const sourceBytes = "Synthetic source bytes.\n";
const sourceDigest = sha256Bytes(Buffer.from(sourceBytes));
const registerPath = writtenControlPaths.curationRegister;
const module = "AA9999";

type Command = "migrate" | "rederive";
type Discrepancy = "changed" | "missing-source" | "unprovable";

async function write(root: string, path: string, contents: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

function lines(command: Command, name: string, checksum?: string): string {
  const event = {
    schema_version: 3,
    source_id: command === "migrate" ? `drive-${name}` : `${name}.pdf`,
    integration: "ntulearn",
    role: "handout",
    source_path: `${name}.pdf`,
    checksum:
      checksum ??
      (command === "migrate"
        ? `md5:${md5Bytes(Buffer.from(sourceBytes))}`
        : sourceDigest),
    decision: "curated",
    destination: `10 Learning Materials/${name}-copy.pdf`,
    evidence: "Synthetic curation decision.",
    timestamp: "2026-01-04T02:00:00.000Z",
  };
  return `${JSON.stringify(event)}\n${
    command === "migrate"
      ? ""
      : `${JSON.stringify({
          ...event,
          destination: `10 Learning Materials/${name}-cut.pdf`,
        })}\n`
  }`;
}

async function fixture(command: Command) {
  const root = await mkdtemp(
    join(tmpdir(), "academic-os-curation-completion-"),
  );
  const moduleRoot = join(root, "Drive", "Modules", "Y9S9", module);
  const stateRoot = join(root, "state");
  await mkdir(stateRoot);
  await write(
    moduleRoot,
    writtenControlPaths.definition,
    "sources:\n  ntulearn:\n    - {role: primary, destination: NTULearn, evidence: [synthetic]}\n",
  );
  const configPath = await write(
    root,
    "config.json",
    JSON.stringify({
      driveMount: join(root, "Drive"),
      stateRoot,
      activeSemester: "Y9S9",
      semesters: {
        Y9S9: { root: "Modules/Y9S9", status: "active", modules: [module] },
      },
    }),
  );
  async function item(name: string, discrepancy?: Discrepancy) {
    if (discrepancy !== "missing-source")
      await write(
        moduleRoot,
        `NTULearn/${name}.pdf`,
        discrepancy === "changed"
          ? "Reissued synthetic source.\n"
          : sourceBytes,
      );
    await write(
      moduleRoot,
      `10 Learning Materials/${name}-copy.pdf`,
      sourceBytes,
    );
    await write(
      moduleRoot,
      `10 Learning Materials/${name}-cut.pdf`,
      "One cut.\n",
    );
    return lines(
      command,
      name,
      discrepancy === "unprovable" ? "unknown" : undefined,
    );
  }
  return { root, moduleRoot, stateRoot, configPath, item };
}

async function inventory(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(root, path)] = sha256Bytes(await readFile(path));
  }
  return files;
}

for (const command of ["migrate", "rederive"] as const) {
  const complete = command === "migrate" ? "contract-v4" : "settled";
  const pending = command === "migrate" ? "migrating" : "rederiving";
  const falseCompletion =
    /Every register line an arrival walk can meet already carries|No standing batch records one source/u;

  for (const discrepancy of [
    "changed",
    "missing-source",
    "unprovable",
  ] as const) {
    test(`curation ${command} keeps ${discrepancy} unresolved in preview and apply`, async (t) => {
      const f = await fixture(command);
      t.after(() => rm(f.root, { recursive: true }));
      await write(
        f.moduleRoot,
        registerPath,
        await f.item("unresolved", discrepancy),
      );
      const before = await inventory(f.root);

      for (const mode of [[], ["--apply"]]) {
        const args = ["curation", command, "--config", f.configPath, ...mode];
        const json = await runCli(...args, "--json");
        assert.equal(json.exitCode, 3, JSON.stringify(json));
        const report = JSON.parse(json.stdout);
        assert.equal(report.outcome, "unresolved");
        assert.equal(report.counts[discrepancy], 1);
        assert.equal(report.counts[pending], 0);
        assert.equal(report.appended, 0);
        const human = await runCli(...args);
        assert.equal(human.exitCode, 3, JSON.stringify(human));
        assert.match(human.stdout, /unresolved \((preview|apply)\)/u);
        assert.doesNotMatch(human.stdout, falseCompletion);
        assert.deepEqual(await inventory(f.root), before);
      }
    });
  }

  for (const blocker of ["malformed", "unreadable"] as const) {
    for (const automatic of [false, true]) {
      test(`curation ${command} reports ${blocker} cohort as blocked with automatic=${automatic}`, async (t) => {
        const f = await fixture(command);
        t.after(() => rm(f.root, { recursive: true }));
        const prefix = automatic ? await f.item("safe") : "";
        await write(f.moduleRoot, registerPath, prefix);
        if (blocker === "malformed") {
          const other = join(dirname(f.moduleRoot), "AA9998");
          await write(other, registerPath, "not-json\n");
        }
        const config = JSON.parse(await readFile(f.configPath, "utf8"));
        config.semesters.Y9S9.modules.push("AA9998");
        await writeFile(f.configPath, JSON.stringify(config));
        const before = await inventory(f.root);
        for (const json of [false, true]) {
          const result = await runCli(
            "curation",
            command,
            "--config",
            f.configPath,
            ...(json ? ["--json"] : []),
          );
          assert.equal(result.exitCode, 2, JSON.stringify(result));
          if (json) assert.equal(JSON.parse(result.stdout).outcome, "blocked");
          else {
            assert.match(result.stdout, /blocked \(preview\)/u);
            assert.doesNotMatch(result.stdout, falseCompletion);
          }
          assert.deepEqual(await inventory(f.root), before);
        }
        const result = await runCli(
          "curation",
          command,
          "--config",
          f.configPath,
          "--apply",
          "--json",
        );
        assert.equal(result.exitCode, 2, JSON.stringify(result));
        const report = JSON.parse(result.stdout);
        assert.equal(report.outcome, "blocked");
        assert.equal(report.appended, automatic ? 1 : 0);
        const after = await readFile(join(f.moduleRoot, registerPath), "utf8");
        assert.ok(after.startsWith(prefix));
        assert.equal(
          after.split("\n").filter(Boolean).length,
          prefix.split("\n").filter(Boolean).length + (automatic ? 1 : 0),
        );
        const applied = await inventory(f.root);
        const human = await runCli(
          "curation",
          command,
          "--config",
          f.configPath,
          "--apply",
        );
        assert.equal(human.exitCode, 2, JSON.stringify(human));
        assert.doesNotMatch(human.stdout, falseCompletion);
        assert.deepEqual(await inventory(f.root), applied);
      });
    }
  }

  for (const unresolved of [false, true]) {
    test(`curation ${command} applies safe work and retains completion evidence with unresolved=${unresolved}`, async (t) => {
      const f = await fixture(command);
      t.after(() => rm(f.root, { recursive: true }));
      const prefix = `${await f.item("safe")}${unresolved ? await f.item("unresolved", "changed") : ""}`;
      await write(f.moduleRoot, registerPath, prefix);
      const before = await inventory(f.root);
      const preview = await runCli(
        "curation",
        command,
        "--config",
        f.configPath,
        "--json",
      );
      assert.equal(preview.exitCode, 1, JSON.stringify(preview));
      assert.equal(
        JSON.parse(preview.stdout).outcome,
        unresolved ? "unresolved" : command === "migrate" ? "legacy" : "split",
      );
      assert.deepEqual(await inventory(f.root), before);
      const applied = await runCli(
        "curation",
        command,
        "--config",
        f.configPath,
        "--apply",
        "--json",
      );
      assert.equal(
        applied.exitCode,
        unresolved ? 3 : 0,
        JSON.stringify(applied),
      );
      const report = JSON.parse(applied.stdout);
      assert.equal(report.outcome, unresolved ? "unresolved" : complete);
      assert.equal(report.appended, 1);
      assert.equal(report.counts[pending], 0);
      const register = await readFile(join(f.moduleRoot, registerPath), "utf8");
      assert.ok(register.startsWith(prefix));
      assert.equal(
        register.split("\n").filter(Boolean).length,
        prefix.split("\n").filter(Boolean).length + 1,
      );
      assert.equal(
        JSON.parse(register.trim().split("\n").at(-1) ?? "").source_id,
        "safe.pdf",
      );
      for (const [path, digest] of Object.entries(before)) {
        if (path.endsWith(registerPath)) continue;
        assert.equal(
          sha256Bytes(await readFile(join(f.root, path))),
          digest,
          path,
        );
      }
      assert.ok(report.journal);
      assert.match(
        await readFile(report.journal, "utf8"),
        /"outcome":"appended"/u,
      );
      const after = await inventory(f.root);
      const repeat = await runCli(
        "curation",
        command,
        "--config",
        f.configPath,
        "--apply",
        "--json",
      );
      assert.equal(repeat.exitCode, unresolved ? 3 : 0, JSON.stringify(repeat));
      assert.equal(
        JSON.parse(repeat.stdout).outcome,
        unresolved ? "unresolved" : complete,
      );
      assert.equal(JSON.parse(repeat.stdout).appended, 0);
      assert.deepEqual(await inventory(f.root), after);
      const human = await runCli("curation", command, "--config", f.configPath);
      assert.equal(human.exitCode, unresolved ? 3 : 0, JSON.stringify(human));
      if (unresolved) assert.doesNotMatch(human.stdout, falseCompletion);
      else assert.match(human.stdout, falseCompletion);
    });
  }
}
