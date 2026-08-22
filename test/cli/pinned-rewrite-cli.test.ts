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
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
} from "../../src/contract/pinned-documents.js";
import { testModuleContract } from "../fixtures/module-contract.js";
import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];
const teachingProcedure = pinnedDocumentPaths.teachingProcedure;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function cohortFixture(): Promise<{
  configPath: string;
  stateRoot: string;
  moduleRoots: Map<string, string>;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-pinned-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "state");
  await mkdir(stateRoot, { recursive: true });
  const moduleRoots = new Map<string, string>();
  for (const module of ["CC0006", "MH2100"]) {
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
          modules: ["CC0006", "MH2100"],
        },
      },
    }),
    "utf8",
  );
  return { configPath, stateRoot, moduleRoots };
}

describe("academic-os pinned rewrite", () => {
  it("reports a current cohort and exits zero", async () => {
    const fixture = await cohortFixture();

    const result = await runCli(
      "pinned",
      "rewrite",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, "pinned rewrite");
    assert.equal(report.outcome, "current");
    assert.deepEqual(report.counts, { current: 12, stale: 0, missing: 0 });
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
      "rewrite",
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
      "rewrite",
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
      "rewrite",
      "--config",
      fixture.configPath,
    );

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.match(result.stdout, /Pinned document rewrite: stale \(preview\)/u);
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
      "rewrite",
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
    assert.deepEqual(report.counts, { current: 5, stale: 1, missing: 0 });
  });

  it("rejects an unknown flag rather than guessing", async () => {
    const fixture = await cohortFixture();

    const result = await runCli(
      "pinned",
      "rewrite",
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
