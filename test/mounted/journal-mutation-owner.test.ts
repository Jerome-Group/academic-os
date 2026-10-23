import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { withJournalMutationOwner } from "../../src/journal-mutation-owner.js";
import { journalFixture, journalProcess } from "../support/journal-process.js";

const driver = fileURLToPath(
  new URL("../support/journal-owner-child.js", import.meta.url),
);
const preload = fileURLToPath(
  new URL(
    "../../../test/support/journal-ownership-preload.mjs",
    import.meta.url,
  ),
);

test("same-process busy close preserves the owner against another process and another journal remains independent", async (t) => {
  const root = await journalFixture(t, "same-process");
  const journalPath = join(root, "journals", "one.jsonl");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const owner = withJournalMutationOwner(
    { stateRoot: root, journalPath },
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  await entered.promise;
  try {
    assert.equal(
      (
        await withJournalMutationOwner(
          { stateRoot: root, journalPath },
          async () => assert.fail("busy callback"),
        )
      ).kind,
      "refused",
    );
    const contender = await journalProcess(t, root, "third-process", [
      driver,
      root,
      journalPath,
      "try",
    ]).done;
    assert.equal(contender.code, 0, contender.stderr);
    assert.equal(JSON.parse(contender.stdout).reason, "busy");
    assert.equal(
      (
        await withJournalMutationOwner(
          { stateRoot: root, journalPath: join(root, "other.jsonl") },
          async () => "independent",
        )
      ).kind,
      "owned",
    );
    const alias = join(root, "alias");
    await symlink(root, alias, "dir");
    assert.equal(
      (
        await withJournalMutationOwner(
          {
            stateRoot: alias,
            journalPath: join(alias, "journals", "one.jsonl"),
          },
          async () => assert.fail("alias callback"),
        )
      ).kind,
      "refused",
    );
  } finally {
    release.resolve();
    await owner;
  }
  await assert.rejects(
    withJournalMutationOwner({ stateRoot: root, journalPath }, async () => {
      throw Object.assign(new Error("callback busy"), { errcode: 5 });
    }),
    /callback busy/u,
  );
  assert.equal(
    (
      await withJournalMutationOwner(
        { stateRoot: root, journalPath },
        async () => "retry",
      )
    ).kind,
    "owned",
  );
});

test("a stopped owner stays busy and observed process death permits a fresh owner without stale cleanup", async (t) => {
  const root = await journalFixture(t, "death");
  const journal = join(root, "journal.jsonl");
  const owner = journalProcess(t, root, "owner", [driver, root, journal]);
  await owner.wait("held");
  owner.child.kill("SIGSTOP");
  const loser = await journalProcess(t, root, "stopped-loser", [
    driver,
    root,
    journal,
    "try",
  ]).done;
  assert.equal(JSON.parse(loser.stdout).reason, "busy");
  const before = await readdir(join(root, "journal-ownership"));
  await writeFile(
    join(root, "active-metadata.json"),
    JSON.stringify(
      await Promise.all(
        before.map(async (name) => ({
          name,
          size: (await lstat(join(root, "journal-ownership", name))).size,
        })),
      ),
    ),
  );
  owner.child.kill("SIGKILL");
  assert.equal((await owner.done).signal, "SIGKILL");
  await writeFile(
    join(root, "dead-metadata.json"),
    JSON.stringify(
      await Promise.all(
        (await readdir(join(root, "journal-ownership"))).map(async (name) => ({
          name,
          size: (await lstat(join(root, "journal-ownership", name))).size,
        })),
      ),
    ),
  );
  const next = await journalProcess(t, root, "successor", [
    driver,
    root,
    journal,
    "try",
  ]).done;
  assert.equal(JSON.parse(next.stdout).kind, "owned");
  assert.deepEqual(
    (await readdir(join(root, "journal-ownership"))).filter((name) =>
      name.endsWith(".sqlite"),
    ),
    before.filter((name) => name.endsWith(".sqlite")),
  );
  const metadata = await lstat(
    join(root, "journal-ownership", before[0] ?? "missing"),
  );
  assert.equal(metadata.size, 0);
  assert.equal(metadata.mode & 0o777, 0o600);
});

test("a cold constructor race admits exactly one of eight processes", async (t) => {
  const root = await journalFixture(t, "cold-race");
  const processes = Array.from({ length: 8 }, (_, index) =>
    journalProcess(t, root, `child-${index}`, [
      driver,
      root,
      join(root, "journal.jsonl"),
    ]),
  );
  const first = await Promise.any(
    processes.map(async (process) => {
      await process.wait("held");
      return process;
    }),
  );
  const losers = processes.filter((process) => process !== first);
  for (const process of losers) {
    const result = await process.done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).reason, "busy");
  }
  first.child.send("release");
  assert.equal(JSON.parse((await first.done).stdout).kind, "owned");
  assert.equal((await readdir(join(root, "journal-ownership"))).length, 1);
});

