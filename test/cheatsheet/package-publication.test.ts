import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { publishCheatsheetPackage } from "../../src/cheatsheet/package-publication.js";

it("refuses a replaced publication directory and preserves both directory identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-publication-swap-"));
  const staging = join(root, "staging");
  const destination = join(root, "package");
  const original = join(root, "claimed");
  try {
    await mkdir(staging);
    await writeFile(join(staging, "sheet.tex"), "proved staged source");
    let replacementIdentity = 0;
    await assert.rejects(
      publishCheatsheetPackage(staging, destination, async () => {
        await rename(destination, original);
        await mkdir(destination);
        replacementIdentity = (await stat(destination)).ino;
      }),
      /identity changed/u,
    );
    assert.equal((await stat(destination)).ino, replacementIdentity);
    assert.deepEqual(await readdir(destination), []);
    assert.equal(
      JSON.parse(
        await readFile(join(original, ".package-publication.json"), "utf8"),
      ).schemaVersion,
      1,
    );
    assert.equal(
      await readFile(join(staging, "sheet.tex"), "utf8"),
      "proved staged source",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("retains claimed partial evidence and concurrent file bytes on exclusive write failure", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "cheatsheet-publication-conflict-"),
  );
  const staging = join(root, "staging");
  const destination = join(root, "package");
  try {
    await mkdir(staging);
    await writeFile(join(staging, "sheet.tex"), "staged");
    await assert.rejects(
      publishCheatsheetPackage(staging, destination, async () => {
        await writeFile(join(destination, "sheet.tex"), "unrelated");
      }),
      /destination retained/u,
    );
    assert.equal(
      await readFile(join(destination, "sheet.tex"), "utf8"),
      "unrelated",
    );
    assert.equal(
      JSON.parse(
        await readFile(join(destination, ".package-publication.json"), "utf8"),
      ).schemaVersion,
      1,
    );
    await assert.rejects(publishCheatsheetPackage(staging, destination));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
