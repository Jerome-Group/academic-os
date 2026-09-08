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
import { join } from "node:path";
import { afterEach, it } from "node:test";

import { inventoryDirectory } from "../../src/mounted/inventory-mounted-module.js";
import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  configPath: string;
  moduleRoot: string;
  stateRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-learning-materials-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", "MH2100");
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  await mkdir(
    join(moduleRoot, "10 Learning Materials", "10 Lecture Materials"),
    {
      recursive: true,
    },
  );
  await mkdir(join(moduleRoot, "20 Tutorials"));
  await mkdir(stateRoot);
  await writeFile(
    join(moduleRoot, "00 Module Admin", "40 Source Map.yaml"),
    `units:
  Week 02:
    topics: [Limits]
    lectures:
      - 10 Learning Materials/10 Lecture Materials/MH2100_Lecture_02.pdf
      - 10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf
    textbook: []
    tutorials:
      - block: Block A
        exercises: Exercises 1-2
        sources:
          - file: 20 Tutorials/MH2100_Tutorial_02_Solutions.pdf
            locator: solutions 1-2
            role: solutions
            missing: [Exercise 2]
`,
  );
  await writeFile(
    join(
      moduleRoot,
      "10 Learning Materials",
      "10 Lecture Materials",
      "MH2100_Lecture_02.pdf",
    ),
    "fixture",
  );
  await writeFile(
    join(moduleRoot, "20 Tutorials", "MH2100_Tutorial_02_Solutions.pdf"),
    "fixture",
  );
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
        },
      },
      null,
      2,
    )}\n`,
  );
  return { root, configPath, moduleRoot, stateRoot };
}

it("reports study-source gaps in human and JSON output without writing", async () => {
  const target = await fixture();
  const before = await inventoryDirectory(target.moduleRoot);
  const stateBefore = await readdir(target.stateRoot);

  const json = await runCli(
    "learning",
    "materials",
    "--config",
    target.configPath,
    "--json",
  );
  const human = await runCli(
    "learning",
    "materials",
    "--config",
    target.configPath,
  );

  assert.equal(json.exitCode, 1);
  assert.equal(human.exitCode, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.outcome, "gaps");
  assert.deepEqual(report.selection.excluded, [
    { semester: "Y1S2", module: "MH1100", reason: "past" },
  ]);
  assert.deepEqual(report.modules[0].assessment.missingFiles, [
    "10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf",
  ]);
  assert.deepEqual(report.modules[0].assessment.declaredTutorialGaps, [
    {
      unit: "Week 02",
      block: "Block A",
      file: "20 Tutorials/MH2100_Tutorial_02_Solutions.pdf",
      role: "solutions",
      missing: ["Exercise 2"],
    },
  ]);
  assert.match(human.stdout, /Week 02: gaps/u);
  assert.match(human.stdout, /MH2100_Broken_Link\.pdf — missing/u);
  assert.match(human.stdout, /Exercise 2/u);
  assert.deepEqual(await inventoryDirectory(target.moduleRoot), before);
  assert.deepEqual(await readdir(target.stateRoot), stateBefore);
});

it("retains a healthy sibling when another target is unavailable", async () => {
  const target = await fixture();
  const sourceMap = await readFile(
    join(target.moduleRoot, "00 Module Admin", "40 Source Map.yaml"),
    "utf8",
  );
  await writeFile(
    join(target.moduleRoot, "00 Module Admin", "40 Source Map.yaml"),
    sourceMap
      .replace(
        "      - 10 Learning Materials/10 Lecture Materials/MH2100_Broken_Link.pdf\n",
        "",
      )
      .replace("            missing: [Exercise 2]\n", ""),
  );
  const healthy = await runCli(
    "learning",
    "materials",
    "--config",
    target.configPath,
    "--json",
  );
  assert.equal(healthy.exitCode, 0);
  assert.equal(JSON.parse(healthy.stdout).outcome, "available");

  const config = JSON.parse(await readFile(target.configPath, "utf8"));
  config.semesters.Y2S1.modules.push("MH2101");
  await writeFile(target.configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(
    "learning",
    "materials",
    "--config",
    target.configPath,
    "--json",
  );

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outcome, "incomplete");
  assert.deepEqual(
    report.modules.map(
      ({
        module,
        outcome,
      }: {
        module: { module: string };
        outcome: string;
      }) => [module.module, outcome],
    ),
    [
      ["MH2100", "available"],
      ["MH2101", "incomplete"],
    ],
  );
  assert.equal(report.selection.unresolved[0].module, "MH2101");
});

it("does not follow a Source Map through a symlinked ancestor", async () => {
  const target = await fixture();
  const admin = join(target.moduleRoot, "00 Module Admin");
  const outside = join(target.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "40 Source Map.yaml"), "units: {}\n");
  await rm(admin, { recursive: true });
  await symlink(outside, admin);

  const result = await runCli(
    "learning",
    "materials",
    "--config",
    target.configPath,
    "--json",
  );

  assert.equal(result.exitCode, 2);
  const module = JSON.parse(result.stdout).modules[0];
  assert.equal(module.outcome, "invalid");
  assert.match(module.assessment.problems[0], /No readable control/u);
});
