import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

const rosen = "Discrete Mathematics and Its Applications 8e Rosen.pdf";
const cormen =
  "Introduction to Algorithms 4e Cormen, Leiserson, Rivest, Stein.pdf";
const tao = "Analysis I Tao.pdf";
const taoBytes = "%PDF-1.7 analysis";
const taoChecksum = createHash("sha256").update(taoBytes).digest("hex");

const indexedTao = [
  "books:",
  "  Tao:",
  `    file: ${tao}`,
  "    title: Analysis I",
  "    authors: [Tao]",
  "    division: Chapter # the book's own word",
  `    sha256: ${taoChecksum}`,
  "",
].join("\n");

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os textbooks catch-up", () => {
  it("previews the appends and leaves the index alone", async () => {
    const shelf = await setupShelf({
      [tao]: taoBytes,
      [rosen]: "%PDF-1.7 discrete",
      [cormen]: "%PDF-1.7 algorithms",
    });

    const result = await runCatchUp(shelf, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.command, "textbooks catch-up");
    assert.equal(report.outcome, "previewed");
    assert.equal(report.index, "unchanged");
    assert.deepEqual(report.counts, {
      books: 3,
      indexed: 1,
      appends: 2,
      parked: 0,
    });
    assert.deepEqual(report.appends, [
      { key: "Rosen", file: rosen },
      { key: "Cormen", file: cormen },
    ]);
    assert.equal(await readFile(shelf.indexPath, "utf8"), indexedTao);
  });

  it("appends the clean books, parks the rest, and never sees Archive", async () => {
    const shelf = await setupShelf({
      [tao]: taoBytes,
      [rosen]: "%PDF-1.7 discrete",
      "scan of the old one.pdf": "%PDF-1.7 scan",
      "Analysis I Terence.pdf": taoBytes,
    });
    await mkdir(join(shelf.root, "Archive"));
    await writeFile(
      join(shelf.root, "Archive", "Analysis I 1e Tao.pdf"),
      "%PDF-1.7 retired",
    );

    const result = await runCatchUp(shelf, "--apply", "--json");

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "requires-decision");
    assert.equal(report.index, "written");
    assert.deepEqual(report.counts, {
      books: 4,
      indexed: 1,
      appends: 1,
      parked: 2,
    });
    assert.deepEqual(report.appends, [{ key: "Rosen", file: rosen }]);
    assert.deepEqual(
      report.parked.map(({ file, reason }: Record<string, string>) => ({
        file,
        reason,
      })),
      [
        { file: "Analysis I Terence.pdf", reason: "checksum-duplicate" },
        { file: "scan of the old one.pdf", reason: "unparseable-name" },
      ],
    );

    const index = await readFile(shelf.indexPath, "utf8");
    assert.equal(
      index,
      [
        indexedTao.trimEnd(),
        "  Rosen:",
        `    file: ${rosen}`,
        "    title: Discrete Mathematics and Its Applications",
        "    edition: 8e",
        "    authors: [Rosen]",
        `    sha256: ${createHash("sha256").update("%PDF-1.7 discrete").digest("hex")}`,
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(index, /Archive/u);
    assert.doesNotMatch(result.stdout, /retired/u);
  });

  it("has nothing to append the second time it runs", async () => {
    const shelf = await setupShelf({
      [tao]: taoBytes,
      [rosen]: "%PDF-1.7 discrete",
    });

    const first = await runCatchUp(shelf, "--apply", "--json");
    const firstIndex = await readFile(shelf.indexPath, "utf8");
    const second = await runCatchUp(shelf, "--apply", "--json");

    assert.equal(first.exitCode, 0, JSON.stringify(first));
    assert.equal(second.exitCode, 0, JSON.stringify(second));
    const report = JSON.parse(second.stdout);
    assert.equal(report.outcome, "caught-up");
    assert.equal(report.index, "unchanged");
    assert.deepEqual(report.counts, {
      books: 2,
      indexed: 2,
      appends: 0,
      parked: 0,
    });
    assert.equal(await readFile(shelf.indexPath, "utf8"), firstIndex);
  });

  it("reports the shelf in a line a human reads", async () => {
    const shelf = await setupShelf({
      [tao]: taoBytes,
      "scan of the old one.pdf": "%PDF-1.7 scan",
    });

    const result = await runCatchUp(shelf);

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.equal(
      result.stdout,
      [
        "Textbook shelf catch-up: requires-decision",
        "2 books on the shelf; 1 already indexed, 0 to append, 1 parked",
        "Index: unchanged",
        "Park scan of the old one.pdf: unparseable-name; The filename does not follow <Title> <N>e <Author surnames, comma-separated>.pdf.",
        "",
      ].join("\n"),
    );
  });

  it("refuses a shelf the configuration does not place inside the Drive mount", async () => {
    const shelf = await setupShelf({ [tao]: taoBytes });
    await writeFile(
      shelf.configPath,
      `${JSON.stringify({
        driveMount: shelf.driveMount,
        textbooks: { shelfRoot: "../elsewhere" },
      })}\n`,
    );

    const result = await runCatchUp(shelf, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).error.code, "out-of-root");
  });
});

interface ShelfFixture {
  root: string;
  driveMount: string;
  configPath: string;
  indexPath: string;
}

async function setupShelf(
  books: Record<string, string>,
): Promise<ShelfFixture> {
  const workspace = await mkdtemp(join(tmpdir(), "academic-os-textbooks-"));
  temporaryRoots.push(workspace);
  const driveMount = join(workspace, "drive");
  const root = join(driveMount, "Modules", "Textbooks");
  await mkdir(root, { recursive: true });
  for (const [file, contents] of Object.entries(books)) {
    await writeFile(join(root, file), contents);
  }
  await writeFile(join(root, "00 Index.yaml"), indexedTao);
  const configPath = join(workspace, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      textbooks: { shelfRoot: join("Modules", "Textbooks") },
    })}\n`,
  );
  return {
    root,
    driveMount,
    configPath,
    indexPath: join(root, "00 Index.yaml"),
  };
}

async function runCatchUp(fixture: ShelfFixture, ...arguments_: string[]) {
  return await runCli(
    "textbooks",
    "catch-up",
    "--config",
    fixture.configPath,
    ...arguments_,
  );
}
