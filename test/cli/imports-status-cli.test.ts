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

import type { ImportStatusReceipt } from "../../src/imports/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

interface Fixture {
  root: string;
  driveMount: string;
  configPath: string;
  moduleRoot: string;
}

async function fixture(
  roots: string[] = ["NTULearn"],
  module = "MH2100",
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-imports-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", module);
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  await mkdir(stateRoot);
  for (const destination of roots) await mkdir(join(moduleRoot, destination));
  await writeDefinition(moduleRoot, roots);
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        driveMount,
        stateRoot,
        activeSemester: "Y2S1",
        semesters: {
          Y1S2: { root: "Modules/Y1S2", status: "past", modules: ["MH1100"] },
          Y2S1: { root: "Modules/Y2S1", status: "active", modules: [module] },
        },
      },
      null,
      2,
    )}\n`,
  );
  return { root, driveMount, configPath, moduleRoot };
}

async function writeDefinition(
  moduleRoot: string,
  roots: string[],
): Promise<void> {
  const module = moduleRoot.split("/").at(-1) ?? "MH2100";
  const source = (validModuleControls().definition ?? "")
    .replaceAll("MH2100", module)
    .replace(
      "    - {role: primary, destination: NTULearn, evidence: [course-site]}",
      roots
        .map(
          (destination, index) =>
            `    - {role: ${index === 0 ? "primary" : "secondary"}, destination: ${destination}, evidence: [course-site]}`,
        )
        .join("\n"),
    );
  await writeFile(
    join(moduleRoot, "00 Module Admin", "10 Module Definition.yaml"),
    source,
  );
}

async function canonicalFixture(): Promise<ImportStatusReceipt> {
  return JSON.parse(
    await readFile(
      join(process.cwd(), "test/fixtures/import-status-v1.json"),
      "utf8",
    ),
  ) as ImportStatusReceipt;
}

function receipt(
  input: {
    status?: ImportStatusReceipt["status"];
    ageHours?: number;
    futureMinutes?: number;
  } = {},
): ImportStatusReceipt {
  const status = input.status ?? "complete";
  const finished = new Date(
    Date.now() -
      (input.ageHours ?? 0) * 60 * 60 * 1000 +
      (input.futureMinutes ?? 0) * 60 * 1000,
  );
  const started = new Date(finished.getTime() - 60_000);
  const terminal = status !== "running";
  const partial = status === "partial";
  return {
    schemaVersion: 1,
    producer: "ntulearn",
    status,
    startedAt: started.toISOString(),
    finishedAt: terminal ? finished.toISOString() : null,
    lastSuccessfulAt: status === "complete" ? finished.toISOString() : null,
    counts: {
      downloaded: status === "running" ? 0 : 2,
      skipped: 0,
      markdown: status === "running" ? 0 : 3,
      uncopied: 0,
      failures: partial ? 1 : 0,
    },
    unread: [],
  };
}

async function writeReceipt(
  moduleRoot: string,
  destination: string,
  value: unknown,
): Promise<void> {
  await writeFile(
    join(moduleRoot, destination, "Sync status.json"),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

it("reports every declared root with matching human and JSON evidence", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  const frozen = await canonicalFixture();
  assert.equal(frozen.producer, "ntulearn");
  const current = receipt();
  const failed = receipt({ status: "failed" });
  await writeReceipt(target.moduleRoot, "NTULearn", current);
  await writeReceipt(target.moduleRoot, "NTULearn_Tutorial", failed);

  const json = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  const human = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
  );

  assert.equal(json.exitCode, 1);
  assert.equal(human.exitCode, 1);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(
    report.modules[0].roots.map(
      ({ destination, status }: { destination: string; status: string }) => [
        destination,
        status,
      ],
    ),
    [
      ["NTULearn", "current"],
      ["NTULearn_Tutorial", "failed"],
    ],
  );
  assert.deepEqual(report.modules[0].roots[0].counts, current.counts);
  assert.equal(
    report.modules[0].roots[0].lastSuccessfulAt,
    current.lastSuccessfulAt,
  );
  assert.match(human.stdout, /NTULearn: current/u);
  assert.match(human.stdout, /downloaded:2/u);
  assert.match(
    human.stdout,
    new RegExp(`lastSuccess=${current.lastSuccessfulAt}`, "u"),
  );
  assert.match(human.stdout, /NTULearn_Tutorial: failed/u);
  assert.deepEqual(report.selection.excluded, [
    { semester: "Y1S2", module: "MH1100", reason: "past" },
  ]);
});

it("distinguishes missing, running, partial, stale, and configurable freshness", async () => {
  const target = await fixture();

  const missing = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  assert.equal(missing.exitCode, 1);
  assert.equal(
    JSON.parse(missing.stdout).modules[0].roots[0].status,
    "missing",
  );

  for (const status of ["running", "partial"] as const) {
    await writeReceipt(target.moduleRoot, "NTULearn", receipt({ status }));
    const result = await runCli(
      "imports",
      "status",
      "--config",
      target.configPath,
      "--json",
    );
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stdout).modules[0].roots[0].status, status);
  }

  const basePartial = receipt({ status: "partial" });
  const unreadPartial = {
    ...basePartial,
    counts: { ...basePartial.counts, failures: 0 },
    unread: ["announcements"],
  };
  await writeReceipt(target.moduleRoot, "NTULearn", unreadPartial);
  const partialJson = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  const partialHuman = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
  );
  assert.deepEqual(JSON.parse(partialJson.stdout).modules[0].roots[0].unread, [
    "announcements",
  ]);
  assert.match(partialHuman.stdout, /unread=announcements/u);
  assert.match(partialHuman.stdout, /started=\d{4}-/u);
  assert.match(partialHuman.stdout, /finished=\d{4}-/u);

  await writeReceipt(target.moduleRoot, "NTULearn", receipt({ ageHours: 2 }));
  const stale = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--max-age-hours",
    "1",
    "--json",
  );
  const current = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--max-age-hours",
    "3",
    "--json",
  );
  assert.equal(JSON.parse(stale.stdout).modules[0].roots[0].status, "stale");
  assert.equal(stale.exitCode, 1);
  assert.equal(
    JSON.parse(current.stdout).modules[0].roots[0].status,
    "current",
  );
  assert.equal(current.exitCode, 0);
  assert.equal(JSON.parse(current.stdout).maxAgeHours, 3);
});

it("rejects future, malformed, unsupported, and unsafe receipt evidence", async () => {
  const target = await fixture();
  const invalidValues: unknown[] = [
    receipt({ futureMinutes: 5 }),
    { ...receipt(), schemaVersion: 2 },
    { ...receipt(), extra: true },
  ];
  for (const value of invalidValues) {
    await writeReceipt(target.moduleRoot, "NTULearn", value);
    const result = await runCli(
      "imports",
      "status",
      "--config",
      target.configPath,
      "--json",
    );
    assert.equal(result.exitCode, 2);
    assert.equal(
      JSON.parse(result.stdout).modules[0].roots[0].status,
      "invalid",
    );
  }

  await rm(join(target.moduleRoot, "NTULearn", "Sync status.json"));
  await mkdir(join(target.moduleRoot, "NTULearn", "Sync status.json"));
  const directory = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  assert.equal(directory.exitCode, 2);
  assert.match(
    JSON.parse(directory.stdout).modules[0].roots[0].error,
    /not a regular file/u,
  );

  await rm(join(target.moduleRoot, "NTULearn", "Sync status.json"), {
    recursive: true,
  });
  await writeFile(
    join(target.moduleRoot, "NTULearn", "Sync status.json"),
    "x".repeat(16 * 1024 + 1),
  );
  const large = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  assert.equal(large.exitCode, 2);
  assert.match(
    JSON.parse(large.stdout).modules[0].roots[0].error,
    /exceeds 16 KiB/u,
  );

  await rm(join(target.moduleRoot, "NTULearn", "Sync status.json"));
  const outside = join(target.root, "outside.json");
  await writeFile(outside, JSON.stringify(receipt()));
  await symlink(
    outside,
    join(target.moduleRoot, "NTULearn", "Sync status.json"),
  );
  const linked = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );
  assert.equal(linked.exitCode, 2);
  assert.match(
    JSON.parse(linked.stdout).modules[0].roots[0].error,
    /symbolic link/u,
  );
});

it("preserves healthy siblings when targets or Definitions are invalid", async () => {
  const target = await fixture();
  await writeReceipt(target.moduleRoot, "NTULearn", receipt());
  const config = JSON.parse(await readFile(target.configPath, "utf8"));
  config.semesters.Y2S1.modules.push("MH2101", "MH2102");
  await writeFile(target.configPath, `${JSON.stringify(config, null, 2)}\n`);
  const invalidDefinitionRoot = join(
    target.driveMount,
    "Modules",
    "Y2S1",
    "MH2101",
  );
  await mkdir(join(invalidDefinitionRoot, "00 Module Admin"), {
    recursive: true,
  });
  await mkdir(join(invalidDefinitionRoot, "NTULearn"));
  await writeFile(
    join(invalidDefinitionRoot, "00 Module Admin", "10 Module Definition.yaml"),
    "sources: {ntulearn: [{destination: ../unsafe}]}\n",
  );

  const result = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    report.modules.map(
      ({ module, status }: { module: { module: string }; status: string }) => [
        module.module,
        status,
      ],
    ),
    [
      ["MH2100", "observed"],
      ["MH2101", "invalid"],
      ["MH2102", "invalid"],
    ],
  );
  assert.equal(report.modules[0].roots[0].status, "current");
  assert.equal(report.selection.unresolved.length, 2);
});

it("rejects symlinked Definition and importer-root components", async () => {
  const definitionTarget = await fixture();
  await writeReceipt(definitionTarget.moduleRoot, "NTULearn", receipt());
  const definitionPath = join(
    definitionTarget.moduleRoot,
    "00 Module Admin",
    "10 Module Definition.yaml",
  );
  const outsideDefinition = join(definitionTarget.root, "Definition.yaml");
  await writeFile(outsideDefinition, validModuleControls().definition ?? "");
  await rm(definitionPath);
  await symlink(outsideDefinition, definitionPath);

  const linkedDefinition = await runCli(
    "imports",
    "status",
    "--config",
    definitionTarget.configPath,
    "--json",
  );
  assert.equal(linkedDefinition.exitCode, 2);
  assert.equal(
    JSON.parse(linkedDefinition.stdout).modules[0].status,
    "invalid",
  );

  const rootTarget = await fixture();
  const importerRoot = join(rootTarget.moduleRoot, "NTULearn");
  const outsideRoot = join(rootTarget.root, "outside-root");
  await rm(importerRoot, { recursive: true });
  await mkdir(outsideRoot);
  await writeReceipt(rootTarget.root, "outside-root", receipt());
  await symlink(outsideRoot, importerRoot);

  const linkedRoot = await runCli(
    "imports",
    "status",
    "--config",
    rootTarget.configPath,
    "--json",
  );
  assert.equal(linkedRoot.exitCode, 2);
  assert.equal(
    JSON.parse(linkedRoot.stdout).modules[0].roots[0].status,
    "invalid",
  );
  assert.match(
    JSON.parse(linkedRoot.stdout).modules[0].roots[0].error,
    /symbolic link/u,
  );
});

it("rejects invalid freshness arguments", async () => {
  const target = await fixture();
  const result = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--max-age-hours",
    "0",
    "--json",
  );
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
});

it("retains duplicated mappings and leaves the mounted tree byte-for-byte unchanged", async () => {
  const target = await fixture();
  await writeReceipt(target.moduleRoot, "NTULearn", receipt());
  const config = JSON.parse(await readFile(target.configPath, "utf8"));
  config.semesters.Y1S2.modules.push("MH2100");
  await writeFile(target.configPath, `${JSON.stringify(config, null, 2)}\n`);
  const before = await treeSnapshot(target.root);

  const result = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
    "--json",
  );

  assert.equal(result.exitCode, 2);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.modules, []);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y1S2", module: "MH2100", reason: "duplicated-module" },
    { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
  ]);
  const human = await runCli(
    "imports",
    "status",
    "--config",
    target.configPath,
  );
  assert.match(human.stdout, /Y2S1\/MH2100 \(duplicated-module\)/u);
  assert.deepEqual(await treeSnapshot(target.root), before);
});

async function treeSnapshot(root: string): Promise<Array<[string, string]>> {
  const paths = (await readdir(root, { recursive: true, withFileTypes: true }))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return await Promise.all(
    paths.map(async (path) => {
      const relative = path.slice(root.length + 1);
      try {
        return [relative, await readFile(path, "utf8")] as [string, string];
      } catch {
        return [relative, "<directory>"] as [string, string];
      }
    }),
  );
}
