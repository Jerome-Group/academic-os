import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import {
  type CompletionCatalogOwner,
  type CompletionCatalogSnapshot,
  createPrivateCompletionCatalogStore,
} from "../../src/tasks/private-completion-catalog-store.js";

async function fixture(t: TestContext) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "completion-catalog-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "private");
  const excluded = join(parent, "excluded");
  await mkdir(root, { mode: 0o700 });
  await mkdir(excluded);
  return {
    root,
    excluded,
    store: createPrivateCompletionCatalogStore({
      stateRoot: root,
      excludedRoots: [excluded],
    }),
  };
}

function candidate(revision: number): CompletionCatalogSnapshot {
  return {
    rawJson: Buffer.from(
      ` { "revision": ${revision}, "originalAge": "2000-01-01T00:00:00Z" }\n`,
    ),
    sourceIdentity: "configured-test-producer",
    acquisitionJson: Buffer.from(
      '{ "observer": "test", "readStartedAt": "2020-01-01T00:00:00Z", "readCompletedAt": "2020-01-01T00:00:01Z" }\n',
    ),
  };
}

// A fixture producer owns this wire and revision policy; storage must not infer either.
async function validateRevision(
  next: CompletionCatalogSnapshot,
  current: CompletionCatalogSnapshot | undefined,
) {
  const parsed: unknown = JSON.parse(next.rawJson.toString("utf8"));
  assert.ok(
    typeof parsed === "object" &&
      parsed !== null &&
      "revision" in parsed &&
      typeof parsed.revision === "number",
  );
  if (current !== undefined) {
    const prior: unknown = JSON.parse(current.rawJson.toString("utf8"));
    assert.ok(
      typeof prior === "object" &&
        prior !== null &&
        "revision" in prior &&
        typeof prior.revision === "number",
    );
    if (parsed.revision < prior.revision)
      throw new Error("producer rejected older revision");
    if (
      parsed.revision === prior.revision &&
      (!next.rawJson.equals(current.rawJson) ||
        next.sourceIdentity !== current.sourceIdentity)
    )
      throw new Error("producer rejected conflicting revision");
  }
  return parsed.revision;
}

async function publish(
  store: ReturnType<typeof createPrivateCompletionCatalogStore>,
  value: CompletionCatalogSnapshot,
) {
  const result = await store.withOwner((owner) =>
    owner.publish(value, validateRevision),
  );
  assert.equal(result.kind, "owned");
  return result;
}

test("retains exact bytes and attribution across fresh store and subprocess restart", async (t) => {
  const { root, excluded, store } = await fixture(t);
  const value = candidate(1);
  await publish(store, value);
  const fresh = createPrivateCompletionCatalogStore({
    stateRoot: root,
    excludedRoots: [excluded],
  });
  await fresh.withOwner(async (owner) =>
    assert.deepEqual(await owner.read(), value),
  );
  const moduleUrl = new URL(
    "../../src/tasks/private-completion-catalog-store.js",
    import.meta.url,
  ).href;
  const script = `import {createPrivateCompletionCatalogStore} from ${JSON.stringify(moduleUrl)}; const store=createPrivateCompletionCatalogStore({stateRoot:process.argv[1],excludedRoots:[process.argv[2]]}); const result=await store.withOwner(async owner=>{const value=await owner.read();return value&&[value.rawJson.toString('base64'),value.sourceIdentity,value.acquisitionJson.toString('base64')];}); process.stdout.write(JSON.stringify(result));`;
  const restarted = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, root, excluded],
    { encoding: "utf8" },
  );
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), {
    kind: "owned",
    value: [
      value.rawJson.toString("base64"),
      value.sourceIdentity,
      value.acquisitionJson.toString("base64"),
    ],
  });
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("publication and guarded first-send share owner for entire validation and send", async (t) => {
  const { store } = await fixture(t);
  await publish(store, candidate(1));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let sent = false;
  const firstSend = store.withOwner(async (owner) => {
    const current = await owner.read();
    assert.ok(current);
    await validateRevision(current, current);
    entered.resolve();
    await release.promise;
    assert.deepEqual(await owner.read(), current);
    sent = true;
  });
  await entered.promise;
  try {
    const contender = await store.withOwner((owner) =>
      owner.publish(candidate(2), validateRevision),
    );
    assert.equal(contender.kind, "refused");
    if (contender.kind === "refused") assert.equal(contender.reason, "busy");
    assert.equal(sent, false);
  } finally {
    release.resolve();
    await firstSend;
  }
  assert.equal(sent, true);
  await publish(store, candidate(2));

  const validating = Promise.withResolvers<void>();
  const validated = Promise.withResolvers<void>();
  const publication = store.withOwner((owner) =>
    owner.publish(candidate(3), async (next, current) => {
      validating.resolve();
      await validated.promise;
      return validateRevision(next, current);
    }),
  );
  await validating.promise;
  try {
    const send = await store.withOwner(async () =>
      assert.fail("send while publication owns catalog"),
    );
    assert.equal(send.kind, "refused");
  } finally {
    validated.resolve();
    await publication;
  }
});

