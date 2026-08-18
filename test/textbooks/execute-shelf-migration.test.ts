import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createFileShelfIndexStore,
  createFileShelfMigrationJournal,
  createFileShelfRenamer,
  executeShelfMigration,
  type ShelfIndexAppend,
  type ShelfMigrationJournal,
  type ShelfMigrationPlan,
  type ShelfRenamer,
} from "../../src/textbooks/index.js";

const axler = "Linear Algebra Done Right 4e Axler.pdf";
const append: ShelfIndexAppend = {
  key: "Axler",
  entry: {
    file: axler,
    title: "Linear Algebra Done Right",
    edition: "4e",
    authors: ["Axler"],
    sha256: "b".repeat(64),
  },
};

describe("the shelf migration executor", () => {
  it("touches nothing while previewing, and reports what it would do", async () => {
    const shelf = recordingRenamer();
    const store = recordingStore();

    const report = await executeShelfMigration({
      plan: planOf({
        renames: [{ from: "old.pdf", to: axler }],
        appends: [append],
      }),
      renamer: shelf,
      store,
      journal: recordingJournal(),
      mode: "preview",
    });

    assert.equal(report.outcome, "previewed");
    assert.equal(report.index, "not-written");
    assert.deepEqual(report.renames, [{ from: "old.pdf", to: axler }]);
    assert.deepEqual(report.appends, [{ key: "Axler", file: axler }]);
    assert.deepEqual(shelf.renamed, []);
    assert.deepEqual(store.appended, []);
  });

  it("refuses to move a book while the sheet still has something to settle", async () => {
    const shelf = recordingRenamer();
    const store = recordingStore();

    const report = await executeShelfMigration({
      plan: planOf({
        renames: [{ from: "old.pdf", to: axler }],
        appends: [append],
        blockers: [`${axler} has no settled Book key.`],
      }),
      renamer: shelf,
      store,
      journal: recordingJournal(),
      mode: "apply",
    });

    assert.equal(report.outcome, "requires-decision");
    assert.deepEqual(shelf.renamed, []);
    assert.deepEqual(store.appended, []);
  });

  it("renames before it indexes, because the index records final filenames", async () => {
    const journal = recordingJournal();
    const shelf = recordingRenamer();
    const store = recordingStore();

    const report = await executeShelfMigration({
      plan: planOf({
        renames: [{ from: "old.pdf", to: axler }],
        appends: [append],
      }),
      renamer: shelf,
      store,
      journal,
      mode: "apply",
    });

    assert.equal(report.outcome, "migrated");
    assert.equal(report.index, "written");
    assert.deepEqual(shelf.renamed, [{ from: "old.pdf", to: axler }]);
    assert.deepEqual(store.appended, [append]);
    assert.deepEqual(
      journal.events.map(({ type }) => type),
      ["started", "renamed", "indexed"],
    );
  });

  it("journals the renames that happened when one of them fails", async () => {
    const journal = recordingJournal();
    const shelf = recordingRenamer(new Set(["second.pdf"]));
    const store = recordingStore();

    await assert.rejects(
      executeShelfMigration({
        plan: planOf({
          renames: [
            { from: "first.pdf", to: axler },
            { from: "second.pdf", to: "Analysis I 4e Tao.pdf" },
          ],
          appends: [append],
        }),
        renamer: shelf,
        store,
        journal,
        mode: "apply",
      }),
    );

    assert.deepEqual(shelf.renamed, [{ from: "first.pdf", to: axler }]);
    assert.deepEqual(store.appended, []);
    assert.deepEqual(
      journal.events.map(({ type }) => type),
      ["started", "renamed", "failed"],
    );
  });
});

describe("the file shelf renamer", () => {
  it("renames a book on the shelf", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    await writeFile(join(shelf, "old.pdf"), "book");

    await createFileShelfRenamer(shelf).rename({ from: "old.pdf", to: axler });

    assert.deepEqual(await readdir(shelf), [axler]);
  });

  it("refuses a target something on the shelf already carries", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    await writeFile(join(shelf, "old.pdf"), "book");
    await writeFile(join(shelf, axler), "another book");

    await assert.rejects(
      createFileShelfRenamer(shelf).rename({ from: "old.pdf", to: axler }),
      /already named/u,
    );
    assert.equal(await readFile(join(shelf, axler), "utf8"), "another book");
  });

  it("refuses a source that is no longer on the shelf", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));

    await assert.rejects(
      createFileShelfRenamer(shelf).rename({ from: "old.pdf", to: axler }),
      /no longer on the shelf/u,
    );
  });

  it("refuses a name that is not a book directly on the shelf", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    await writeFile(join(shelf, "old.pdf"), "book");

    await assert.rejects(
      createFileShelfRenamer(shelf).rename({
        from: "old.pdf",
        to: `../${axler}`,
      }),
      /directly on the shelf/u,
    );
  });
});

describe("the file shelf migration journal", () => {
  it("records every event as its own line under the private state root", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "academic-os-state-"));
    const journal = createFileShelfMigrationJournal(stateRoot);

    await journal.record({ type: "started", renames: [], keys: ["Axler"] });
    await journal.record({ type: "renamed", from: "old.pdf", to: axler });

    const lines = (
      await readFile(
        join(stateRoot, "journals", "textbooks", "migration.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    assert.deepEqual(
      lines.map(({ type }) => type),
      ["started", "renamed"],
    );
  });
});

describe("the shelf migration end to end", () => {
  it("leaves the shelf renamed and the index naming the renamed files", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "academic-os-state-"));
    await writeFile(join(shelf, "old.pdf"), "book");

    await executeShelfMigration({
      plan: planOf({
        renames: [{ from: "old.pdf", to: axler }],
        appends: [append],
      }),
      renamer: createFileShelfRenamer(shelf),
      store: createFileShelfIndexStore(shelf),
      journal: createFileShelfMigrationJournal(stateRoot),
      mode: "apply",
    });

    assert.deepEqual((await readdir(shelf)).sort(), ["00 Index.yaml", axler]);
    assert.match(
      await readFile(join(shelf, "00 Index.yaml"), "utf8"),
      /Axler:\n {4}file: Linear Algebra Done Right 4e Axler\.pdf/u,
    );
  });
});

function planOf(
  plan: Partial<ShelfMigrationPlan> & Pick<ShelfMigrationPlan, "appends">,
): ShelfMigrationPlan {
  return {
    counts: { books: plan.appends.length },
    renames: [],
    blockers: [],
    ...plan,
  };
}

function recordingRenamer(
  refuse: ReadonlySet<string> = new Set(),
): ShelfRenamer & { renamed: Array<{ from: string; to: string }> } {
  const renamed: Array<{ from: string; to: string }> = [];
  return {
    renamed,
    rename: async ({ from, to }) => {
      if (refuse.has(from)) throw new Error(`Refused: ${from}.`);
      renamed.push({ from, to });
    },
  };
}

function recordingStore(): ReturnType<typeof createFileShelfIndexStore> & {
  appended: ShelfIndexAppend[];
} {
  const appended: ShelfIndexAppend[] = [];
  return {
    appended,
    read: async () => ({ books: {} }),
    append: async (appends) => {
      appended.push(...appends);
    },
  };
}

function recordingJournal(): ShelfMigrationJournal & {
  events: Array<{ type: string }>;
} {
  const events: Array<{ type: string }> = [];
  return {
    events,
    record: async (event) => {
      events.push(event);
    },
  };
}
