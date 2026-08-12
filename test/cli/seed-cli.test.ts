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
import { afterEach, describe, it } from "node:test";

import {
  contextualModuleDefinition,
  validModuleControls,
} from "../fixtures/module-controls.js";
import {
  seedMountedModule,
  type LocalConfig,
} from "../../src/mounted/index.js";
import { createModuleSeedPlan } from "../../src/seed/index.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import { runCli } from "../support/run-cli.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function seedFixture(): Promise<{
  configPath: string;
  definitionPath: string;
  moduleRoot: string;
  profilePath: string;
  semesterRoot: string;
  localConfig: LocalConfig;
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
  const localConfig: LocalConfig = {
    driveMount,
    stateRoot,
    semester: "Y2S1",
    module: "MH2100",
    semesterRoots: { Y2S1: "Modules/Y2S1" },
  };
  await writeFile(configPath, `${JSON.stringify(localConfig)}\n`);
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
    localConfig,
  };
}

describe("academic-os seed", () => {
  it("previews every vanilla creation without changing the semester root [MF-SEED-001]", async () => {
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
    const repeated = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--json",
    );
    const human = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
    );
    const repeatedHuman = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(repeated.stdout, result.stdout);
    assert.equal(repeatedHuman.stdout, human.stdout);
    const report = JSON.parse(result.stdout) as {
      outcome: string;
      operations: Array<{ kind: string; path: string }>;
    };
    assert.equal(report.outcome, "preview");
    assert.match(human.stdout, /Outcome: preview/u);
    assert.deepEqual(
      report.operations.map(({ kind, path }) => [path, kind]),
      universalPaths,
    );
    await assert.rejects(access(fixture.moduleRoot));
    assert.deepEqual(await readdir(fixture.semesterRoot), []);
    recordBehaviorEvidence("MF-SEED-001", () => {
      assert.equal(report.outcome, "preview");
    });
  });

  it("stages, audits, and publishes a conformant module only with --apply [MF-DOCS-001] [MF-AGENTS-003]", async () => {
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
    const result = await runCli(...arguments_);

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.stdout).outcome, "completed");
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
    recordBehaviorEvidence("MF-DOCS-001", () => {
      assert.equal(
        universalPaths.some(([path]) => path === "docs/adr"),
        true,
      );
    });
    const agents = await readFile(
      join(fixture.moduleRoot, "AGENTS.md"),
      "utf8",
    );
    recordBehaviorEvidence("MF-AGENTS-003", () => {
      assert.equal(
        agents.includes(
          "Show proposed changes for approval before applying them.",
        ),
        true,
      );
    });
    assert.match(
      agents,
      /## Domain language\nThe glossary is `CONTEXT\.md` and decisions are `docs\/adr\/`\./u,
    );
  });

  it("refuses an incompatible existing target without changing its content [MF-SEED-002]", async () => {
    const fixture = await seedFixture();
    await mkdir(fixture.moduleRoot);
    const existingPath = join(fixture.moduleRoot, "existing.txt");
    await writeFile(existingPath, "preserve me\n");

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
    const result = await runCli(...arguments_);
    const repeated = await runCli(...arguments_);
    const humanArguments = arguments_.slice(0, -1);
    const human = await runCli(...humanArguments);
    const repeatedHuman = await runCli(...humanArguments);

    assert.equal(result.exitCode, 1);
    assert.equal(repeated.stdout, result.stdout);
    assert.equal(repeatedHuman.stdout, human.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /MF-UNIVERSAL-001/u);
    assert.match(human.stdout, /Outcome: blocked/u);
    for (const evidence of report.evidence) {
      assert.equal(human.stdout.includes(`Evidence: ${evidence}`), true);
    }
    assert.equal(await readFile(existingPath, "utf8"), "preserve me\n");
    assert.deepEqual(await readdir(fixture.moduleRoot), ["existing.txt"]);
    recordBehaviorEvidence("MF-SEED-002", () => {
      assert.equal(report.outcome, "blocked");
    });
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
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /MF-PROFILE-003/u);
    assert.deepEqual(await readdir(fixture.semesterRoot), []);
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
    assert.equal(report.outcome, "completed");
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
    assert.match(changedResult.stdout, /approved plan changed/u);

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

  it("proves deterministic CC-style grouped tutorials, projects, labs, optional assessments, and importer roots", async () => {
    const fixture = await seedFixture();
    await writeFile(
      fixture.definitionPath,
      contextualModuleDefinition(
        await readFile(fixture.definitionPath, "utf8"),
      ),
    );
    const arguments_ = [
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--json",
    ];

    const preview = await runCli(...arguments_);
    const repeatedPreview = await runCli(...arguments_);
    const humanPreview = await runCli(...arguments_.slice(0, -1));
    const repeatedHumanPreview = await runCli(...arguments_.slice(0, -1));

    assert.equal(preview.exitCode, 0);
    assert.equal(repeatedPreview.stdout, preview.stdout);
    assert.equal(repeatedHumanPreview.stdout, humanPreview.stdout);
    const previewReport = JSON.parse(preview.stdout);
    assert.equal(previewReport.outcome, "preview");
    assert.match(humanPreview.stdout, /Outcome: preview/u);
    for (const { kind, path } of previewReport.operations) {
      assert.equal(
        humanPreview.stdout.includes(`Create ${kind}: ${path}`),
        true,
      );
    }
    const paths = previewReport.operations.map(
      ({ path }: { path: string }) => path,
    );
    for (const path of [
      "20 Tutorials/CC0001",
      "20 Tutorials/CC0002",
      "30 Assessments/10 Quizzes",
      "30 Assessments/20 Tests",
      "40 Projects and Labs/10 Projects/50 Submissions",
      "40 Projects and Labs/20 Labs/50 Submissions",
      "90 Resources/10 Formula Sheets",
      "NTULearn_Tutorial",
    ]) {
      assert.equal(paths.includes(path), true, path);
    }
    assert.deepEqual(await readdir(fixture.semesterRoot), []);

    const applied = await runCli(...arguments_, "--apply");
    assert.equal(applied.exitCode, 0);
    assert.equal(JSON.parse(applied.stdout).outcome, "completed");
    const audit = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--json",
    );
    assert.equal(audit.exitCode, 0);
    assert.equal(JSON.parse(audit.stdout).outcome, "conformant");
    const repeatedAudit = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--json",
    );
    assert.deepEqual(
      JSON.parse(repeatedAudit.stdout).findings,
      JSON.parse(audit.stdout).findings,
    );

    const rerun = await runCli(...arguments_, "--apply");
    assert.equal(rerun.exitCode, 0);
    assert.deepEqual(JSON.parse(rerun.stdout).operations, []);
  });

  it("blocks unclear or unsupported context evidence without creating optional structure [MF-SEED-003]", async () => {
    const fixture = await seedFixture();
    await writeFile(
      fixture.definitionPath,
      (await readFile(fixture.definitionPath, "utf8"))
        .replace(
          "tutorials: {layout: flat}",
          "tutorials: {layout: grouped, groups: [CC0001]}",
        )
        .replace("quizzes: {enabled: false}", "quizzes: {enabled: unknown}"),
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
    assert.match(result.stdout, /requires a human decision|requires-decision/u);
    assert.deepEqual(await readdir(fixture.semesterRoot), []);
    recordBehaviorEvidence("MF-SEED-003", () => {
      assert.equal(result.exitCode, 1);
    });
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

  it("exposes repair but no raw recovery, scheduling, or instruction-edit command", async () => {
    const repair = await runCli("repair", "--json");
    assert.equal(repair.exitCode, 2);
    assert.match(
      JSON.parse(repair.stdout).error.message,
      /academic-os repair --config/u,
    );
    const unsafeResume = await runCli(
      "repair",
      "--config",
      "missing.json",
      "--plan",
      "missing-plan.json",
      "--resume",
      "--json",
    );
    assert.equal(unsafeResume.exitCode, 2);
    assert.match(
      JSON.parse(unsafeResume.stdout).error.message,
      /academic-os repair --config/u,
    );
    for (const deferredCommand of [
      "recover",
      "schedule",
      "edit-instructions",
    ]) {
      const result = await runCli(deferredCommand, "--json");
      assert.equal(result.exitCode, 2, deferredCommand);
      assert.equal(JSON.parse(result.stdout).outcome, "operational-failure");
    }
  });

  it("reports an interrupted seed deterministically through the compiled CLI before resume", async () => {
    const fixture = await seedFixture();
    const plan = createModuleSeedPlan({
      module: "MH2100",
      semester: "Y2S1",
      profile: await readFile(fixture.profilePath, "utf8"),
      definition: await readFile(fixture.definitionPath, "utf8"),
    });
    let interrupted = false;
    await assert.rejects(
      seedMountedModule(fixture.localConfig, plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (!interrupted && checkpoint === "during-publication") {
            interrupted = true;
            throw new Error("synthetic CLI interruption");
          }
        },
      }),
      /synthetic CLI interruption/u,
    );
    const arguments_ = [
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--apply",
    ];
    const json = await runCli(...arguments_, "--json");
    const repeatedJson = await runCli(...arguments_, "--json");
    const human = await runCli(...arguments_);
    const repeatedHuman = await runCli(...arguments_);
    assert.equal(json.exitCode, 1);
    assert.equal(repeatedJson.stdout, json.stdout);
    assert.equal(repeatedHuman.stdout, human.stdout);
    assert.equal(JSON.parse(json.stdout).outcome, "safely-resumable");
    assert.match(human.stdout, /Outcome: safely-resumable/u);
    for (const evidence of JSON.parse(json.stdout).evidence) {
      assert.equal(human.stdout.includes(`Evidence: ${evidence}`), true);
    }

    const resumed = await runCli(...arguments_, "--resume", "--json");
    assert.equal(resumed.exitCode, 0);
    assert.equal(JSON.parse(resumed.stdout).outcome, "completed");
  });
});
