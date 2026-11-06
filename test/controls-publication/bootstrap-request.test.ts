import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { fixture } from "./native-policy-fixture.js";

for (const initialized of [false, true]) {
  it(`creates and replays public bootstrap request with ${initialized ? "initialized" : "new"} catalog`, {
    skip: process.platform !== "darwin",
    timeout: 180000,
  }, async (context) => {
    const f = await fixture("public-bootstrap-request");
    context.diagnostic(`Retained public bootstrap request fixture ${f.root}`);
    const create = (request: string) =>
      f.command([
        join(f.host, "publication.mjs"),
        "create-generated-candidate",
        "--request",
        request,
        "--identity",
        f.identityPath,
      ]);
    const identity = await readFile(f.identityPath);
    try {
      if (initialized) {
        const first = create("initialize-catalog");
        assert.equal(first.status, 0, first.stdout + first.stderr);
      }
      const created = create("bootstrap");
      assert.equal(created.status, 0, created.stdout + created.stderr);
      const value: unknown = JSON.parse(created.stdout);
      const before = await readFile(f.ledger);
      const replay = create("bootstrap");
      assert.equal(replay.status, 0, replay.stdout + replay.stderr);
      assert.deepEqual(JSON.parse(replay.stdout), value);
      assert.deepEqual(await readFile(f.ledger), before);
      assert.deepEqual(await readFile(f.identityPath), identity);
    } finally {
      await writeFile(
        join(f.root, "commands.json"),
        JSON.stringify(f.commands, null, 2),
      );
    }
  });
}
