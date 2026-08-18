import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createFileShelfReader } from "../../src/textbooks/index.js";

const axler = "Linear Algebra Done Right 4e Axler.pdf";

describe("the file shelf reader", () => {
  it("lists the books directly on the shelf and nothing else there", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    await writeFile(join(shelf, axler), "book");
    await writeFile(join(shelf, "00 Index.yaml"), "books: {}\n");
    await writeFile(join(shelf, ".DS_Store"), "");
    await writeFile(join(shelf, "Icon\r"), "");
    await mkdir(join(shelf, "Archive"));
    await writeFile(join(shelf, "Archive", "Retired 1e Author.pdf"), "book");

    assert.deepEqual(await createFileShelfReader(shelf).listBooks(), [axler]);
  });

  it("checksums a book by its bytes", async () => {
    const shelf = await mkdtemp(join(tmpdir(), "academic-os-shelf-"));
    await writeFile(join(shelf, axler), "book");

    assert.equal(
      await createFileShelfReader(shelf).checksum(axler),
      "92719fe0cf8cd51592af31ee8a5736d79f7273777fa3f7b70bfe993a4cd32180",
    );
  });
});
