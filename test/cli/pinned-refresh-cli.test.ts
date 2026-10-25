import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
} from "../../src/contract/pinned-documents.js";
import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";
import { researchProjectSharedControlPaths } from "../../src/contract/research-project-structure.js";
import { testModuleContract } from "../fixtures/module-contract.js";
import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];
const teachingProcedure = pinnedDocumentPaths.teachingProcedure;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function cohortFixture(
  modules = ["CC0006", "MH2100"],
  options: {
    duplicateModules?: string[];
    researchStatus?: "active" | "inactive";
  } = {},
): Promise<{
  root: string;
  configPath: string;
  stateRoot: string;
  moduleRoots: Map<string, string>;
  researchRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-pinned-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "state");
  await mkdir(stateRoot, { recursive: true });
  const moduleRoots = new Map<string, string>();
  for (const module of modules) {
    const moduleRoot = join(driveMount, "Modules", "Y2S1", module);
    moduleRoots.set(module, moduleRoot);
    for (const name of pinnedDocumentNames) {
      const path = join(moduleRoot, pinnedDocumentPaths[name]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        interpolateModuleCode(testModuleContract.pinnedDocuments[name], module),
        "utf8",
      );
    }
  }
  const researchRoot = join(driveMount, "Research", "Example Project");
  const researchContract = await loadResearchProjectContract();
  for (const path of researchProjectSharedControlPaths) {
    const target = join(researchRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      (researchContract.seedFiles[path] ?? "").replaceAll(
        "{{PROJECT_NAME}}",
        "Example Project",
      ),
      "utf8",
    );
  }
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: {
          root: "Modules/Y2S1",
          status: "active",
          modules,
        },
        ...(options.duplicateModules === undefined
          ? {}
          : {
              Y1S2: {
                root: "Modules/Y1S2",
                status: "past",
                modules: options.duplicateModules,
              },
            }),
      },
      research: {
        root: "Research",
        projects: {
          "example-project": {
            folder: "Example Project",
            status: options.researchStatus ?? "active",
          },
        },
      },
    }),
    "utf8",
  );
  return { root, configPath, stateRoot, moduleRoots, researchRoot };
}

