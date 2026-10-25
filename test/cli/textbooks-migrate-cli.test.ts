import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseDocument } from "yaml";

import { shelfReviewSheetPath } from "../../src/textbooks/index.js";
import { runCli } from "../support/run-cli.js";

const roots: string[] = [];
const original = "Isaacs - Algebra.pdf";
const renamed = "Algebra A Graduate Course Isaacs.pdf";
const bytes = "%PDF-1.7 synthetic shelf review binding";
const sha256 = createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os textbooks sweep and migration", () => {
  it("refuses another Shelf in preview and apply without changing either Shelf or private state", async () => {
    const fixture = await setup();
    await sweepAndSettle(fixture);
    const before = await snapshot(fixture.root);
    await configure(fixture, "B");
    const preview = await migrate(fixture, false);
    const apply = await migrate(fixture, true);

    assert.deepEqual(
      [preview.exitCode, apply.exitCode],
      [2, 2],
      JSON.stringify({ preview, apply }),
    );
    for (const result of [preview, apply]) {
      assert.match(
        JSON.parse(result.stdout).error.message,
        /review sheet belongs to another Textbook Shelf/u,
      );
    }
    const after = await snapshot(fixture.root);
    delete before["config.json"];
    delete after["config.json"];
    assert.deepEqual(after, before);
  });

  for (const shelf of [undefined, "A", 23]) {
    it(`refuses an invalid review target ${JSON.stringify(shelf)} without rebinding it`, async () => {
      const fixture = await setup();
      await sweepAndSettle(fixture);
      const sheet = parseDocument(await readFile(fixture.sheet, "utf8"));
      if (shelf === undefined) sheet.delete("shelf");
      else sheet.set("shelf", shelf);
      await writeFile(fixture.sheet, sheet.toString());
      const before = await snapshot(fixture.root);
      const results = [
        await migrate(fixture, false),
        await migrate(fixture, true),
      ];

      assert.deepEqual(
        results.map(({ exitCode }) => exitCode),
        [2, 2],
        JSON.stringify(results),
      );
      for (const result of results) {
        assert.match(
          JSON.parse(result.stdout).error.message,
          /not a readable shelf review sheet/u,
        );
      }
      assert.deepEqual(await snapshot(fixture.root), before);
    });
  }

  for (const shelfRoot of ["A", "alias"]) {
    it(`migrates the settled Shelf through configured ${shelfRoot} and reconciles its exact run`, async () => {
      const fixture = await setup();
      const settled = await sweepAndSettle(fixture);
      await configure(fixture, shelfRoot);
      const before = await snapshot(fixture.root);

      const preview = await migrate(fixture, false);
      assert.equal(preview.exitCode, 0, JSON.stringify(preview));
      assert.equal(JSON.parse(preview.stdout).outcome, "previewed");
      assert.deepEqual(await snapshot(fixture.root), before);

      const applied = await migrate(fixture, true);
      assert.equal(applied.exitCode, 0, JSON.stringify(applied));
      const report = JSON.parse(applied.stdout);
      assert.equal(report.outcome, "migrated");
      assert.equal(report.index, "written");
      assert.deepEqual(report.renames, [{ from: original, to: renamed }]);
      assert.deepEqual((await readdir(fixture.shelfA)).sort(), [
        "00 Index.yaml",
        renamed,
      ]);
      assert.equal(
        await readFile(join(fixture.shelfA, renamed), "utf8"),
        bytes,
      );
      assert.deepEqual(
        parseDocument(
          await readFile(join(fixture.shelfA, "00 Index.yaml"), "utf8"),
        ).toJS(),
        {
          books: {
            Isaacs_Algebra: {
              file: renamed,
              title: "Algebra A Graduate Course",
              authors: ["Isaacs"],
              sha256,
            },
          },
        },
      );
      assert.deepEqual(await snapshot(fixture.shelfB), {
        [original]: Buffer.from(bytes).toString("hex"),
      });
      assert.equal(await readFile(fixture.sheet, "utf8"), settled);
      const journal = await readFile(report.mutation.journal, "utf8");
      assert.match(journal, /"phase":"complete"/u);
      assert.match(journal, new RegExp(report.mutation.runId, "u"));

      const reconciled = await runCli(
        "textbooks",
        "reconcile",
        "--config",
        fixture.config,
        "--run",
        report.mutation.runId,
        "--json",
      );
      assert.equal(reconciled.exitCode, 0, JSON.stringify(reconciled));
      const recovery = JSON.parse(reconciled.stdout);
      assert.equal(recovery.state, "applied");
      assert.equal(recovery.index, "written");
      assert.equal(recovery.runId, report.mutation.runId);
      assert.equal(recovery.journal, report.mutation.journal);
    });
  }
});

async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "academic-os-shelf-review-")),
  );
  roots.push(root);
  const driveMount = join(root, "drive");
  const shelfA = join(driveMount, "A");
  const shelfB = join(driveMount, "B");
  const stateRoot = join(root, "state");
  await mkdir(shelfA, { recursive: true });
  await mkdir(shelfB);
  await mkdir(stateRoot);
  await writeFile(join(shelfA, original), bytes);
  await writeFile(join(shelfB, original), bytes);
  await symlink(shelfA, join(driveMount, "alias"), "dir");
  const fixture = {
    root,
    driveMount,
    shelfA,
    shelfB,
    stateRoot,
    config: join(root, "config.json"),
    sheet: shelfReviewSheetPath(stateRoot),
  };
  await configure(fixture, "A");
  return fixture;
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function configure(fixture: Fixture, shelfRoot: string) {
  await writeFile(
    fixture.config,
    JSON.stringify({
      driveMount: fixture.driveMount,
      stateRoot: fixture.stateRoot,
      textbooks: { shelfRoot },
    }),
  );
}

async function sweepAndSettle(fixture: Fixture) {
  const result = await runCli(
    "textbooks",
    "sweep",
    "--config",
    fixture.config,
    "--json",
  );
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.counts, { books: 1, indexed: 0, settle: 1 });
  assert.equal(report.sheet, fixture.sheet);
  const sheet = parseDocument(await readFile(fixture.sheet, "utf8"));
  assert.equal(sheet.get("shelf"), fixture.shelfA);
  assert.equal(sheet.getIn(["books", 0, "sha256"]), sha256);
  sheet.setIn(["books", 0, "rename"], renamed);
  sheet.setIn(["books", 0, "key"], "Isaacs_Algebra");
  const settled = sheet.toString();
  await writeFile(fixture.sheet, settled);
  return settled;
}

async function migrate(fixture: Fixture, apply: boolean) {
  return runCli(
    "textbooks",
    "migrate",
    "--config",
    fixture.config,
    ...(apply ? ["--apply"] : []),
    "--json",
  );
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      for (const [file, contents] of Object.entries(await snapshot(path))) {
        files[join(entry.name, file)] = contents;
      }
    } else files[entry.name] = (await readFile(path)).toString("hex");
  }
  return files;
}
