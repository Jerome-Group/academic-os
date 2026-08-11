import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { validModuleControls } from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";

const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(...arguments_: string[]): Promise<CliRun> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

async function seedFixture(): Promise<{
  configPath: string;
  definitionPath: string;
  moduleRoot: string;
  profilePath: string;
  semesterRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-seed-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const semesterRoot = join(driveMount, "Modules", "Y2S1");
  const moduleRoot = join(semesterRoot, "MH2100");
  await mkdir(semesterRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      semester: "Y2S1",
      module: "MH2100",
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    })}\n`,
  );
  const controls = validModuleControls();
  const profilePath = join(root, "approved-profile.md");
  const definitionPath = join(root, "approved-definition.yaml");
  await writeFile(profilePath, controls.profile ?? "");
  await writeFile(
    definitionPath,
    (controls.definition ?? "").replace(
      "quizzes: {enabled: true, evidence: [assessment-profile]}",
      "quizzes: {enabled: false}",
    ),
  );
  return {
    configPath,
    definitionPath,
    moduleRoot,
    profilePath,
    semesterRoot,
  };
}

describe("academic-os seed", () => {
  it("previews every vanilla creation without changing the semester root", async () => {
    const fixture = await seedFixture();

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--json",
    );

    assert.equal(result.exitCode, 0);
    const report = JSON.parse(result.stdout) as {
      outcome: string;
      operations: Array<{ kind: string; path: string }>;
    };
    assert.equal(report.outcome, "preview");
    assert.deepEqual(
      report.operations.map(({ kind, path }) => [path, kind]),
      universalPaths,
    );
    await assert.rejects(access(fixture.moduleRoot));
    assert.deepEqual(await readdir(fixture.semesterRoot), []);
  });

  it("stages, audits, and publishes a conformant module only with --apply", async () => {
    const fixture = await seedFixture();

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--apply",
      "--json",
    );

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).outcome, "published");
    for (const [relativePath, kind] of universalPaths) {
      const metadata = await lstat(join(fixture.moduleRoot, relativePath));
      assert.equal(
        kind === "directory" ? metadata.isDirectory() : metadata.isFile(),
        true,
        relativePath,
      );
    }
    assert.deepEqual(await readdir(fixture.semesterRoot), ["MH2100"]);
    const audit = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--json",
    );
    assert.equal(audit.exitCode, 0);
    assert.equal(JSON.parse(audit.stdout).outcome, "conformant");
  });

  it("refuses an incompatible existing target without changing its content", async () => {
    const fixture = await seedFixture();
    await mkdir(fixture.moduleRoot);
    const existingPath = join(fixture.moduleRoot, "existing.txt");
    await writeFile(existingPath, "preserve me\n");

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--apply",
      "--json",
    );

    assert.equal(result.exitCode, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /MF-UNIVERSAL-001/u);
    assert.equal(await readFile(existingPath, "utf8"), "preserve me\n");
    assert.deepEqual(await readdir(fixture.moduleRoot), ["existing.txt"]);
  });

  it("rejects case variants, symlink targets, and unresolved placeholders", async () => {
    const caseVariant = await seedFixture();
    await mkdir(join(caseVariant.semesterRoot, "mh2100"));
    const caseResult = await runCli(
      "seed",
      "--config",
      caseVariant.configPath,
      "--profile",
      caseVariant.profilePath,
      "--definition",
      caseVariant.definitionPath,
      "--json",
    );
    assert.equal(caseResult.exitCode, 1);
    assert.match(caseResult.stdout, /case variant/u);

    const symlinkTarget = await seedFixture();
    const outside = join(symlinkTarget.semesterRoot, "outside");
    await mkdir(outside);
    await symlink(outside, symlinkTarget.moduleRoot);
    const symlinkResult = await runCli(
      "seed",
      "--config",
      symlinkTarget.configPath,
      "--profile",
      symlinkTarget.profilePath,
      "--definition",
      symlinkTarget.definitionPath,
      "--json",
    );
    assert.equal(symlinkResult.exitCode, 1);
    assert.match(symlinkResult.stdout, /symbolic link/u);

    const placeholder = await seedFixture();
    await writeFile(
      placeholder.profilePath,
      (await readFile(placeholder.profilePath, "utf8")).replace(
        "Multivariable calculus.",
        "{{ unresolved scope }}",
      ),
    );
    const placeholderResult = await runCli(
      "seed",
      "--config",
      placeholder.configPath,
      "--profile",
      placeholder.profilePath,
      "--definition",
      placeholder.definitionPath,
      "--json",
    );
    assert.equal(placeholderResult.exitCode, 1);
    assert.match(placeholderResult.stdout, /Unresolved placeholder/u);
    await assert.rejects(access(placeholder.moduleRoot));
  });

  it("refuses publication when the staged controls do not conform", async () => {
    const fixture = await seedFixture();
    await writeFile(
      fixture.profilePath,
      (await readFile(fixture.profilePath, "utf8")).replace(
        "# MH2100 — Calculus III",
        "# MH2100 — Linear Algebra",
      ),
    );

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--apply",
      "--json",
    );

    assert.equal(result.exitCode, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "staged");
    assert.match(report.evidence.join("\n"), /MF-PROFILE-003/u);
    const stagedEntries = await readdir(fixture.semesterRoot);
    assert.equal(stagedEntries.length, 1);
    assert.match(stagedEntries[0] ?? "", /^\.academic-os-stage-MH2100-/u);
    await assert.rejects(access(fixture.moduleRoot));
  });

  it("proposes no changes when a published seed is rerun", async () => {
    const fixture = await seedFixture();
    const arguments_ = [
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--apply",
      "--json",
    ];
    assert.equal((await runCli(...arguments_)).exitCode, 0);

    const rerun = await runCli(...arguments_);

    assert.equal(rerun.exitCode, 0);
    const report = JSON.parse(rerun.stdout);
    assert.equal(report.outcome, "published");
    assert.deepEqual(report.operations, []);
    assert.match(report.evidence.join("\n"), /no changes proposed/u);
    assert.deepEqual(await readdir(fixture.semesterRoot), ["MH2100"]);
  });

  it("blocks a different approved plan and nested symlink escapes", async () => {
    const changedPlan = await seedFixture();
    const arguments_ = [
      "seed",
      "--config",
      changedPlan.configPath,
      "--profile",
      changedPlan.profilePath,
      "--definition",
      changedPlan.definitionPath,
      "--apply",
      "--json",
    ];
    assert.equal((await runCli(...arguments_)).exitCode, 0);
    await writeFile(
      changedPlan.profilePath,
      (await readFile(changedPlan.profilePath, "utf8")).replace(
        "Multivariable calculus.",
        "Calculus in several variables.",
      ),
    );
    const changedResult = await runCli(...arguments_);
    assert.equal(changedResult.exitCode, 1);
    assert.match(changedResult.stdout, /approved control differs/u);

    const nestedSymlink = await seedFixture();
    const nestedArguments = arguments_.map((argument) =>
      argument
        .replace(changedPlan.configPath, nestedSymlink.configPath)
        .replace(changedPlan.profilePath, nestedSymlink.profilePath)
        .replace(changedPlan.definitionPath, nestedSymlink.definitionPath),
    );
    assert.equal((await runCli(...nestedArguments)).exitCode, 0);
    const outside = join(nestedSymlink.semesterRoot, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      join(nestedSymlink.moduleRoot, "70 Learning", "escape"),
    );
    const symlinkResult = await runCli(...nestedArguments);
    assert.equal(symlinkResult.exitCode, 1);
    assert.match(symlinkResult.stdout, /contains symbolic links/u);
  });

  it("blocks context-derived controls until issue #13", async () => {
    const fixture = await seedFixture();
    await writeFile(
      fixture.definitionPath,
      (await readFile(fixture.definitionPath, "utf8")).replace(
        "quizzes: {enabled: false}",
        "quizzes: {enabled: true, evidence: [assessment-profile]}",
      ),
    );

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--json",
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /context-derived seeding is issue #13/u);
    assert.deepEqual(await readdir(fixture.semesterRoot), []);
  });

  it("reports configuration failures as operational failures", async () => {
    const fixture = await seedFixture();
    await rm(fixture.semesterRoot, { recursive: true });

    const result = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--json",
    );

    assert.equal(result.exitCode, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.outcome, "operational-failure");
    assert.equal(report.error.code, "invalid-config");
    assert.match(report.error.message, /semester-root cannot be resolved/u);
  });
});
