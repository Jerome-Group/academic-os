import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import {
  journalFixture,
  journalProcess,
  optionalBytes,
} from "../support/journal-process.js";

const childScript = "test/support/calendar-journal-child.mjs";

for (const phase of ["read", "file-sync", "directory-sync"]) {
  it(`owns the Calendar receipt through ${phase} without bootstrap takeover`, async (t) => {
    const root = await journalFixture(t, `calendar-receipt-${phase}`);
    const target = join(root, "calendar", "promotions.jsonl");
    const owner = journalProcess(t, root, "owner", [childScript, root, phase]);
    await owner.wait("held");
    const before = await optionalBytes(target);
    const competitor = journalProcess(t, root, "competitor", [
      childScript,
      root,
      "none",
    ]);
    const refused = await competitor.done;
    assert.equal(refused.code, 1, JSON.stringify(refused));
    assert.match(refused.stdout, /Another invocation owns this journal/u);
    assert.deepEqual(await optionalBytes(target), before);
    owner.child.send("release");
    const accepted = await owner.done;
    assert.equal(accepted.code, 0, JSON.stringify(accepted));
    assert.equal(JSON.parse(accepted.stdout).accepted, true);
    const retry = journalProcess(t, root, "retry", [childScript, root, "none"]);
    const repeated = await retry.done;
    assert.equal(repeated.code, 0, JSON.stringify(repeated));
    assert.equal(JSON.parse(repeated.stdout).accepted, false);
    assert.equal((await readFile(target, "utf8")).trim().split("\n").length, 1);
  });
}

it("recovers a killed Calendar receipt owner without replacing ownership files", async (t) => {
  const root = await journalFixture(t, "calendar-receipt-death");
  const owner = journalProcess(t, root, "owner", [childScript, root, "read"]);
  await owner.wait("held");
  const ownershipRoot = join(root, "journal-ownership");
  const before = (await readdir(ownershipRoot)).filter((name) =>
    name.endsWith(".sqlite"),
  );
  assert.equal(before.length, 1);
  const name = before[0];
  assert.ok(name);
  const identity = await lstat(join(ownershipRoot, name), { bigint: true });
  owner.child.kill("SIGKILL");
  assert.equal((await owner.done).signal, "SIGKILL");
  const successor = journalProcess(t, root, "successor", [
    childScript,
    root,
    "none",
  ]);
  const result = await successor.done;
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(JSON.parse(result.stdout).accepted, true);
  assert.deepEqual(
    (await readdir(ownershipRoot)).filter((name) => name.endsWith(".sqlite")),
    before,
  );
  const after = await lstat(join(ownershipRoot, name), { bigint: true });
  assert.deepEqual([after.dev, after.ino], [identity.dev, identity.ino]);
  const receipt = await readFile(
    join(root, "calendar", "promotions.jsonl"),
    "utf8",
  );
  assert.equal(receipt.trim().split("\n").length, 1);
});
