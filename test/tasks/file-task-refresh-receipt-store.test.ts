import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { createFileTaskRefreshReceiptStore } from "../../src/tasks/file-task-refresh-receipt-store.js";
import type {
  TaskRefreshAttempt,
  TaskTargetIdentity,
} from "../../src/tasks/types.js";
import { journalFixture, journalProcess } from "../support/journal-process.js";

const driver = fileURLToPath(
  new URL("../support/task-refresh-receipt-child.js", import.meta.url),
);

it("a killed receipt publisher releases ownership without lock cleanup and its successor syncs publication", async (t) => {
  const root = await journalFixture(t, "task-refresh-death");
  const stateRoot = join(root, "private");
  const driveMount = join(root, "drive");
  await mkdir(stateRoot, { mode: 0o700 });
  await mkdir(driveMount);
  const target: TaskTargetIdentity = {
    kind: "module",
    key: "semester/module",
    title: "module",
  };
  const store = createFileTaskRefreshReceiptStore({
    stateRoot,
    driveMount,
    target,
  });
  const attempt: TaskRefreshAttempt = {
    schemaVersion: 1,
    target,
    listId: "list-1",
    freshness: "fresh",
    observedAt: "2026-10-28T00:00:00.000Z",
    generation: "a".repeat(64),
    providerSnapshot: "b".repeat(64),
  };
  const original = await store.record(attempt);
  const inputPath = join(root, "input.json");
  const next = {
    ...attempt,
    observedAt: "2026-10-28T00:01:00.000Z",
    generation: "c".repeat(64),
  };
  await writeFile(
    inputPath,
    JSON.stringify({ stateRoot, driveMount, target, attempt: next }),
  );
  const publisher = journalProcess(t, root, "receipt-publisher", [
    driver,
    inputPath,
    "hold",
  ]);
  await publisher.wait("receipt-owned");
  await assert.rejects(store.record(next), /Another invocation owns/u);
  assert.deepEqual(await store.read(), original);
  publisher.child.kill("SIGKILL");
  assert.equal((await publisher.done).signal, "SIGKILL");
  const directory = join(stateRoot, "task-refresh-receipts");
  assert.ok(
    (await readdir(directory)).some((name) => name.endsWith(".tmp")),
    "killed publication leaves private recovery evidence",
  );
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith(".lock")),
    false,
  );
  const successor = await journalProcess(t, root, "receipt-successor", [
    driver,
    inputPath,
  ]).done;
  assert.equal(successor.code, 0, successor.stderr);
  const result = JSON.parse(successor.stdout);
  assert.deepEqual(result.trace, ["renamed", "directory-synced"]);
  assert.equal(result.receipt.generation, next.generation);
  assert.deepEqual(await store.read(), result.receipt);
  const receipts = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  assert.equal(receipts.length, 1);
  assert.equal(
    JSON.parse(await readFile(join(directory, receipts[0] ?? ""), "utf8"))
      .generation,
    next.generation,
  );
});
