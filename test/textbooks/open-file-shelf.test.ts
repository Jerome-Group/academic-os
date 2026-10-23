import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  createFileShelfIndexReader,
  openFileShelf,
  type ShelfReview,
} from "../../src/textbooks/index.js";

const roots: string[] = [];
const final = "Linear Algebra 4e Axler.pdf";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("the sole file Shelf mutation owner", () => {
  it("previews without private or mounted writes", async () => {
    const fixture = await shelfFixture();
    const shelf = await openFileShelf(fixture);
    const report = await shelf.migrate({ review: review(), mode: "preview" });
    assert.equal(report.outcome, "previewed");
    assert.deepEqual(await readdir(fixture.stateRoot), []);
    assert.deepEqual(await readdir(fixture.shelfRoot), ["old.pdf"]);
  });

  it("requires actual native exclusive/exchange/directory sync before migration", async () => {
    assert.ok(
      ["darwin", "linux"].includes(process.platform),
      "Native Shelf CI must execute on Darwin or Linux.",
    );
    const fixture = await shelfFixture();
    const shelf = await openFileShelf(fixture);
    const report = await shelf.migrate({ review: review(), mode: "apply" });
    assert.equal(report.outcome, "migrated", JSON.stringify(report));
    assert.equal(report.index, "written");
    assert.deepEqual(report.mutation?.captures, []);
    assert.equal(
      await readFile(join(fixture.shelfRoot, final), "utf8"),
      "book",
    );
    assert.equal(
      (await createFileShelfIndexReader(fixture.shelfRoot).read()).books.Axler
        ?.sha256,
      hash("book"),
    );
    assert.equal(
      (await readdir(fixture.shelfRoot)).some((name) => name.includes("probe")),
      false,
    );
    const runId = report.mutation?.runId;
    assert.ok(runId);
    assert.equal((await shelf.reconcile({ runId })).state, "applied");
    await writeFile(
      join(fixture.shelfRoot, "00 Index.yaml"),
      `${await readFile(join(fixture.shelfRoot, "00 Index.yaml"), "utf8")}owner: retained\n`,
    );
    const retry = await shelf.migrate({ review: review(), mode: "apply" });
    assert.equal(retry.outcome, "migrated", JSON.stringify(retry));
    assert.equal(retry.index, "not-written");
    assert.match(
      await readFile(join(fixture.shelfRoot, "00 Index.yaml"), "utf8"),
      /owner: retained/u,
    );
  });

  it("preserves one original generation and later writes through its old descriptor", async () => {
    const fixture = await shelfFixture(final);
    const original = "# Owner comment\nowner: extra\nbooks: {}\n";
    const path = join(fixture.shelfRoot, "00 Index.yaml");
    await writeFile(path, original);
    const old = await open(path, "a");
    try {
      const report = await (await openFileShelf(fixture)).catchUp({
        mode: "apply",
      });
      assert.equal(report.outcome, "caught-up", JSON.stringify(report));
      const capture = report.mutation?.captures[0];
      assert.ok(capture);
      assert.equal(await readFile(capture, "utf8"), original);
      await old.writeFile("late: old-descriptor\n");
      await old.sync();
      assert.equal(
        await readFile(capture, "utf8"),
        `${original}late: old-descriptor\n`,
      );
      assert.match(await readFile(path, "utf8"), /owner: extra/u);
      assert.doesNotMatch(await readFile(path, "utf8"), /late:/u);
    } finally {
      await old.close();
    }
  });

  it("refuses a changed later reviewed source before any rename", async () => {
    const fixture = await shelfFixture();
    const second = "Analysis I Tao.pdf";
    await writeFile(join(fixture.shelfRoot, second), "changed");
    const report = await (await openFileShelf(fixture)).migrate({
      review: {
        books: [
          ...review().books,
          { file: second, sha256: hash("approved"), key: "Tao" },
        ],
      },
      mode: "apply",
    });
    assert.equal(report.outcome, "requires-decision");
    assert.equal(
      await readFile(join(fixture.shelfRoot, "old.pdf"), "utf8"),
      "book",
    );
    assert.equal(
      await readFile(join(fixture.shelfRoot, second), "utf8"),
      "changed",
    );
    assert.equal((await readdir(fixture.shelfRoot)).includes(final), false);
  });

  it("checks unchanged-name reviewed bytes", async () => {
    const fixture = await shelfFixture(final);
    const report = await (await openFileShelf(fixture)).migrate({
      review: { books: [{ file: final, sha256: hash("older"), key: "Axler" }] },
      mode: "apply",
    });
    assert.equal(report.outcome, "requires-decision");
    assert.equal(report.index, "not-written");
  });

  for (const kind of ["directory", "symlink", "invalid-utf8", "invalid-yaml"]) {
    it(`rejects a ${kind} canonical index before books move`, async () => {
      const fixture = await shelfFixture();
      const index = join(fixture.shelfRoot, "00 Index.yaml");
      if (kind === "directory") await mkdir(index);
      else if (kind === "symlink")
        await symlink(join(fixture.shelfRoot, "old.pdf"), index);
      else
        await writeFile(
          index,
          kind === "invalid-utf8" ? Buffer.from([0xff]) : "books: [",
        );
      await assert.rejects(
        (await openFileShelf(fixture)).migrate({
          review: review(),
          mode: "apply",
        }),
      );
      assert.equal(
        await readFile(join(fixture.shelfRoot, "old.pdf"), "utf8"),
        "book",
      );
    });
  }

  it("exposes readers and requests, with no unowned writer or executable plan API", async () => {
    const api = await import("../../src/textbooks/index.js");
    for (const name of [
      "createFileShelfRenamer",
      "createFileShelfIndexStore",
      "createFileShelfMigrationJournal",
      "executeShelfMigration",
      "executeShelfCatchUp",
    ])
      assert.equal(name in api, false, name);
  });
});

function review(): ShelfReview {
  return {
    books: [
      { file: "old.pdf", rename: final, sha256: hash("book"), key: "Axler" },
    ],
  };
}
async function shelfFixture(file = "old.pdf") {
  const root = await mkdtemp(join(tmpdir(), "academic-os-shelf-owner-"));
  roots.push(root);
  const shelfRoot = join(root, "shelf");
  const stateRoot = join(root, "state");
  await mkdir(shelfRoot);
  await mkdir(stateRoot);
  await writeFile(join(shelfRoot, file), "book");
  return { shelfRoot, stateRoot };
}
