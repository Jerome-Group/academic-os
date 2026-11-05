import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { runCli } from "../support/run-cli.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aos-config-"));
  roots.push(root);
  const moduleRoot = join(root, "Drive", "Modules", "Y2S1", "MH2100");
  const stateRoot = join(root, "State");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot);
  const path = join(root, "config.json");
  const config = {
    driveMount: join(root, "Drive"),
    stateRoot,
    semester: "Y2S1",
    module: "MH2100",
    semesterRoots: { Y2S1: "Modules/Y2S1" },
  };
  return { root, moduleRoot, stateRoot, path, config };
}
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("configuration through actual compiled CLI routes", () => {
  it("validates the Calendar wizard candidate before replacement and preserves the source on failure", async () => {
    const target = await fixture();
    const script = await readFile(
      new URL("../../../scripts/setup-calendar-local.sh", import.meta.url),
      "utf8",
    );
    const functions = script.slice(
      script.indexOf("write_private_config() {"),
      script.indexOf('stage "Check private inputs"'),
    );
    assert.match(functions, /run_cli config validate/u);
    const source = JSON.stringify({
      driveMount: target.config.driveMount,
      stateRoot: target.stateRoot,
    });
    await writeFile(target.path, source);
    const environment = {
      ...process.env,
      REPO_ROOT: process.cwd(),
      CONFIG_PATH: target.path,
      SECRETS_DIR: target.root,
      READ_CREDENTIAL_PATH: join(target.root, "read"),
      WRITE_CREDENTIAL_PATH: join(target.root, "write"),
    };
    const run = (horizon: string) =>
      promisify(execFile)(
        "bash",
        [
          "-c",
          `set -euo pipefail\n${functions}\nwrite_private_config "$1"`,
          "config-fixture",
          horizon,
        ],
        { env: environment },
      );
    await assert.rejects(run("invalid-date"));
    assert.equal(await readFile(target.path, "utf8"), source);
    assert.equal(
      (await readdir(target.root)).some((name) =>
        name.startsWith("academic-os.config.json."),
      ),
      false,
    );
    await run("2026-08-01T00:00:00+08:00");
    assert.deepEqual(JSON.parse(await readFile(target.path, "utf8")), {
      driveMount: target.config.driveMount,
      stateRoot: target.stateRoot,
      calendar: {
        managementHorizon: "2026-08-01T00:00:00+08:00",
        credentials: {
          scheduledRead: environment.READ_CREDENTIAL_PATH,
          interactiveWrite: environment.WRITE_CREDENTIAL_PATH,
        },
      },
    });
    assert.deepEqual(await readdir(target.stateRoot), []);
  });

  it("validates each supported format through the public command without exposing or changing values", async () => {
    const target = await fixture();
    for (const [kind, config] of [
      [
        "service",
        { driveMount: target.config.driveMount, stateRoot: target.stateRoot },
      ],
      ["local", target.config],
      [
        "cohort",
        {
          driveMount: target.config.driveMount,
          stateRoot: target.stateRoot,
          activeSemester: "Y2S1",
          semesters: {
            Y2S1: { root: "Modules/Y2S1", status: "active", modules: [] },
          },
        },
      ],
    ] as const) {
      for (const version of [undefined, 1]) {
        const source = JSON.stringify({
          ...config,
          ...(version === undefined ? {} : { schemaVersion: version }),
        });
        await writeFile(target.path, source);
        const result = await runCli(
          "config",
          "validate",
          "--config",
          target.path,
          "--json",
        );
        assert.equal(result.exitCode, 0, result.stderr + result.stdout);
        assert.deepEqual(JSON.parse(result.stdout), {
          schemaVersion: 1,
          outcome: "valid",
          kind,
          formatVersion: version ?? "unversioned",
          validation: "schema",
        });
        assert.equal(result.stdout.includes(target.root), false);
        assert.equal(await readFile(target.path, "utf8"), source);
      }
    }
    await writeFile(
      target.path,
      JSON.stringify({
        activeSemester: "SYNTHETIC",
        routine: { codexPath: "/codex", ghPath: "/gh" },
      }),
    );
    const invalid = await runCli(
      "config",
      "validate",
      "--config",
      target.path,
      "--json",
    );
    assert.equal(invalid.exitCode, 2);
    assert.equal(JSON.parse(invalid.stdout).error.code, "invalid-config");
  });

  it("observes configured executables from a complete service-only configuration", async () => {
    const target = await fixture();
    await writeFile(
      target.path,
      JSON.stringify({
        driveMount: target.config.driveMount,
        stateRoot: target.stateRoot,
        routine: {
          codexPath: join(target.root, "missing-codex"),
          ghPath: join(target.root, "missing-gh"),
        },
      }),
    );
    const result = await runCli(
      "capabilities",
      "health",
      "--config",
      target.path,
      "--json",
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).configuredExecutables.tools, [
      { tool: "codex", status: "missing" },
      { tool: "gh", status: "missing" },
    ]);
    assert.deepEqual(await readdir(target.stateRoot), []);
  });

  it("reads supported unversioned and versioned local and cohort targets without rewriting config or module", async () => {
    const target = await fixture();
    const cohort = {
      driveMount: target.config.driveMount,
      stateRoot: target.stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Modules/Y2S1", status: "active", modules: ["MH2100"] },
      },
    };
    for (const config of [
      target.config,
      { ...target.config, schemaVersion: 1 },
      cohort,
      { ...cohort, schemaVersion: 1 },
    ]) {
      await writeFile(target.path, JSON.stringify(config));
      const before = sha(await readFile(target.path));
      const result = await runCli(
        "module",
        "inspect",
        "--config",
        target.path,
        ...("activeSemester" in config
          ? ["--semester", "Y2S1", "--module", "MH2100"]
          : []),
        "--json",
      );
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).kind, "legacy");
      assert.equal(sha(await readFile(target.path)), before);
      assert.deepEqual(await readdir(target.moduleRoot), []);
      assert.deepEqual(await readdir(target.stateRoot), []);
    }
  });

  it("refuses bad input before target IO and emits structured redacted errors in JSON and human output", async () => {
    const target = await fixture();
    const secret = "synthetic-sensitive-value";
    const sources = [
      `{"driveMount":"/first","driveMount":"/${secret}"}`,
      JSON.stringify({ ...target.config, schemaVersion: 2 }),
      JSON.stringify({ ...target.config, activeSemester: "Y2S1" }),
      JSON.stringify({
        ...target.config,
        tasks: {
          credentials: { scheduledRead: secret, interactiveWrite: "/write" },
        },
      }),
      JSON.stringify({ ...target.config, [secret]: secret }),
    ];
    for (const source of sources) {
      await writeFile(target.path, source);
      for (const format of [["--json"], []]) {
        const result = await runCli(
          "module",
          "inspect",
          "--config",
          target.path,
          ...format,
        );
        assert.equal(result.exitCode, 2, result.stdout + result.stderr);
        assert.equal((result.stdout + result.stderr).includes(secret), false);
        if (format.length) {
          const report = JSON.parse(result.stdout);
          assert.equal(report.error.code, "invalid-config");
          assert.ok(report.error.diagnostics.length);
        }
      }
      assert.equal(await readFile(target.path, "utf8"), source);
      assert.deepEqual(await readdir(target.stateRoot), []);
      assert.deepEqual(await readdir(target.moduleRoot), []);
    }
  });

  it("reports an absent local target for a valid service-only config", async () => {
    const target = await fixture();
    await writeFile(
      target.path,
      JSON.stringify({
        driveMount: target.config.driveMount,
        stateRoot: target.stateRoot,
      }),
    );
    const result = await runCli(
      "module",
      "inspect",
      "--config",
      target.path,
      "--json",
    );
    assert.equal(result.exitCode, 2);
    assert.match(
      JSON.parse(result.stdout).error.message,
      /local module target/u,
    );
  });
});