for (const malformed of [
  "bytes",
  "symlink",
  "directory",
  "hardlink",
  "permissions",
  "fifo",
] as const) {
  test(`preserves malformed ${malformed} sidecars without entering a callback`, async (t) => {
    const root = await journalFixture(t, malformed);
    const journalPath = join(root, "journal.jsonl");
    const directory = join(root, "journal-ownership");
    await mkdir(directory, { mode: 0o700 });
    const canonical = join(await realpath(root), "journal.jsonl");
    const sidecar = join(
      directory,
      `${createHash("sha256").update(canonical).digest("hex")}.sqlite`,
    );
    const sentinel = join(root, "sentinel");
    await writeFile(sentinel, "preserved");
    if (malformed === "bytes")
      await writeFile(sidecar, "foreign bytes", { mode: 0o600 });
    if (malformed === "symlink") await symlink(sentinel, sidecar);
    if (malformed === "directory") await mkdir(sidecar);
    if (malformed === "hardlink") await link(sentinel, sidecar);
    if (malformed === "permissions")
      await writeFile(sidecar, "", { mode: 0o400 });
    if (malformed === "fifo")
      assert.equal(spawnSync("mkfifo", [sidecar]).status, 0);
    const before = await lstat(sidecar);
    const result = await withJournalMutationOwner(
      { stateRoot: root, journalPath },
      async () => assert.fail("malformed callback"),
    );
    assert.equal(result.kind, "refused");
    assert.deepEqual(await lstat(sidecar), before);
    assert.equal(await readFile(sentinel, "utf8"), "preserved");
  });
}

test("an unsafe ownership namespace refuses without normalizing or entering it", async (t) => {
  const root = await journalFixture(t, "unsafe-namespace");
  const directory = join(root, "journal-ownership");
  await mkdir(directory, { mode: 0o755 });
  const before = await lstat(directory);
  assert.equal(
    (
      await withJournalMutationOwner(
        { stateRoot: root, journalPath: join(root, "journal.jsonl") },
        async () => assert.fail("unsafe namespace callback"),
      )
    ).kind,
    "refused",
  );
  assert.deepEqual(await lstat(directory), before);
  assert.deepEqual(await readdir(directory), []);
});

test("an observed constructor crash before chmod leaves an empty bootstrap that normalizes and acquires", async (t) => {
  const root = await journalFixture(t, "bootstrap");
  const journalPath = join(root, "journal.jsonl");
  const directory = join(root, "journal-ownership");
  await mkdir(directory, { mode: 0o700 });
  const sidecar = join(
    directory,
    `${createHash("sha256")
      .update(join(await realpath(root), "journal.jsonl"))
      .digest("hex")}.sqlite`,
  );
  const bootstrap = journalProcess(
    t,
    root,
    "bootstrap",
    ["--import", preload, driver, root, journalPath],
    { AOS_JOURNAL_POINT: "bootstrap" },
  );
  await bootstrap.wait("barrier");
  assert.equal((await lstat(sidecar)).size, 0);
  bootstrap.child.kill("SIGKILL");
  assert.equal((await bootstrap.done).signal, "SIGKILL");
  assert.equal((await lstat(sidecar)).size, 0);
  assert.equal(
    (
      await withJournalMutationOwner(
        { stateRoot: root, journalPath },
        async () => "recovered",
      )
    ).kind,
    "owned",
  );
  assert.equal((await lstat(sidecar)).mode & 0o777, 0o600);
});

