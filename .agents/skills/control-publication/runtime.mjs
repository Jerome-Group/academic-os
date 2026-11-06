import assert from "node:assert/strict";
import {
  copyFile,
  lstat,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { alive, decoded, hash, makeFixture, readReceipt } from "./fixture.mjs";

const expectPublished = (result) => {
  const value = decoded(result);
  assert.equal(value.kind, "published", result.stdout);
  assert.equal(result.status, 0);
  return value;
};
const candidate = (f, request) => {
  const result = f.create(request),
    value = decoded(result);
  assert.equal(value.kind, "created", result.stdout);
  return value.candidate.candidateId;
};
const refusal = (result, code) => {
  const value = decoded(result);
  assert.equal(value.kind, "refused", result.stdout);
  assert.equal(value.code, code, result.stdout);
  return value;
};
const records = async (f) => (await f.events()).map((event) => event.record);

export async function runtime(root, evidence) {
  const f = await makeFixture(root, evidence, "schedules");
  const result = {
    evidence: f.evidence,
    outcome: "running",
    schedules: [],
    coverage: [],
    readbacks: [],
  };
  try {
    const absent = f.cli(["inspect-candidate", "--candidate", "absent"]);
    refusal(absent, "unknown-candidate");
    assert.deepEqual(
      await readdir(f.anchor),
      [],
      "Absent inspect creates no gate or namespace",
    );
    await f.fault({ trace: true });
    const c = candidate(f, "initial");
    await writeFile(f.trace, "");
    const initial = expectPublished(f.publish(c, "initial-a"));
    result.readbacks.push(...(await readReceipt(f, initial.receipt)));
    await f.clear();
    const traces = (await readFile(f.trace, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const targets = new Map();
    for (const event of traces) {
      const persistence =
        event.operation === "appendExact" &&
        ["before-call", "after-call"].includes(event.edge);
      const barrier =
        ["syncFile", "syncDirectory"].includes(event.operation) &&
        [
          "before-file-sync",
          "after-file-sync",
          "before-directory-sync",
          "after-directory-sync",
        ].includes(event.edge);
      const syscall =
        [
          "createRegularExclusive",
          "createDirectoryExclusive",
          "writeExact",
          "promoteExclusive",
          "replaceHeadGuarded",
        ].includes(event.operation) &&
        [
          "before-create-regular",
          "after-create-regular",
          "before-create-directory",
          "after-create-directory",
          "before-write",
          "after-write",
          "before-truncate",
          "after-truncate",
          "before-exclusive-promote",
          "after-exclusive-promote",
          "before-head-rename",
          "after-head-rename",
        ].includes(event.edge);
      const guard =
        ["promoteExclusive", "replaceHeadGuarded", "writeExact"].includes(
          event.operation,
        ) && event.edge === "before-handle-guard";
      const readback =
        ["readBounded", "requireLocation"].includes(event.operation) &&
        ["before-call", "after-call"].includes(event.edge);
      if (persistence || barrier || syscall || guard || readback)
        targets.set(event.key, {
          ...event,
          boundary: persistence
            ? "ledger-reservation-or-claim"
            : barrier
              ? "barrier"
              : guard
                ? "guard"
                : readback
                  ? "readback"
                  : "syscall",
        });
    }
    result.coverage = [...targets.values()];
    const publicationRecords = new Set([
      "none",
      "publication-plan",
      "stage-reserved",
      "stage-claimed",
      "file-claimed",
      "promotion-intent",
      "promotion-observed",
      "temporary-reserved",
      "head-ready",
      "publication-intent",
      "head-observed",
      "receipt-ready",
      "settled",
      "directory-claimed",
    ]);
    const selected = [...targets.values()].filter((event) =>
      publicationRecords.has(event.recordKind),
    );
    let scheduleFixture;
    for (let i = 0; i < selected.length; i++) {
      if (i % 8 === 0)
        scheduleFixture = await makeFixture(root, evidence, "schedule-group");
      const g = scheduleFixture;
      const target = selected[i],
        id = `fault-${i}`,
        request = `publish-${id}`;
      const c = candidate(g, `create-${id}`);
      await g.fault({ key: target.key, mode: "kill" });
      const interrupted = g.publish(c, request);
      let hit;
      try {
        hit = JSON.parse(await readFile(g.hit, "utf8"));
      } catch {}
      if (!hit) {
        result.schedules.push({
          key: target.key,
          outcome: "not-reached",
          reason:
            "Boundary occurs only for first-generation dependency publication or candidate bootstrap",
          command: interrupted,
        });
        await g.clear();
        continue;
      }
      assert.equal(
        interrupted.signal,
        "SIGKILL",
        interrupted.stdout + interrupted.stderr,
      );
      assert.equal(hit.key, target.key);
      await writeFile(join(g.evidence, `hit-${id}.json`), JSON.stringify(hit));
      await g.clear();
      let retry = g.publish(c, request);
      for (
        let attempt = 0;
        attempt < 2 && decoded(retry).kind !== "published";
        attempt++
      )
        retry = g.publish(c, request);
      const restored = expectPublished(retry);
      result.readbacks.push(
        ...(await readReceipt(f, initial.receipt)),
        ...(await readReceipt(g, restored.receipt)),
      );
      result.schedules.push({
        key: target.key,
        outcome: "passed",
        request,
        interrupted,
        restored,
        evidence: g.evidence,
        hit: join(g.evidence, `hit-${id}.json`),
      });
      await g.save({
        schedules: result.schedules.filter(
          (schedule) => schedule.evidence === g.evidence,
        ),
      });
      await f.save(result);
    }
    const c2 = candidate(f, "two-old-heads");
    await f.fault({
      key: "appendExact|after-call|publication-plan",
      mode: "kill",
    });
    const frozen = f.publish(c2, "frozen-a");
    assert.equal(frozen.signal, "SIGKILL");
    await f.clear();
    const selectedB = expectPublished(f.publish(c2, "wins-b"));
    refusal(f.publish(c2, "frozen-a"), "stale-head");
    const freshCandidate = candidate(f, "fresh-competing-candidate");
    const supplied = {
      candidateId: freshCandidate,
      expectedHead: { kind: "absent" },
      bundleSha256: hash(await readFile(f.bundle)),
    };
    let busyB;
    const freshACommand = await f.stopped(
      f.publishArgs(freshCandidate, "fresh-a"),
      "replaceHeadGuarded|before-head-rename|publication-intent",
      async (marker) => {
        const before = await readFile(f.ledger);
        const headPath = join(
          f.anchor,
          "academic-os-control-publication/candidates",
          freshCandidate,
          "00 Module Admin/00 Module.json",
        );
        await assert.rejects(lstat(headPath), { code: "ENOENT" });
        busyB = f.publish(freshCandidate, "fresh-b");
        refusal(busyB, "busy");
        assert.equal(busyB.status, 2);
        assert.ok(alive(marker.pid));
        assert.deepEqual(await readFile(f.ledger), before);
      },
    );
    const freshA = expectPublished(freshACommand);
    assert.equal(freshA.receipt.previousHead.kind, "absent");
    const beforeFreshRetry = await readFile(f.ledger),
      staleB = f.publish(freshCandidate, "fresh-b");
    refusal(staleB, "stale-head");
    assert.equal(staleB.status, 2);
    assert.deepEqual(await readFile(f.ledger), beforeFreshRetry);
    assert.equal(hash(await readFile(f.bundle)), supplied.bundleSha256);
    assert.ok(
      !(await records(f)).some(
        (record) =>
          record.kind === "publication-plan" &&
          record.binding.requestId === "fresh-b",
      ),
    );
    const freshSameOldHead = {
      supplied,
      requestA: "fresh-a",
      requestB: "fresh-b",
      busyB,
      freshACommand,
      freshA,
      staleB,
      noCrash: true,
      noBPlan: true,
    };
    result.readbacks.push(...(await readReceipt(f, freshA.receipt)));
    const c3 = candidate(f, "pending-predecessor");
    await f.fault({
      key: "replaceHeadGuarded|after-head-rename|publication-intent",
      mode: "kill",
    });
    assert.equal(f.publish(c3, "pending-a").signal, "SIGKILL");
    await f.clear();
    const pending = (await records(f)).find(
      (record) =>
        record.kind === "publication-intent" &&
        record.requestId === "pending-a",
    );
    assert.ok(pending);
    const beforeInspect = await readFile(f.ledger);
    assert.equal(
      decoded(f.cli(["inspect-candidate", "--candidate", c3])).kind,
      "recovery-required",
    );
    assert.deepEqual(
      await readFile(f.ledger),
      beforeInspect,
      "Pending inspect does not settle",
    );
    const successor = expectPublished(
      f.publish(
        c3,
        "successor-b",
        pending.receipt.selectedHead.head.byteSha256,
      ),
    );
    const history = await records(f);
    assert.ok(
      history.findIndex(
        (record) =>
          record.kind === "settled" && record.requestId === "pending-a",
      ) <
        history.findIndex(
          (record) =>
            record.kind === "publication-plan" &&
            record.binding.requestId === "successor-b",
        ),
    );
    const retryA = expectPublished(f.publish(c3, "pending-a"));
    assert.deepEqual(retryA.receipt, pending.receipt);
    assert.equal(
      retryA.currentHead.generationId,
      successor.receipt.selectedHead.generationId,
    );
    refusal(f.publish(c2, "pending-a"), "request-conflict");
    refusal(
      f.publish(
        c3,
        "pending-a",
        successor.receipt.selectedHead.head.byteSha256,
      ),
      "request-conflict",
    );
    const altered = join(f.evidence, "inputs/altered.json");
    await writeFile(altered, f.sample("Changed binding").bundleBytes);
    refusal(f.publish(c3, "pending-a", undefined, altered), "request-conflict");
    const manifestPath = join(f.host, "src/controls-publication/release.json"),
      manifestBytes = await readFile(manifestPath);
    try {
      const manifest = JSON.parse(manifestBytes);
      manifest.sourceDigest = "a".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
      await f.bindRuntime();
      refusal(f.publish(c3, "pending-a"), "request-conflict");
    } finally {
      await writeFile(manifestPath, manifestBytes);
      await f.bindRuntime();
    }
    const settledLedger = await readFile(f.ledger);
    assert.equal(
      decoded(f.cli(["inspect-candidate", "--candidate", c3])).kind,
      "inspected",
    );
    assert.deepEqual(
      await readFile(f.ledger),
      settledLedger,
      "Settled inspect leaves ledger bytes unchanged",
    );
    const torn = Buffer.concat([
      settledLedger,
      Buffer.from('{"schemaVersion":'),
    ]);
    await writeFile(f.ledger, torn);
    assert.equal(
      decoded(f.cli(["inspect-candidate", "--candidate", c3])).kind,
      "recovery-required",
    );
    assert.deepEqual(await readFile(f.ledger), torn);
    await writeFile(f.ledger, settledLedger);
    result.p5 = {
      sameOldHead: true,
      freshSameOldHead,
      pendingBeforeSuccessor: true,
      completedARetryReportsB: true,
      candidateInputExpectationReleaseRebinding: true,
      inspectReadOnly: true,
      tornTailRetained: true,
      selectedB,
      retryA,
    };
    result.readbacks.push(
      ...(await readReceipt(f, pending.receipt, false)),
      ...(await readReceipt(f, successor.receipt)),
    );
    result.outcome = "passed";
    return result;
  } catch (error) {
    result.outcome = "failed";
    result.error = error.stack;
    throw Object.assign(error, { evidence: f.evidence });
  } finally {
    await f.clear();
    await f.save(result);
  }
}

export async function bootstrap(root, evidence) {
  const results = [];
  for (const [key, expected] of [
    ["createRegularExclusive|before-create-regular|none", "created"],
    ["createRegularExclusive|after-create-regular|none", "bootstrap-unclaimed"],
    ["appendExact|after-call|namespace-reserved", "created"],
    [
      "createDirectoryExclusive|after-create-directory|namespace-reserved",
      "bootstrap-unclaimed",
    ],
    ["appendExact|after-call|namespace-claimed", "created"],
  ]) {
    const f = await makeFixture(root, evidence, "bootstrap");
    let result = { key, evidence: f.evidence, outcome: "running" };
    try {
      await f.fault({ key, mode: "kill" });
      const first = f.create("bootstrap");
      assert.equal(first.signal, "SIGKILL", first.stdout);
      result.hit = JSON.parse(await readFile(f.hit, "utf8"));
      await f.clear();
      const retry = decoded(f.create("bootstrap"));
      if (expected === "created")
        assert.equal(retry.kind, "created", JSON.stringify(retry));
      else {
        assert.equal(retry.kind, "refused");
        assert.equal(retry.code, expected);
      }
      result = { ...result, first, retry, outcome: "passed" };
      results.push(result);
    } finally {
      await f.clear();
      await f.save(result);
    }
  }
  return results;
}

export const mutationCases = [
  {
    name: "namespace-convergence",
    mutate: (r) =>
      r(
        "src/journal-mutation-owner.ts",
        'createHash("sha256")\n        .update',
        'createHash("sha256").update(String(process.pid))\n        .update',
      ),
    scenario: "bootstrap-gate",
  },
  {
    name: "gate-lifetime",
    mutate: (r) =>
      r(
        "src/journal-mutation-owner.ts",
        'return { kind: "owned", value: await run(journalPath) };',
        'database.exec("ROLLBACK");\n    return { kind: "owned", value: await run(journalPath) };',
      ),
    scenario: "bootstrap-gate",
  },
  {
    name: "physical-claim",
    mutate: (r) =>
      r(
        "src/controls-publication/native/filesystem.cc",
        'void requireIdentity(const Identity& actual, const Identity& expected) { if (!(actual == expected)) fail("identity-changed"); }',
        "void requireIdentity(const Identity& actual, const Identity& expected) { (void)actual; (void)expected; }",
      ),
    scenario: "same-byte-file",
  },
  {
    name: "expected-head",
    mutate: (r) =>
      r(
        "src/controls-publication/publication-reader.ts",
        "  const current = currentHead(store, candidate);\n  if (",
        "  const current = currentHead(store, candidate);\n  return current;\n  if (",
      ),
    scenario: "stale-head",
  },
  {
    name: "foreign-output",
    mutate: (r) =>
      r(
        "src/controls-publication/native/filesystem.cc",
        "exclusive ? RENAME_EXCL : 0));",
        "exclusive ? 0 : 0));",
      ),
    scenario: "foreign-file",
  },
  {
    name: "complete-before-selected",
    mutate: (r) =>
      r(
        "src/controls-publication/publication-reader.ts",
        "): void {\n  for (const file of plan.files) {",
        "): void {\n  return;\n  for (const file of plan.files) {",
      ),
    scenario: "incomplete-selection",
  },
  {
    name: "predecessor-settlement",
    mutate: (r) =>
      r(
        "src/controls-publication/publication-settlement.ts",
        "  for (const intent of pendingIntents(store)) {",
        "  return;\n  for (const intent of pendingIntents(store)) {",
      ),
    scenario: "pending-successor",
  },
  {
    name: "drain-before-release",
    mutate: (r) =>
      r(
        "src/controls-publication/owner.ts",
        "            store.close();",
        "            setTimeout(() => store.close(), 20);",
      ),
    scenario: "cleanup-gate",
  },
];

async function scenario(f, name) {
  if (name === "bootstrap-gate") {
    let contender, ledgerChanged, admission, ownerAlive;
    const stopped = await f.stopped(
      [
        "create-generated-candidate",
        "--request",
        "first",
        "--identity",
        f.identity,
      ],
      "createDirectoryExclusive|before-create-directory|namespace-reserved",
      async (marker) => {
        const before = await readFile(f.ledger);
        contender = f.create("second");
        ledgerChanged = hash(await readFile(f.ledger)) !== hash(before);
        const rows = await records(f),
          reserved = rows.find(
            (record) =>
              record.kind === "candidate-reserved" &&
              record.binding.requestId === "second",
          );
        admission =
          reserved &&
          rows.find(
            (record) =>
              record.kind === "generated-candidate-admitted" &&
              record.candidateId === reserved.candidateId,
          );
        if (admission)
          assert.ok(
            (
              await lstat(
                join(
                  f.anchor,
                  "academic-os-control-publication/candidates",
                  admission.candidateId,
                ),
              )
            ).isDirectory(),
          );
        ownerAlive = alive(marker.pid);
      },
    );
    const value = decoded(contender);
    return {
      violated: ownerAlive && ledgerChanged && Boolean(admission),
      controlPassed:
        value.kind === "refused" &&
        value.code === "busy" &&
        !ledgerChanged &&
        !admission &&
        ownerAlive,
      contender,
      stopped,
      ledgerChanged,
      admission,
      ownerAlive,
    };
  }
  const c = candidate(f, "create");
  if (name === "stale-head") {
    const a = expectPublished(f.publish(c, "a"));
    const before = await readFile(f.ledger);
    const b = f.publish(c, "b");
    const value = decoded(b);
    const readbacks =
      value.kind === "published" ? await readReceipt(f, value.receipt) : [];
    return {
      violated:
        value.kind === "published" && b.status === 0 && readbacks.length > 0,
      controlPassed:
        value.kind === "refused" &&
        value.code === "stale-head" &&
        hash(await readFile(f.ledger)) === hash(before),
      a,
      b,
      readbacks,
    };
  }
  if (name === "same-byte-file") {
    const a = expectPublished(f.publish(c, "a"));
    const original = a.receipt.manifest.find(
      (file) => file.kind === "retained-input",
    );
    assert.ok(original);
    const path = join(
      f.anchor,
      "academic-os-control-publication/candidates",
      c,
      original.path,
    );
    const before = await lstat(path),
      bytes = await readFile(path);
    await rename(path, join(f.evidence, "retained-original-file"));
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    const after = await lstat(path);
    assert.notEqual(before.ino, after.ino);
    const ledgerBefore = await readFile(f.ledger);
    const replay = f.publish(c, "a");
    const value = decoded(replay);
    const readbacks =
      value.kind === "published" ? await readReceipt(f, value.receipt) : [];
    assert.equal(hash(await readFile(path)), hash(bytes));
    return {
      violated:
        value.kind === "published" &&
        replay.status === 0 &&
        value.replayed === true &&
        value.receipt.receiptId === a.receipt.receiptId &&
        readbacks.length > 0,
      controlPassed:
        value.kind === "refused" &&
        value.code === "root-replaced" &&
        hash(await readFile(f.ledger)) === hash(ledgerBefore),
      replay,
      readbacks,
      replacement: {
        beforeInode: before.ino,
        afterInode: after.ino,
        sha256: hash(bytes),
      },
    };
  }
  if (name === "foreign-file") {
    let foreign;
    const published = await f.stopped(
      f.publishArgs(c, "a"),
      "promoteExclusive|before-exclusive-promote|promotion-intent",
      async () => {
        const rows = await records(f),
          promotion = rows
            .filter((record) => record.kind === "promotion-intent")
            .at(-1);
        const source = Buffer.from(
          promotion.source.location.rawNameBase64,
          "base64",
        ).toString();
        const destination = Buffer.from(
          promotion.destination.rawNameBase64,
          "base64",
        ).toString();
        const from = join(
          f.anchor,
          "academic-os-control-publication/staging",
          source,
        );
        const to = join(
          f.anchor,
          "academic-os-control-publication/candidates",
          c,
          ".academic-os/retained-inputs",
          destination,
        );
        await copyFile(from, to);
        foreign = {
          from,
          to,
          inode: (await lstat(to)).ino,
          byteSha256: hash(await readFile(to)),
        };
      },
      2,
    );
    const value = decoded(published),
      finalInode = (await lstat(foreign.to)).ino;
    assert.equal(hash(await readFile(foreign.to)), foreign.byteSha256);
    const readbacks =
      value.kind === "published" ? await readReceipt(f, value.receipt) : [];
    return {
      violated:
        value.kind === "published" &&
        published.status === 0 &&
        finalInode !== foreign.inode &&
        readbacks.length > 0,
      controlPassed:
        value.kind === "refused" &&
        value.code === "unowned-output" &&
        finalInode === foreign.inode,
      published,
      foreign,
      finalInode,
      readbacks,
    };
  }
  if (name === "incomplete-selection") {
    let missing;
    const published = await f.stopped(
      f.publishArgs(c, "a"),
      "appendExact|after-call|publication-intent",
      async () => {
        const intent = (await records(f)).find(
          (record) =>
            record.kind === "publication-intent" && record.requestId === "a",
        );
        const file = intent.receipt.manifest.find(
          (file) => file.kind === "control",
        );
        missing = join(
          f.anchor,
          "academic-os-control-publication/candidates",
          c,
          file.path,
        );
        await rename(missing, join(f.evidence, "retained-removed-control"));
      },
    );
    const head = join(
      f.anchor,
      "academic-os-control-publication/candidates",
      c,
      "00 Module Admin/00 Module.json",
    );
    let selected = false;
    try {
      selected = (await lstat(head)).isFile();
    } catch {}
    const value = decoded(published);
    let stillMissing = false;
    try {
      await lstat(missing);
    } catch (error) {
      if (error.code === "ENOENT") stillMissing = true;
      else throw error;
    }
    return {
      violated:
        selected &&
        stillMissing &&
        value.kind === "published" &&
        published.status === 0,
      controlPassed:
        !selected &&
        stillMissing &&
        value.kind === "refused" &&
        value.code === "root-replaced",
      selected,
      missing,
      published,
    };
  }
  if (name === "pending-successor") {
    await f.fault({
      key: "replaceHeadGuarded|after-head-rename|publication-intent",
      mode: "kill",
    });
    const killed = f.publish(c, "a");
    assert.equal(killed.signal, "SIGKILL");
    await f.clear();
    const intent = (await records(f)).find(
      (record) =>
        record.kind === "publication-intent" && record.requestId === "a",
    );
    const b = f.publish(c, "b", intent.receipt.selectedHead.head.byteSha256);
    const rows = await records(f),
      settle = rows.findIndex(
        (record) => record.kind === "settled" && record.requestId === "a",
      ),
      plan = rows.findIndex(
        (record) =>
          record.kind === "publication-plan" &&
          record.binding.requestId === "b",
      );
    const value = decoded(b);
    const readbacks =
      value.kind === "published" ? await readReceipt(f, value.receipt) : [];
    return {
      violated:
        value.kind === "published" &&
        b.status === 0 &&
        plan >= 0 &&
        (settle < 0 || plan < settle) &&
        readbacks.length > 0,
      controlPassed:
        value.kind === "published" &&
        b.status === 0 &&
        settle >= 0 &&
        plan > settle &&
        readbacks.length > 0,
      b,
      settledA: settle,
      planB: plan,
      readbacks,
    };
  }
  if (name === "cleanup-gate") {
    let contender, ledgerChanged, admission, ownerAlive;
    const stopped = await f.stopped(
      f.publishArgs(c, "a"),
      "expireAndDrain|before-expiry|settled",
      async (marker) => {
        const before = await readFile(f.ledger);
        contender = f.create("contender");
        ledgerChanged = hash(await readFile(f.ledger)) !== hash(before);
        const rows = await records(f),
          reserved = rows.find(
            (record) =>
              record.kind === "candidate-reserved" &&
              record.binding.requestId === "contender",
          );
        admission =
          reserved &&
          rows.find(
            (record) =>
              record.kind === "generated-candidate-admitted" &&
              record.candidateId === reserved.candidateId,
          );
        if (admission)
          assert.ok(
            (
              await lstat(
                join(
                  f.anchor,
                  "academic-os-control-publication/candidates",
                  admission.candidateId,
                ),
              )
            ).isDirectory(),
          );
        ownerAlive = alive(marker.pid);
      },
    );
    const value = decoded(contender);
    return {
      violated:
        ownerAlive &&
        ledgerChanged &&
        Boolean(admission) &&
        value.kind === "created" &&
        contender.status === 0,
      controlPassed:
        ownerAlive &&
        !ledgerChanged &&
        !admission &&
        value.kind === "refused" &&
        value.code === "busy",
      contender,
      stopped,
      ledgerChanged,
      admission,
      ownerAlive,
    };
  }
  throw new Error(`Unknown mutation scenario ${name}`);
}

export async function mutations(root, evidence) {
  const results = [];
  for (const test of mutationCases) {
    const f = await makeFixture(
      root,
      evidence,
      `mutant-${test.name}`,
      test.mutate,
    );
    let finding;
    try {
      finding = await scenario(f, test.scenario);
      assert.equal(
        finding.violated,
        true,
        `Mutant must cause public behavioral failure ${test.name}`,
      );
    } finally {
      await f.clear();
      await f.save({ name: test.name, finding });
    }
    for (const patch of f.patches) {
      await copyFile(join(root, patch.file), join(f.source, patch.file));
      assert.equal(
        hash(await readFile(join(f.source, patch.file))),
        patch.originalSha256,
        "Exact source restored",
      );
    }
    const restored = await makeFixture(root, evidence, `restored-${test.name}`);
    let control;
    try {
      control = await scenario(restored, test.scenario);
      assert.equal(
        control.violated,
        false,
        `Restored public behavior ${test.name}`,
      );
      assert.equal(
        control.controlPassed,
        true,
        `Exact restored refusal/state ${test.name}`,
      );
    } finally {
      await restored.clear();
      await restored.save({ name: test.name, control });
    }
    results.push({
      name: test.name,
      scenario: test.scenario,
      outcome: "passed",
      mutant: f.evidence,
      restored: restored.evidence,
      finding,
      control,
    });
  }
  return results;
}

export async function streamAndLifetime(root, evidence) {
  const f = await makeFixture(root, evidence, "snapshot-lifetime");
  const c = candidate(f, "snapshot"),
    a = expectPublished(f.publish(c, "a"));
  const native = createRequire(import.meta.url)(f.addon);
  const { withJournalMutationOwner } = await import(
    pathToFileURL(join(root, "dist/src/journal-mutation-owner.js")).href
  );
  const ok = (result) => {
    assert.equal(result.kind, "ok", JSON.stringify(result));
    return result.value;
  };
  const results = {
    evidence: f.evidence,
    numeric: [],
    snapshots: [],
    expiry: [],
  };
  try {
    const owned = await withJournalMutationOwner(
      { stateRoot: f.anchor, journalPath: f.ledger },
      async () => {
        const anchor = ok(native.resolveAccountAnchor());
        ok(
          native.observeExclusionRoots({
            anchor,
            requiredRepositoryAndSourcePaths: [Buffer.from(f.source)],
          }),
        );
        const file = ok(
          native.openRegularNoFollow(
            anchor.directory,
            ok(
              native.component(
                Buffer.from("academic-os-control-publication.jsonl"),
              ),
            ),
            "read-write",
          ),
        );
        const interval = ok(native.beginIntervalUnderHeldGate(anchor));
        try {
          const original = await readFile(f.ledger),
            observed = ok(native.observe(file));
          assert.ok(original.length > 65536);
          let window = ok(native.readLedger({ kind: "first", file }));
          const chunks = [Buffer.from(window.bytes)];
          let offset = window.bytes.length;
          while (offset < window.totalLength) {
            window = ok(
              native.readLedger({
                kind: "next",
                file,
                snapshot: window.snapshot,
                offset,
              }),
            );
            assert.ok(window.bytes.length <= 65536);
            chunks.push(Buffer.from(window.bytes));
            offset += window.bytes.length;
          }
          assert.deepEqual(Buffer.concat(chunks), original);
          results.snapshots.push({
            name: "complete-stable-snapshot",
            windows: chunks.length,
            bytes: original.length,
            sha256: hash(original),
          });
          for (const value of [
            -1,
            Number.MAX_SAFE_INTEGER + 1,
            Infinity,
            0.5,
          ]) {
            const first = ok(native.readLedger({ kind: "first", file }));
            const result = native.readLedger({
              kind: "next",
              file,
              snapshot: first.snapshot,
              offset: value,
            });
            assert.equal(result.kind, "native-failure");
            results.numeric.push({ value: String(value), result });
          }
          for (const change of ["growth", "same-byte-write", "replacement"]) {
            const first = ok(native.readLedger({ kind: "first", file }));
            if (change === "replacement") {
              await rename(
                f.ledger,
                join(f.evidence, "original-ledger-retained"),
              );
              await writeFile(f.ledger, original, { mode: 0o600, flag: "wx" });
            } else
              await writeFile(
                f.ledger,
                change === "growth"
                  ? Buffer.concat([original, Buffer.from("x")])
                  : original,
              );
            const result = native.readLedger({
              kind: "next",
              file,
              snapshot: first.snapshot,
              offset: first.bytes.length,
            });
            assert.equal(result.kind, "native-failure");
            results.snapshots.push({ name: change, result });
            if (change === "replacement") {
              await rename(
                f.ledger,
                join(f.evidence, "foreign-ledger-retained"),
              );
              await rename(
                join(f.evidence, "original-ledger-retained"),
                f.ledger,
              );
            } else await writeFile(f.ledger, original);
          }
          ok(native.expireAndDrain(interval));
          const afterExpiry = native.appendExact({
            interval,
            file,
            bytes: Buffer.from("forbidden"),
            expectedObject: observed.object,
            expectedLength: original.length,
          });
          assert.equal(afterExpiry.kind, "native-failure");
          assert.equal(afterExpiry.code, "expired");
          assert.deepEqual(await readFile(f.ledger), original);
          results.expiry.push({
            name: "expired-interval-refuses-effect-with-unchanged-public-ledger",
            result: afterExpiry,
          });
        } finally {
          native.expireAndDrain(interval);
          ok(native.close(file));
          ok(native.close(anchor.directory));
        }
      },
    );
    assert.equal(owned.kind, "owned");
    results.readbacks = await readReceipt(f, a.receipt);
    results.outcome = "passed";
    return results;
  } finally {
    await f.save(results);
  }
}

export async function barrierRetries(root, evidence) {
  const results = [];
  for (const name of ["namespace", "catalog", "nested-generation"]) {
    const f = await makeFixture(root, evidence, `barrier-${name}`);
    let result = { name, evidence: f.evidence, outcome: "running" };
    try {
      let retry;
      if (name === "nested-generation") {
        const c = candidate(f, "create-nested");
        const bundle = f.sample().bundle;
        bundle.controls.find(
          (control) => control.role === "module-identity",
        ).file = "level-one/level-two/module-identity.json";
        await writeFile(f.bundle, JSON.stringify(bundle));
        await f.fault({
          key: "syncDirectory|before-directory-sync|directory-claimed",
          occurrence: 2,
          mode: "kill",
        });
        assert.equal(f.publish(c, "nested").signal, "SIGKILL");
        retry = () => f.publish(c, "nested");
      } else {
        await f.fault({
          key: `syncDirectory|before-directory-sync|${name === "namespace" ? "namespace-claimed" : "directory-claimed"}`,
          occurrence: name === "catalog" ? 4 : 1,
          mode: "kill",
        });
        assert.equal(f.create("interrupted").signal, "SIGKILL");
        retry = () => f.create("interrupted");
      }
      const rows = await records(f),
        last = rows.at(-1);
      const requiredParent =
        name === "namespace"
          ? last.namespace.location.parent
          : last.directory.location.parent;
      result.interruptedAfterDurableClaim = last;
      result.requiredParent = requiredParent;
      result.hit = JSON.parse(await readFile(f.hit, "utf8"));
      await f.fault({ trace: true });
      const retried = retry(),
        value = decoded(retried);
      assert.ok(["created", "published"].includes(value.kind), retried.stdout);
      const trace = (await readFile(f.trace, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      const parentSyncs = trace.filter(
        (event) =>
          event.operation === "syncDirectory" &&
          event.edge === "after-directory-sync" &&
          event.directoryObject !== null &&
          ["kind", "volumeUuid", "device", "inode", "birthtimeNs"].every(
            (key) => event.directoryObject[key] === requiredParent[key],
          ),
      );
      result = {
        ...result,
        retry: retried,
        actualParentSyncs: parentSyncs,
        outcome: parentSyncs.length === 0 ? "bug" : "passed",
      };
      results.push(result);
    } finally {
      await f.clear();
      await f.save(result);
    }
  }
  return results;
}

export async function orphanBoundaries(root, evidence) {
  const f = await makeFixture(root, evidence, "orphan-boundaries");
  const result = { evidence: f.evidence, outcome: "running", schedules: [] };
  try {
    for (const key of [
      "appendExact|before-call|orphan-attempt",
      "appendExact|after-call|orphan-attempt",
      "syncFile|before-file-sync|orphan-attempt",
      "syncFile|after-file-sync|orphan-attempt",
    ]) {
      const id = String(result.schedules.length),
        c = candidate(f, `create-${id}`),
        request = `orphan-${id}`;
      await f.fault({
        key: "createDirectoryExclusive|after-create-directory|stage-reserved",
        mode: "kill",
      });
      assert.equal(f.publish(c, request).signal, "SIGKILL");
      const reservation = (await records(f))
        .filter(
          (record) =>
            record.kind === "stage-reserved" && record.requestId === request,
        )
        .at(-1);
      const oldPath = join(
          f.anchor,
          "academic-os-control-publication/staging",
          reservation.attemptId,
        ),
        before = await lstat(oldPath);
      await f.fault({ key, mode: "kill" });
      const interrupted = f.publish(c, request);
      assert.equal(interrupted.signal, "SIGKILL", interrupted.stdout);
      const hit = JSON.parse(await readFile(f.hit, "utf8"));
      await f.clear();
      const restored = expectPublished(f.publish(c, request));
      const after = await lstat(oldPath);
      assert.equal(after.ino, before.ino);
      assert.deepEqual(await readdir(oldPath), []);
      assert.notEqual(
        restored.receipt.selectedHead.generationRoot.object.inode,
        String(before.ino),
      );
      assert.ok(
        (await records(f)).some(
          (record) =>
            record.kind === "orphan-attempt" &&
            record.attemptId === reservation.attemptId,
        ),
      );
      result.schedules.push({
        key,
        outcome: "passed",
        interrupted,
        hit,
        restored,
        retainedUnclaimedPath: oldPath,
        retainedInode: before.ino,
        readbacks: await readReceipt(f, restored.receipt),
      });
    }
    result.outcome = "passed";
    return result;
  } finally {
    await f.clear();
    await f.save(result);
  }
}
