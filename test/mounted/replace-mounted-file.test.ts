import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { sha256 } from "../../src/checksum.js";
import {
  createMountedFile,
  replaceMountedFile,
} from "../../src/mounted/replace-mounted-file.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-mounted-write-"));
  temporaryRoots.push(root);
  return root;
}

const readContents = async (path: string) =>
  await readFile(path, "utf8").catch(() => undefined);

describe("replaceMountedFile", () => {
  it("replaces the bytes it was promised and leaves no temporary behind", async () => {
    const root = await temporaryRoot();
    const path = join(root, "AGENTS.md");
    await writeFile(path, "before\n", "utf8");

    await replaceMountedFile({
      path,
      contents: "after\n",
      expectedSha256: sha256("before\n"),
      readContents,
    });

    assert.equal(await readFile(path, "utf8"), "after\n");
    assert.deepEqual(await readdir(root), ["AGENTS.md"]);
  });

  it("refuses when the file changed since it was read, and writes nothing", async () => {
    const root = await temporaryRoot();
    const path = join(root, "AGENTS.md");
    await writeFile(path, "changed by somebody else\n", "utf8");

    await assert.rejects(
      replaceMountedFile({
        path,
        contents: "after\n",
        expectedSha256: sha256("before\n"),
        readContents,
      }),
      /changed after it was read/u,
    );
    assert.equal(await readFile(path, "utf8"), "changed by somebody else\n");
    assert.deepEqual(await readdir(root), ["AGENTS.md"]);
  });
});

describe("createMountedFile", () => {
  it("takes a free name", async () => {
    const root = await temporaryRoot();
    const path = join(root, "AGENTS.md");

    await createMountedFile({ path, contents: "seeded\n" });

    assert.equal(await readFile(path, "utf8"), "seeded\n");
  });

  it("refuses a name something else already holds, rather than clobbering it", async () => {
    const root = await temporaryRoot();
    const path = join(root, "AGENTS.md");
    await writeFile(path, "arrived first\n", "utf8");

    await assert.rejects(
      createMountedFile({ path, contents: "seeded\n" }),
      /the name was taken/u,
    );
    assert.equal(await readFile(path, "utf8"), "arrived first\n");
  });
});