test("case-folded journal names refuse before a second callback", async (t) => {
  const root = await journalFixture(t, "case-alias");
  const journalPath = join(root, "journal.jsonl");
  const alias = join(root, "JOURNAL.jsonl");
  await writeFile(journalPath, "preserved");
  const result = await withJournalMutationOwner(
    { stateRoot: root, journalPath },
    async () =>
      await withJournalMutationOwner(
        { stateRoot: root, journalPath: alias },
        async () => assert.fail("case alias callback"),
      ),
  );
  assert.equal(result.kind, "owned");
  if (result.kind === "owned") assert.equal(result.value.kind, "refused");
  assert.equal(await readFile(journalPath, "utf8"), "preserved");
});

test("identity substitution during acquisition refuses before its callback", async (t) => {
  const root = await journalFixture(t, "acquisition-identity");
  const journalPath = join(root, "journal.jsonl");
  const sentinel = join(root, "sentinel");
  await writeFile(sentinel, "preserved");
  const owner = journalProcess(
    t,
    root,
    "owner",
    ["--import", preload, driver, root, journalPath, "try"],
    { AOS_JOURNAL_POINT: "bootstrap" },
  );
  await owner.wait("barrier");
  await symlink(sentinel, journalPath);
  owner.child.send("release");
  const result = await owner.done;
  assert.equal(JSON.parse(result.stdout).reason, "unavailable");
  assert.equal(await readFile(sentinel, "utf8"), "preserved");
});

test("a release error follows executed work and cannot become an effect-free busy refusal", async (t) => {
  const root = await journalFixture(t, "release-error");
  const { DatabaseSync } = await import("node:sqlite");
  const original = DatabaseSync.prototype.exec;
  let effects = 0;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === "ROLLBACK")
      throw Object.assign(new Error("synthetic release failure"), {
        errcode: 5,
      });
    return original.call(this, sql);
  };
  try {
    await assert.rejects(
      withJournalMutationOwner(
        { stateRoot: root, journalPath: join(root, "journal.jsonl") },
        async () => {
          effects += 1;
        },
      ),
      /synthetic release failure/u,
    );
  } finally {
    DatabaseSync.prototype.exec = original;
  }
  assert.equal(effects, 1);
  assert.equal(
    (
      await withJournalMutationOwner(
        { stateRoot: root, journalPath: join(root, "journal.jsonl") },
        async () => "retry",
      )
    ).kind,
    "owned",
  );
});

for (const trap of [
  "ordinary-read-close",
  "ungated-bootstrap-close",
] as const) {
  test(`expected OS counterexample from ${trap} cancels an active SQLite lock`, async (t) => {
    const root = await journalFixture(t, trap);
    const journalPath = join(root, "journal.jsonl");
    const directory = join(root, "journal-ownership");
    await mkdir(directory, { mode: 0o700 });
    const sidecar = join(
      directory,
      `${createHash("sha256")
        .update(join(await realpath(root), "journal.jsonl"))
        .digest("hex")}.sqlite`,
    );
    const bootstrap =
      trap === "ungated-bootstrap-close"
        ? await open(sidecar, "wx", 0o600)
        : undefined;
    await withJournalMutationOwner(
      { stateRoot: root, journalPath },
      async () => {
        if (bootstrap) await bootstrap.close();
        else await readFile(sidecar);
        const contender = await journalProcess(t, root, "escaped", [
          driver,
          root,
          journalPath,
          "try",
        ]).done;
        assert.equal(
          JSON.parse(contender.stdout).kind,
          "owned",
          "ordinary descriptor close must demonstrate lost exclusivity",
        );
      },
    );
    await chmod(sidecar, 0o600);
  });
}