test("producer rejects stale/conflicting revisions and failures preserve previous storage bytes", async (t) => {
  const { root, store } = await fixture(t);
  await publish(store, candidate(2));
  const path = join(root, "completion-catalog.json");
  const previous = await readFile(path);
  await assert.rejects(publish(store, candidate(1)), /older revision/u);
  const conflicting = candidate(2);
  conflicting.rawJson = Buffer.from('{"revision":2,"different":true}');
  await assert.rejects(publish(store, conflicting), /conflicting revision/u);
  await assert.rejects(
    store.withOwner((owner) =>
      owner.publish(candidate(3), async () => {
        throw new Error("producer failed");
      }),
    ),
    /producer failed/u,
  );
  await assert.rejects(
    store.withOwner((owner) =>
      owner.publish(candidate(3), async () => {
        await chmod(root, 0o500);
      }),
    ),
    /private/u,
  );
  await chmod(root, 0o700);
  assert.deepEqual(await readFile(path), previous);
});

test("captures bytes before validator or caller mutation and expires owner capabilities", async (t) => {
  const { store } = await fixture(t);
  const original = candidate(1);
  const expected = candidate(1);
  let retained: CompletionCatalogOwner | undefined;
  await store.withOwner(async (owner) => {
    retained = owner;
    const publication = owner.publish(original, async (next) => {
      next.rawJson.fill(32);
      next.acquisitionJson.fill(32);
    });
    original.rawJson.fill(32);
    original.acquisitionJson.fill(32);
    await publication;
    assert.deepEqual(await owner.read(), expected);
  });
  assert.ok(retained);
  await assert.rejects(retained.read(), /no longer active/u);
  await assert.rejects(
    retained.publish(candidate(2), validateRevision),
    /no longer active/u,
  );
});

test("rejects unsafe roots and symlink/hardlink catalog files", async (t) => {
  const { root, excluded, store } = await fixture(t);
  const overlap = createPrivateCompletionCatalogStore({
    stateRoot: root,
    excludedRoots: [root],
  });
  await assert.rejects(
    overlap.withOwner(async () => {}),
    /overlaps/u,
  );
  const alias = join(excluded, "alias");
  await symlink(root, alias, "dir");
  const symlinkRoot = createPrivateCompletionCatalogStore({
    stateRoot: alias,
    excludedRoots: [excluded],
  });
  await assert.rejects(
    symlinkRoot.withOwner(async () => {}),
    /canonical/u,
  );
  await publish(store, candidate(1));
  const path = join(root, "completion-catalog.json");
  const linked = join(root, "linked.json");
  await link(path, linked);
  await assert.rejects(
    store.withOwner((owner) => owner.read()),
    /hardlinks/u,
  );
  await rm(linked);
  await rename(path, linked);
  await symlink(linked, path);
  assert.equal(
    (await store.withOwner((owner) => owner.read())).kind,
    "refused",
  );
});

test("bounds and validates raw bytes before invoking producer", async (t) => {
  const { store } = await fixture(t);
  const invalid = [
    Buffer.alloc(4 * 1024 * 1024 + 1),
    Buffer.from([0xff]),
    Buffer.from("invalid JSON"),
  ];
  for (const rawJson of invalid) {
    await assert.rejects(
      store.withOwner((owner) =>
        owner.publish({ ...candidate(1), rawJson }, async () =>
          assert.fail("invalid bytes reached producer"),
        ),
      ),
    );
  }
  await store.withOwner(async (owner) =>
    assert.equal(await owner.read(), undefined),
  );
});

