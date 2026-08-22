import assert from "node:assert/strict";
import {
  chmod,
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

import {
  executePinnedDocumentRewrite,
  planPinnedDocumentRewrite,
  type PinnedRewritePlan,
} from "../../src/pinned/index.js";
import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
} from "../../src/contract/pinned-documents.js";
import { testModuleContract } from "../fixtures/module-contract.js";

const temporaryRoots: string[] = [];
const teachingProcedure = pinnedDocumentPaths.teachingProcedure;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function seededBody(name: keyof typeof pinnedDocumentPaths, module: string) {
  return interpolateModuleCode(
    testModuleContract.pinnedDocuments[name],
    module,
  );
}

async function cohortTree(modules = ["MH2100"]): Promise<{
  driveMount: string;
  stateRoot: string;
  moduleRoots: Map<string, string>;
}> {
  // Resolved, because that is what `observeCohortPinnedCopies` hands the executor and macOS puts
  // the temporary directory behind a symlink.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "academic-os-pinned-")),
  );
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
      await writeFile(path, seededBody(name, module), "utf8");
    }
  }
  return { driveMount, stateRoot, moduleRoots };
}

function cohortOf(tree: {
  driveMount: string;
  stateRoot: string;
  moduleRoots: Map<string, string>;
}) {
  return { ...tree, modules: [], unresolved: [] };
}

async function planFor(
  moduleRoots: ReadonlyMap<string, string>,
): Promise<PinnedRewritePlan> {
  const modules = await Promise.all(
    [...moduleRoots.keys()].map(async (module) => ({
      module,
      semester: "Y2S1",
      controls: Object.fromEntries(
        await Promise.all(
          pinnedDocumentNames.map(async (name) => [
            name,
            await readFile(
              join(moduleRoots.get(module) ?? "", pinnedDocumentPaths[name]),
              "utf8",
            ).catch(() => undefined),
          ]),
        ),
      ),
    })),
  );
  return planPinnedDocumentRewrite({
    modules,
    pinnedDocuments: testModuleContract.pinnedDocuments,
  });
}

