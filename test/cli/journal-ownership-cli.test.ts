import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  journalFixture,
  journalProcess,
  optionalBytes,
} from "../support/journal-process.js";
import { journalSeedFixture } from "../support/journal-seed-fixture.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const preload = fileURLToPath(
  new URL(
    "../../../test/support/journal-ownership-preload.mjs",
    import.meta.url,
  ),
);

for (const kind of ["module", "research"] as const) {
  for (const point of [
    "read",
    "staging",
    "publication",
    "cleanup",
    "outcome-sync",
  ]) {
    test(`${kind} CLI owns continuation through ${point} and refuses a competing resume without effects`, async (t) => {
      const root = await journalFixture(t, `${kind}-${point}`);
      const fixture = await journalSeedFixture(root, kind);
      const preview = await journalProcess(t, root, "preview", [
        cli,
        ...fixture.args,
      ]).done;
      assert.equal(
        JSON.parse(preview.stdout).outcome,
        "preview",
        preview.stderr,
      );
      assert.deepEqual(await readdir(fixture.stateRoot), []);
      const owner = journalProcess(
        t,
        root,
        "owner",
        ["--import", preload, cli, ...fixture.args, "--apply"],
        {
          AOS_JOURNAL_POINT: point,
          AOS_JOURNAL_MOUNT: fixture.driveMount,
          AOS_JOURNAL_TRACE: join(root, "owner.trace"),
        },
      );
      await owner.wait("barrier");
      const before = await productSnapshot(fixture);
      await writeFile(join(root, "before-loser.json"), JSON.stringify(before));
      const loser = await journalProcess(
        t,
        root,
        "loser",
        ["--import", preload, cli, ...fixture.args, "--apply", "--resume"],
        {
          AOS_JOURNAL_MOUNT: fixture.driveMount,
          AOS_JOURNAL_TRACE: join(root, "loser.trace"),
        },
      ).done;
      assert.equal(loser.code, 1, loser.stderr);
      assert.match(
        JSON.parse(loser.stdout).evidence.join(" "),
        /another invocation owns/iu,
      );
      assert.deepEqual(await productSnapshot(fixture), before);
      assert.equal(
        (await optionalBytes(join(root, "loser.trace"))).length,
        0,
        "loser must not read continuation or perform mounted/journal effects",
      );
      owner.child.send("release");
      const completed = await owner.done;
      assert.equal(
        completed.code,
        0,
        `${completed.stderr}\n${completed.stdout}`,
      );
      assert.equal(JSON.parse(completed.stdout).outcome, "completed");
      const journal = await onlyJournal(fixture.stateRoot);
      assertContiguous(journal);
      const repeated = await journalProcess(t, root, "completed-repeat", [
        cli,
        ...fixture.args,
        "--apply",
        "--resume",
      ]).done;
      assert.equal(JSON.parse(repeated.stdout).outcome, "completed");
      assert.deepEqual(await onlyJournal(fixture.stateRoot), journal);
    });
  }
  test(`${kind} CLI resumes a killed durable start, preserves a stopped owner, then recovers after observed death`, async (t) => {
    const root = await journalFixture(t, `${kind}-resume-death`);
    const fixture = await journalSeedFixture(root, kind);
    const interrupted = journalProcess(
      t,
      root,
      "interrupted",
      ["--import", preload, cli, ...fixture.args, "--apply"],
      { AOS_JOURNAL_POINT: "staging", AOS_JOURNAL_MOUNT: fixture.driveMount },
    );
    await interrupted.wait("barrier");
    interrupted.child.kill("SIGKILL");
    assert.equal((await interrupted.done).signal, "SIGKILL");
    const resumed = journalProcess(
      t,
      root,
      "resumed",
      ["--import", preload, cli, ...fixture.args, "--apply", "--resume"],
      { AOS_JOURNAL_POINT: "read" },
    );
    await resumed.wait("barrier");
    resumed.child.kill("SIGSTOP");
    const before = await productSnapshot(fixture);
    const loser = await journalProcess(t, root, "stopped-loser", [
      cli,
      ...fixture.args,
      "--apply",
      "--resume",
    ]).done;
    assert.match(
      JSON.parse(loser.stdout).evidence.join(" "),
      /another invocation owns/iu,
    );
    assert.deepEqual(await productSnapshot(fixture), before);
    resumed.child.kill("SIGKILL");
    assert.equal((await resumed.done).signal, "SIGKILL");
    const next = await journalProcess(t, root, "successor", [
      cli,
      ...fixture.args,
      "--apply",
      "--resume",
    ]).done;
    assert.equal(JSON.parse(next.stdout).outcome, "completed", next.stderr);
    assertContiguous(await onlyJournal(fixture.stateRoot));
  });
}

async function onlyJournal(stateRoot: string): Promise<Buffer> {
  const directory = join(stateRoot, "journals", "seeds");
  const files = await readdir(directory).catch(() => []);
  return files.length === 0
    ? Buffer.alloc(0)
    : await readFile(join(directory, files[0] ?? "missing"));
}

function assertContiguous(bytes: Buffer): void {
  const events = String(bytes)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index),
  );
  assert.equal(events.filter((event) => event.type === "started").length, 1);
  assert.equal(events.at(-1)?.outcome, "completed");
}

async function productSnapshot(fixture: {
  stateRoot: string;
  driveMount: string;
}) {
  const mounted: Array<{
    path: string;
    inode: string;
    kind: string;
    digest: string;
  }> = [];
  async function visit(path: string): Promise<void> {
    const metadata = await lstat(path, { bigint: true });
    mounted.push({
      path,
      inode: String(metadata.ino),
      kind: metadata.isDirectory() ? "directory" : "file",
      digest: metadata.isDirectory()
        ? ""
        : createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
    });
    if (metadata.isDirectory())
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
  }
  await visit(fixture.driveMount);
  return {
    journal: (await onlyJournal(fixture.stateRoot)).toString("base64"),
    mounted,
  };
}
