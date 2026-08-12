import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it } from "node:test";

import { validModuleControls } from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import { runCli } from "../support/run-cli.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function writeConformantModule(
  driveMount: string,
  semester: string,
  module: string,
): Promise<string> {
  const moduleRoot = join(driveMount, "Modules", semester, module);
  await mkdir(moduleRoot, { recursive: true });
  const controls = validModuleControls();
  const forModule = (contents: string): string => {
    const selectedModule = contents.replaceAll("MH2100", module);
    return semester.endsWith("S2")
      ? selectedModule
          .replace("| Semester | 1 |", "| Semester | 2 |")
          .replace("semester: 1", "semester: 2")
      : selectedModule;
  };
  const controlContents = new Map<string, string>([
    ["00 Module Admin/00 Module Profile.md", forModule(controls.profile ?? "")],
    [
      "00 Module Admin/10 Module Definition.yaml",
      forModule(controls.definition ?? ""),
    ],
    [
      "00 Module Admin/20 Curation Register.jsonl",
      controls.curationRegister ?? "",
    ],
    ["AGENTS.md", forModule(controls.agents ?? "")],
    ["CLAUDE.md", controls.claude ?? ""],
    ["CONTEXT.md", forModule(controls.context ?? "")],
  ]);
  for (const [relativePath, kind] of universalPaths) {
    const path = join(moduleRoot, relativePath);
    if (kind === "directory") {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, controlContents.get(relativePath) ?? "fixture\n");
    }
  }
  await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
  return moduleRoot;
}

async function cohortFixture(): Promise<{
  configPath: string;
  driveMount: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-cohort-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  await mkdir(stateRoot, { recursive: true });
  await writeConformantModule(driveMount, "Y2S1", "MH2100");
  await mkdir(join(driveMount, "Modules", "Y1S2", "MH1100"), {
    recursive: true,
  });
  await mkdir(join(driveMount, "Modules", "Y2S2", "MH2200"), {
    recursive: true,
  });
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        driveMount,
        stateRoot,
        activeSemester: "Y2S1",
        semesters: {
          Y1S2: {
            root: "Modules/Y1S2",
            status: "past",
            modules: ["MH1100"],
          },
          Y2S1: {
            root: "Modules/Y2S1",
            status: "active",
            modules: ["MH2100"],
          },
          Y2S2: {
            root: "Modules/Y2S2",
            status: "future",
            modules: ["MH2200"],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  return { configPath, driveMount };
}

async function moduleMetadata(
  root: string,
  relativeRoot = "",
): Promise<Array<{ path: string; size: number; modifiedAt: string }>> {
  const directory = relativeRoot === "" ? root : join(root, relativeRoot);
  const entries = (await readdir(directory)).sort();
  const metadata: Array<{
    path: string;
    size: number;
    modifiedAt: string;
  }> = [];
  for (const entry of entries) {
    const relativePath =
      relativeRoot === "" ? entry : `${relativeRoot}/${entry}`;
    const item = await lstat(join(root, relativePath));
    metadata.push({
      path: relativePath,
      size: item.size,
      modifiedAt: item.mtime.toISOString(),
    });
    if (item.isDirectory()) {
      metadata.push(...(await moduleMetadata(root, relativePath)));
    }
  }
  return metadata;
}

it("audits only active-semester modules and reports past and future exclusions [MF-AUDIT-003]", async () => {
  const { configPath } = await cohortFixture();

  const result = await runCli("audit", "--config", configPath, "--json");

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "cohort");
  assert.deepEqual(report.selection.included, [
    { semester: "Y2S1", module: "MH2100" },
  ]);
  assert.deepEqual(report.selection.excluded, [
    { semester: "Y1S2", module: "MH1100", reason: "past" },
    { semester: "Y2S2", module: "MH2200", reason: "future" },
  ]);
  assert.deepEqual(report.selection.unresolved, []);
  assert.deepEqual(
    report.modules.map(
      ({ module }: { module: { code: string } }) => module.code,
    ),
    ["MH2100"],
  );
  recordBehaviorEvidence("MF-AUDIT-003", () => {
    assert.deepEqual(report.selection.included, [
      { semester: "Y2S1", module: "MH2100" },
    ]);
  });
});

it("reports a missing active module as unresolved", async () => {
  const { configPath, driveMount } = await cohortFixture();
  await rm(join(driveMount, "Modules", "Y2S1", "MH2100"), {
    recursive: true,
  });

  const result = await runCli("audit", "--config", configPath, "--json");

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y2S1", module: "MH2100", reason: "missing-target" },
  ]);
  assert.deepEqual(report.modules, [
    {
      module: { code: "MH2100", semester: "Y2S1" },
      outcome: "operational-failure",
      error: {
        code: "missing-target",
        message: "Module MH2100 is not a direct child of Y2S1.",
      },
    },
  ]);
});

it("leaves a module mapped to multiple semesters unresolved", async () => {
  const { configPath } = await cohortFixture();
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.semesters.Y1S2.modules.push("MH2100");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli("audit", "--config", configPath, "--json");

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.selection.included, []);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y1S2", module: "MH2100", reason: "duplicated-module" },
    { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
  ]);
  assert.deepEqual(report.modules, []);
});