async function treeSnapshot(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return await Promise.all(
    entries
      .map((entry) => ({
        path: relative(root, join(entry.parentPath, entry.name)),
        directory: entry.isDirectory(),
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(async (entry) => ({
        ...entry,
        ...(entry.directory
          ? {}
          : {
              bytes: (await readFile(join(root, entry.path))).toString(
                "base64",
              ),
            }),
      })),
  );
}

describe("academic-os pinned refresh", () => {
  it("reports a current cohort and exits zero", async () => {
    const fixture = await cohortFixture();

    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, "pinned refresh");
    assert.equal(report.outcome, "current");
    assert.deepEqual(report.counts, { current: 14, stale: 0, missing: 0 });
    assert.deepEqual(await readdir(fixture.stateRoot), []);
  });

  it("retains the human success message for a completely current cohort", async () => {
    const fixture = await cohortFixture();
    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.match(result.stdout, /Every pinned copy is current\.\n$/u);
  });

  it("reports an incomplete refresh when its only module is unresolved", async () => {
    const fixture = await cohortFixture(["MH2100"]);
    const moduleRoot = fixture.moduleRoots.get("MH2100");
    assert.ok(moduleRoot);
    await rm(moduleRoot, { recursive: true });
    const arguments_ = ["pinned", "refresh", "--config", fixture.configPath];
    const json = await runCli(...arguments_, "--json");

    assert.equal(json.exitCode, 2, JSON.stringify(json));
    const report = JSON.parse(json.stdout);
    assert.equal(report.outcome, "incomplete");
    assert.equal(report.unresolved.length, 1);
    assert.equal(report.unresolved[0].module, "MH2100");
    assert.deepEqual(report.counts, { current: 0, stale: 0, missing: 0 });
    assert.deepEqual(report.rewrites, []);

    const human = await runCli(...arguments_);
    assert.equal(human.exitCode, 2, JSON.stringify(human));
    assert.match(human.stdout, /Unresolved Y2S1\/MH2100:/u);
    assert.doesNotMatch(human.stdout, /Every pinned copy is current\./u);
    assert.match(human.stdout, /Refresh incomplete\./u);
    assert.deepEqual(await readdir(fixture.stateRoot), []);
  });

  for (const modules of [["MH2100"], ["CC0006", "MH2100"]]) {
    for (const apply of [false, true]) {
      it(`preserves duplicate selection for a ${modules.length === 1 ? "duplicate-only" : "mixed"} cohort in ${apply ? "apply" : "preview"}`, async () => {
        const fixture = await cohortFixture(modules, {
          duplicateModules: ["MH2100"],
        });
        const uniqueRoot = fixture.moduleRoots.get("CC0006");
        if (uniqueRoot !== undefined) {
          await writeFile(
            join(uniqueRoot, teachingProcedure),
            "# Stale unique copy\n",
          );
        }
        const before = await treeSnapshot(fixture.root);
        const arguments_ = [
          "pinned",
          "refresh",
          "--config",
          fixture.configPath,
          ...(apply ? ["--apply"] : []),
        ];

        const json = await runCli(...arguments_, "--json");
        assert.equal(json.exitCode, 2, JSON.stringify(json));
        const report = JSON.parse(json.stdout);
        assert.equal(report.outcome, apply ? "refused" : "incomplete");
        assert.deepEqual(report.unresolved, [
          { semester: "Y1S2", module: "MH2100", reason: "duplicated-module" },
          { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
        ]);
        assert.deepEqual(
          report.counts,
          uniqueRoot === undefined
            ? { current: 0, stale: 0, missing: 0 }
            : { current: 6, stale: 1, missing: 0 },
        );
        assert.equal(report.rewrites.length, uniqueRoot === undefined ? 0 : 1);
        assert.equal(report.rewritten, 0);
        assert.equal(report.journal, undefined);

        const human = await runCli(...arguments_);
        assert.equal(human.exitCode, 2, JSON.stringify(human));
        assert.match(
          human.stdout,
          /Unresolved Y2S1\/MH2100: duplicated-module/u,
        );
        assert.doesNotMatch(human.stdout, /Every pinned copy is current\./u);
        assert.match(human.stdout, /Refresh incomplete\./u);
        assert.deepEqual(await treeSnapshot(fixture.root), before);
      });
    }
  }

  for (const stale of [false, true]) {
    it(`keeps inactive Research ${stale ? "stale" : "current"} controls read-only`, async () => {
      const fixture = await cohortFixture(undefined, {
        researchStatus: "inactive",
      });
      const target = join(fixture.researchRoot, "AGENTS.md");
      if (stale) await writeFile(target, "# Stale inactive router\n");
      const before = await treeSnapshot(fixture.root);
      const arguments_ = [
        "pinned",
        "refresh",
        "--config",
        fixture.configPath,
        "--research-project",
        "example-project",
        "--json",
      ];

      const preview = await runCli(...arguments_);
      assert.equal(preview.exitCode, stale ? 1 : 0, JSON.stringify(preview));
      const report = JSON.parse(preview.stdout);
      assert.equal(report.outcome, stale ? "stale" : "current");
      assert.equal(report.rewrites.length, stale ? 1 : 0);
      assert.equal(report.rewritten, 0);
      assert.equal(report.journal, undefined);
      assert.deepEqual(await treeSnapshot(fixture.root), before);

      const applied = await runCli(...arguments_, "--apply");
      assert.equal(applied.exitCode, 2, JSON.stringify(applied));
      assert.match(applied.stderr + applied.stdout, /inactive and read-only/u);
      assert.deepEqual(await treeSnapshot(fixture.root), before);
    });
  }

  it("closes refused refreshes with an incomplete message", async () => {
    const fixture = await cohortFixture();
    const moduleRoot = fixture.moduleRoots.get("MH2100");
    assert.ok(moduleRoot);
    await rm(join(moduleRoot, "docs"), { recursive: true });
    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--apply",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(result.stdout, /Pinned document refresh: refused \(apply\)/u);
    assert.match(result.stdout, /Refused MH2100/u);
    assert.doesNotMatch(result.stdout, /Every pinned copy is current\./u);
    assert.match(result.stdout, /Refresh incomplete\./u);
    assert.deepEqual(await readdir(fixture.stateRoot), []);
  });

  it("previews a stale copy without writing, then rewrites it on apply", async () => {
    const fixture = await cohortFixture();
    const target = join(
      fixture.moduleRoots.get("MH2100") ?? "",
      teachingProcedure,
    );
    await writeFile(target, "# Edited in the module\n", "utf8");

    const preview = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(preview.exitCode, 1, JSON.stringify(preview));
    const previewed = JSON.parse(preview.stdout);
    assert.equal(previewed.outcome, "stale");
    assert.equal(previewed.mode, "preview");
    assert.equal(previewed.rewrites.length, 1);
    assert.equal(previewed.rewrites[0].module, "MH2100");
    assert.match(previewed.rewrites[0].evidence, /at line 1, which reads/u);
    assert.equal(previewed.rewrites[0].expected, undefined);
    assert.equal(await readFile(target, "utf8"), "# Edited in the module\n");

    const applied = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--apply",
      "--json",
    );

    assert.equal(applied.exitCode, 0, JSON.stringify(applied));
    const report = JSON.parse(applied.stdout);
    assert.equal(report.outcome, "current");
    assert.equal(report.rewritten, 1);
    assert.equal(
      await readFile(target, "utf8"),
      interpolateModuleCode(
        testModuleContract.pinnedDocuments.teachingProcedure,
        "MH2100",
      ),
    );
    assert.match(String(report.journal), /journals\/pinned-documents\//u);
    const events = (await readFile(report.journal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const backup = events.find(({ type }) => type === "intent")?.backup;
    assert.equal(await readFile(backup, "utf8"), "# Edited in the module\n");
  });

  it("refreshes only one Research project's shared controls with an original backup", async () => {
    const fixture = await cohortFixture();
    const target = join(fixture.researchRoot, "AGENTS.md");
    await writeFile(target, "# Local stale router\n", "utf8");

    const preview = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--json",
    );
    assert.equal(preview.exitCode, 1, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).rewrites.length, 1);
    assert.equal(await readFile(target, "utf8"), "# Local stale router\n");

    const applied = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--apply",
      "--json",
    );
    assert.equal(applied.exitCode, 0, applied.stderr);
    const report = JSON.parse(applied.stdout);
    assert.deepEqual(report.target, {
      kind: "research-project",
      key: "example-project",
    });
    assert.equal(report.rewritten, 1);
    const events = (await readFile(report.journal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const backup = events.find(({ type }) => type === "intent")?.backup;
    assert.equal(await readFile(backup, "utf8"), "# Local stale router\n");
  });

  it("names the stale copy in human output and stops without --apply", async () => {
    const fixture = await cohortFixture();
    await writeFile(
      join(fixture.moduleRoots.get("CC0006") ?? "", teachingProcedure),
      "# Edited in the module\n",
      "utf8",
    );

    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
    );

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.match(result.stdout, /Pinned document refresh: stale \(preview\)/u);
    assert.match(
      result.stdout,
      /Rewrite CC0006 docs\/20 Teaching Procedure\.md/u,
    );
    assert.match(result.stdout, /Preview only\. Re-run with --apply\./u);
  });

  it("reports a module it cannot read without hiding what the others owe", async () => {
    const fixture = await cohortFixture();
    await rm(fixture.moduleRoots.get("MH2100") ?? "", { recursive: true });
    await writeFile(
      join(fixture.moduleRoots.get("CC0006") ?? "", teachingProcedure),
      "# Edited in the module\n",
      "utf8",
    );

    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.unresolved.length, 1);
    assert.equal(report.unresolved[0].module, "MH2100");
    assert.equal(report.rewrites.length, 1);
    assert.equal(report.rewrites[0].module, "CC0006");
    assert.deepEqual(report.counts, { current: 6, stale: 1, missing: 0 });
  });

  it("rejects an unknown flag rather than guessing", async () => {
    const fixture = await cohortFixture();

    const result = await runCli(
      "pinned",
      "refresh",
      "--config",
      fixture.configPath,
      "--force",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(
      result.stderr + result.stdout,
      /Unexpected argument: --force/u,
    );
  });
});
