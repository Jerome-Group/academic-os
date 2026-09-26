import assert from "node:assert/strict";
import * as filesystem from "node:fs/promises";
import { join, resolve } from "node:path";
import { mock } from "node:test";

const count = 135_000;
const root = resolve("fixture");
const metadata = (directory: boolean) => ({
  isFile: () => !directory,
  isDirectory: () => directory,
  isSymbolicLink: () => false,
  size: 0,
  mtime: new Date(0),
});

mock.module("node:fs/promises", {
  exports: {
    ...filesystem,
    readdir: async (path: string) =>
      path === root
        ? [{ name: "large" }]
        : Array.from({ length: count }, (_, index) => ({ name: `f${index}` })),
    lstat: async (path: string) => metadata(path === join(root, "large")),
  },
});

const { inventoryDirectory } = await import(
  "../../src/mounted/inventory-mounted-module.js"
);
const entries = await inventoryDirectory(root);
assert.equal(entries.length, count + 1);
assert.equal(entries[0]?.path, "large");
assert.equal(entries[1]?.path, "large/f0");
assert.ok(entries.slice(1).every(({ kind }) => kind === "file"));