it("preserves successful module results when another module fails operationally", async () => {
  const { configPath, driveMount } = await cohortFixture();
  await writeConformantModule(driveMount, "Y2S1", "MH2101");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.semesters.Y2S1.modules.push("MH2101");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await rm(join(driveMount, "Modules", "Y2S1", "MH2100"), {
    recursive: true,
  });

  const result = await runCli("audit", "--config", configPath, "--json");

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, "operational-failure");
  assert.deepEqual(
    report.modules.map(
      ({ module, outcome }: { module: { code: string }; outcome: string }) => [
        module.code,
        outcome,
      ],
    ),
    [
      ["MH2100", "operational-failure"],
      ["MH2101", "conformant"],
    ],
  );
});

it("reports an empty active cohort explicitly", async () => {
  const { configPath } = await cohortFixture();
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.semesters.Y2S1.modules = [];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const json = await runCli("audit", "--config", configPath, "--json");
  const human = await runCli("audit", "--config", configPath);

  assert.equal(json.exitCode, 0);
  assert.deepEqual(JSON.parse(json.stdout).modules, []);
  assert.match(human.stdout, /Included: none/u);
  assert.match(human.stdout, /Modules audited: 0/u);
});

it("audits past and future modules only through an explicit target", async () => {
  const { configPath, driveMount } = await cohortFixture();
  await writeConformantModule(driveMount, "Y1S2", "MH1100");
  await writeConformantModule(driveMount, "Y2S2", "MH2200");

  const past = await runCli(
    "audit",
    "--config",
    configPath,
    "--semester",
    "Y1S2",
    "--module",
    "MH1100",
    "--json",
  );
  const future = await runCli(
    "audit",
    "--config",
    configPath,
    "--semester",
    "Y2S2",
    "--module",
    "MH2200",
    "--json",
  );

  assert.equal(past.exitCode, 0);
  assert.equal(future.exitCode, 0);
  assert.equal(JSON.parse(past.stdout).mode, "target");
  assert.deepEqual(JSON.parse(past.stdout).module, {
    code: "MH1100",
    semester: "Y1S2",
  });
  assert.deepEqual(JSON.parse(future.stdout).module, {
    code: "MH2200",
    semester: "Y2S2",
  });
});

it("audits historical migrations read-only and distinguishes contract relationships", async () => {
  const { configPath, driveMount } = await cohortFixture();
  const moduleRoot = await writeConformantModule(driveMount, "Y1S2", "MH1100");
  const arguments_ = [
    "audit",
    "--config",
    configPath,
    "--semester",
    "Y1S2",
    "--module",
    "MH1100",
    "--migration",
    "--json",
  ];

  const baseline = await runCli(...arguments_);
  assert.equal(
    JSON.parse(baseline.stdout).lifecycle.contractRelationship,
    "same-contract",
  );

  await rm(join(moduleRoot, "30 Assessments", "40 Finals"), {
    recursive: true,
  });
  const before = await moduleMetadata(moduleRoot);

  const sameContract = await runCli(...arguments_);

  assert.equal(sameContract.exitCode, 1);
  assert.equal(JSON.parse(sameContract.stdout).mode, "migration");
  assert.equal(
    JSON.parse(sameContract.stdout).lifecycle.contractRelationship,
    "same-contract-drift",
  );
  assert.deepEqual(await moduleMetadata(moduleRoot), before);

  const definitionPath = join(
    moduleRoot,
    "00 Module Admin",
    "10 Module Definition.yaml",
  );
  await writeFile(
    definitionPath,
    (await readFile(definitionPath, "utf8")).replace(
      "contract_version: 2",
      "contract_version: 1",
    ),
  );
  const upgrade = await runCli(...arguments_);
  assert.equal(
    JSON.parse(upgrade.stdout).lifecycle.contractRelationship,
    "contract-version-upgrade",
  );

  await rm(definitionPath);
  const gap = await runCli(...arguments_);
  assert.equal(
    JSON.parse(gap.stdout).lifecycle.contractRelationship,
    "historical-contract-gap",
  );
});

it("preserves each module's findings in mixed-result human and JSON reports", async () => {
  const { configPath, driveMount } = await cohortFixture();
  await writeConformantModule(driveMount, "Y2S1", "MH2101");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.semesters.Y2S1.modules.push("MH2101");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await rm(
    join(
      driveMount,
      "Modules",
      "Y2S1",
      "MH2100",
      "30 Assessments",
      "40 Finals",
    ),
    { recursive: true },
  );

  const json = await runCli("audit", "--config", configPath, "--json");
  const human = await runCli("audit", "--config", configPath);

  assert.equal(json.exitCode, 1);
  assert.equal(human.exitCode, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.outcome, "deviation");
  assert.deepEqual(
    report.modules.map(
      ({ module, outcome }: { module: { code: string }; outcome: string }) => [
        module.code,
        outcome,
      ],
    ),
    [
      ["MH2100", "deviation"],
      ["MH2101", "conformant"],
    ],
  );
  assert.match(human.stdout, /Audit MH2100 \(Y2S1\)[\s\S]*MF-UNIVERSAL-001/u);
  assert.match(human.stdout, /Audit MH2101 \(Y2S1\)[\s\S]*MF-UNIVERSAL-001/u);
});

it("does not call an unavailable current contract version an upgrade", async () => {
  const { configPath, driveMount } = await cohortFixture();
  await rm(
    join(
      driveMount,
      "Modules",
      "Y2S1",
      "MH2100",
      "00 Module Admin",
      "10 Module Definition.yaml",
    ),
  );

  const result = await runCli("audit", "--config", configPath, "--json");

  assert.equal(result.exitCode, 1);
  assert.equal(
    JSON.parse(result.stdout).modules[0].lifecycle.contractRelationship,
    "contract-version-unavailable",
  );
});
