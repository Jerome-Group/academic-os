import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { createFileWeeklyEvidenceStore } from "../../src/routine/file-weekly-evidence.js";
import { createFileRoutineArtifactStore } from "../../src/routine/file-routine-artifacts.js";

it("keeps private immutable migration evidence outside ordinary retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-weekly-evidence-"));
  try {
    const store = createFileWeeklyEvidenceStore(root);
    const snapshot = {
      number: 42,
      title: "Synthetic incident",
      body: "synthetic private evidence",
      reason: "weekly-transfer" as const,
    };
    await store.archiveIssue(snapshot);
    await store.archiveIssue(snapshot);
    const directory = join(root, "weekly-evidence");
    const files = await readdir(directory);
    assert.equal(files.length, 2);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    for (const file of files) {
      assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
      assert.equal(
        JSON.parse(await readFile(join(directory, file), "utf8")).body,
        snapshot.body,
      );
    }
    const routine = createFileRoutineArtifactStore(root);
    await routine.writeReport({
      date: "2000-01-01",
      text: "synthetic expired report",
    });
    await routine.removeReport("2000-01-01");
    assert.deepEqual(await readdir(directory), files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses aliased or shared weekly evidence directories", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "academic-weekly-evidence-refusal-"),
  );
  try {
    const outside = join(root, "outside");
    await mkdir(outside);
    const directory = join(root, "weekly-evidence");
    await symlink(outside, directory);
    const store = createFileWeeklyEvidenceStore(root);
    const snapshot = {
      number: 42,
      title: "Synthetic",
      body: "synthetic",
      reason: "weekly-transfer" as const,
    };
    await assert.rejects(
      store.archiveIssue(snapshot),
      /private ordinary directories/u,
    );
    assert.deepEqual(await readdir(outside), []);
    await rm(directory);
    await mkdir(directory, { mode: 0o755 });
    await assert.rejects(
      store.archiveIssue(snapshot),
      /private ordinary directories/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