describe("executePinnedDocumentRewrite", () => {
  it("writes nothing in preview, and rewrites the stale copy on apply", async () => {
    const tree = await cohortTree();
    const target = join(
      tree.moduleRoots.get("MH2100") ?? "",
      teachingProcedure,
    );
    await writeFile(target, "# Edited in the module\n", "utf8");

    const preview = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "preview",
    });

    assert.equal(preview.outcome, "stale");
    assert.equal(preview.rewritten, 0);
    assert.equal(await readFile(target, "utf8"), "# Edited in the module\n");
    assert.equal(preview.journal, undefined);

    const applied = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(applied.outcome, "current");
    assert.equal(applied.rewritten, 1);
    assert.equal(
      await readFile(target, "utf8"),
      seededBody("teachingProcedure", "MH2100"),
    );
  });

  it("journals every rewrite with the checksum it replaced and the one it wrote", async () => {
    const tree = await cohortTree();
    const target = join(
      tree.moduleRoots.get("MH2100") ?? "",
      teachingProcedure,
    );
    await writeFile(target, "# Edited in the module\n", "utf8");

    const report = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    const events = (await readFile(report.journal ?? "", "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.deepEqual(
      events.map(({ type, sequence }) => [type, sequence]),
      [
        ["intent", 0],
        ["result", 1],
      ],
    );
    const [intent, result] = events;
    assert.equal(intent?.path, teachingProcedure);
    assert.equal(intent?.module, "MH2100");
    assert.match(String(intent?.from), /^[0-9a-f]{64}$/u);
    assert.match(String(intent?.to), /^[0-9a-f]{64}$/u);
    assert.notEqual(intent?.from, intent?.to);
    assert.equal(result?.outcome, "rewritten");
    assert.equal(intent?.runId, result?.runId);
  });

  it("creates a copy that was missing, and journals it with no prior checksum", async () => {
    const tree = await cohortTree();
    const target = join(
      tree.moduleRoots.get("MH2100") ?? "",
      teachingProcedure,
    );
    await rm(target);

    const report = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(report.rewritten, 1);
    assert.equal(
      await readFile(target, "utf8"),
      seededBody("teachingProcedure", "MH2100"),
    );
    const intent = JSON.parse(
      (await readFile(report.journal ?? "", "utf8")).split("\n")[0] ?? "{}",
    ) as { from: unknown };
    assert.equal(intent.from, null);
  });

  it("refuses the whole run when one target moved under the plan, writing nothing", async () => {
    const tree = await cohortTree(["CC0006", "MH2100"]);
    for (const module of ["CC0006", "MH2100"]) {
      await writeFile(
        join(tree.moduleRoots.get(module) ?? "", teachingProcedure),
        `# Edited in ${module}\n`,
        "utf8",
      );
    }
    const plan = await planFor(tree.moduleRoots);
    const moved = join(tree.moduleRoots.get("MH2100") ?? "", teachingProcedure);
    await writeFile(moved, "# Edited again, after the plan\n", "utf8");

    const report = await executePinnedDocumentRewrite({
      plan,
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.rewritten, 0);
    assert.match(report.refusals.join(" "), /MH2100/u);
    assert.equal(
      await readFile(moved, "utf8"),
      "# Edited again, after the plan\n",
    );
    assert.equal(
      await readFile(
        join(tree.moduleRoots.get("CC0006") ?? "", teachingProcedure),
        "utf8",
      ),
      "# Edited in CC0006\n",
    );
  });

  it("refuses a target that resolves outside the Drive mount", async () => {
    const tree = await cohortTree();
    const outside = join(tmpdir(), "academic-os-pinned-escape.md");
    temporaryRoots.push(outside);
    await writeFile(outside, "# Edited in the module\n", "utf8");
    const target = join(
      tree.moduleRoots.get("MH2100") ?? "",
      teachingProcedure,
    );
    await rm(target);
    await symlink(outside, target);

    const report = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.rewritten, 0);
    assert.equal(await readFile(outside, "utf8"), "# Edited in the module\n");
  });

  it("refuses a copy whose folder is not there, which is structure to seed", async () => {
    const tree = await cohortTree();
    const moduleRoot = tree.moduleRoots.get("MH2100") ?? "";
    await rm(join(moduleRoot, "docs"), { recursive: true });

    const report = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.rewritten, 0);
    assert.match(
      report.refusals.join(" "),
      /structure to seed rather than a copy to rewrite/u,
    );
    assert.equal(
      report.refusals.some((line) => line.includes(tree.driveMount)),
      false,
    );
  });

  it("says partially-rewritten when a write fails after earlier ones landed", async () => {
    const tree = await cohortTree(["CC0006", "MH2100"]);
    for (const module of ["CC0006", "MH2100"]) {
      await writeFile(
        join(tree.moduleRoots.get(module) ?? "", teachingProcedure),
        `# Edited in ${module}\n`,
        "utf8",
      );
    }
    const plan = await planFor(tree.moduleRoots);
    // CC0006 sorts first and rewrites; MH2100's folder is then made unwritable.
    const blocked = join(tree.moduleRoots.get("MH2100") ?? "", "docs");
    await chmod(blocked, 0o555);

    try {
      const report = await executePinnedDocumentRewrite({
        plan,
        cohort: cohortOf(tree),
        mode: "apply",
      });

      assert.equal(report.outcome, "partially-rewritten");
      assert.equal(report.rewritten, 1);
      assert.equal(
        await readFile(
          join(tree.moduleRoots.get("CC0006") ?? "", teachingProcedure),
          "utf8",
        ),
        seededBody("teachingProcedure", "CC0006"),
      );
      const events = (await readFile(report.journal ?? "", "utf8"))
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.deepEqual(
        events.map(({ module, type }) => [module, type]),
        [
          ["CC0006", "intent"],
          ["CC0006", "result"],
          ["MH2100", "intent"],
          ["MH2100", "refused"],
        ],
      );
    } finally {
      await chmod(blocked, 0o755);
    }
  });

  it("leaves a cohort that is already current untouched and writes no journal", async () => {
    const tree = await cohortTree(["CC0006", "MH2100"]);

    const report = await executePinnedDocumentRewrite({
      plan: await planFor(tree.moduleRoots),
      cohort: cohortOf(tree),
      mode: "apply",
    });

    assert.equal(report.outcome, "current");
    assert.equal(report.rewritten, 0);
    assert.equal(report.journal, undefined);
    assert.deepEqual(await readdir(join(tree.stateRoot)), []);
  });
});