for (const failure of ["throw", "crash", "write"]) {
  test(`retains prior immutable bytes after injected ${failure} failure`, async (t) => {
    const { root, excluded, store } = await fixture(t);
    const before = candidate(1);
    const after = candidate(2);
    await publish(store, before);
    const previousRecords = (await readdir(root)).filter((name) =>
      /^completion-catalog-[a-f0-9]{64}\.json$/u.test(name),
    );
    const oldName = previousRecords[0];
    assert.ok(oldName);
    const oldBytes = await readFile(join(root, oldName));
    const moduleUrl = new URL(
      "../../src/tasks/private-completion-catalog-store.js",
      import.meta.url,
    ).href;
    const script = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const originalOpen=fs.open; let syncs=0;
      fs.open=async (...args)=>{const file=await originalOpen(...args); if(process.argv[3]==='write' && String(args[0]).endsWith('.tmp')) file.sync=async()=>{throw new Error('injected file fsync failure');}; if(args[0]===process.argv[1]) {const sync=file.sync.bind(file); file.sync=async()=>{syncs++; if(syncs===2) {if(process.argv[3]==='crash') process.exit(47); throw new Error('injected directory fsync failure');} return sync();};} return file;};
      syncBuiltinESMExports();
      const {createPrivateCompletionCatalogStore}=await import(${JSON.stringify(moduleUrl)});
      const store=createPrivateCompletionCatalogStore({stateRoot:process.argv[1],excludedRoots:[process.argv[2]]});
      try {await store.withOwner(owner=>owner.publish({rawJson:Buffer.from(${JSON.stringify(after.rawJson.toString("base64"))},'base64'),sourceIdentity:${JSON.stringify(after.sourceIdentity)},acquisitionJson:Buffer.from(${JSON.stringify(after.acquisitionJson.toString("base64"))},'base64')},async()=>{}));process.exit(3);} catch(error) {process.stdout.write(error.message);}`;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, root, excluded, failure],
      { encoding: "utf8" },
    );
    if (failure === "crash") assert.equal(child.status, 47, child.stderr);
    else {
      assert.equal(child.status, 0, child.stderr);
      assert.match(
        child.stdout,
        failure === "write"
          ? /injected file fsync failure/u
          : /durability is uncertain/u,
      );
    }
    assert.deepEqual(await readFile(join(root, oldName)), oldBytes);
    assert.equal(
      (await readdir(root)).filter((name) =>
        /^completion-catalog-[a-f0-9]{64}\.json$/u.test(name),
      ).length,
      failure === "write" ? 1 : 2,
    );
    const result = await store.withOwner(async (owner) => {
      assert.deepEqual(
        await owner.read(),
        failure === "write" ? before : after,
      );
      return owner.publish(after, validateRevision);
    });
    assert.equal(result.kind, "owned");
  });
}

test("root replacement invalidates held owner despite identical catalog bytes", async (t) => {
  const { root, excluded, store } = await fixture(t);
  await publish(store, candidate(1));
  const moved = `${root}-original`;
  let sent = false;
  await assert.rejects(
    store.withOwner(async (owner) => {
      const before = await owner.read();
      await rename(root, moved);
      await cp(moved, root, { recursive: true });
      await chmod(root, 0o700);
      const replacement = createPrivateCompletionCatalogStore({
        stateRoot: root,
        excludedRoots: [excluded],
      });
      const concurrent = await replacement.withOwner(async (current) => {
        assert.deepEqual(await current.read(), before);
        await current.assertCurrent();
      });
      assert.equal(concurrent.kind, "owned");
      await assert.rejects(owner.read(), /root identity changed/u);
      await assert.rejects(
        owner.publish(candidate(2), validateRevision),
        /root identity changed/u,
      );
      await owner.assertCurrent();
      sent = true;
    }),
    /root identity changed/u,
  );
  assert.equal(sent, false);
});

test("root replacement during producer validation prevents publication", async (t) => {
  const { root, store } = await fixture(t);
  await publish(store, candidate(1));
  const previous = await readFile(join(root, "completion-catalog.json"));
  await assert.rejects(
    store.withOwner((owner) =>
      owner.publish(candidate(2), async () => {
        const moved = `${root}-original`;
        await rename(root, moved);
        await cp(moved, root, { recursive: true });
        await chmod(root, 0o700);
      }),
    ),
    /root identity changed/u,
  );
  assert.deepEqual(
    await readFile(join(root, "completion-catalog.json")),
    previous,
  );
});

for (const replaced of ["directory", "sidecar"]) {
  test(`ownership ${replaced} replacement invalidates held catalog scope`, async (t) => {
    const { root, excluded, store } = await fixture(t);
    await publish(store, candidate(1));
    const directory = join(root, "journal-ownership");
    let sent = false;
    await assert.rejects(
      store.withOwner(async (owner) => {
        const previous = await owner.read();
        if (replaced === "directory") {
          await rename(directory, `${directory}-original`);
          await cp(`${directory}-original`, directory, { recursive: true });
          await chmod(directory, 0o700);
        } else {
          const sidecar = (await readdir(directory)).find((name) =>
            name.endsWith(".sqlite"),
          );
          assert.ok(sidecar);
          const path = join(directory, sidecar);
          await rename(path, `${path}-original`);
          await cp(`${path}-original`, path);
          await chmod(path, 0o600);
        }
        const replacement = createPrivateCompletionCatalogStore({
          stateRoot: root,
          excludedRoots: [excluded],
        });
        assert.equal(
          (
            await replacement.withOwner(async (current) => {
              assert.deepEqual(await current.read(), previous);
              await current.assertCurrent();
            })
          ).kind,
          "owned",
        );
        await assert.rejects(owner.read(), /ownership.*identity changed/u);
        await assert.rejects(
          owner.publish(candidate(2), validateRevision),
          /ownership.*identity changed/u,
        );
        await owner.assertCurrent();
        sent = true;
      }),
      /ownership.*identity changed/u,
    );
    assert.equal(sent, false);
  });
}
