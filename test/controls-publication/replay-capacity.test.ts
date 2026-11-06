import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import {
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import {
  maximumReplayAllocation,
  ReplayAllocation,
  requireReplayAccountingProfile,
  unsharedAllocation,
} from "../../src/controls-publication/replay-allocation.js";
import {
  parseBytes,
  validateMixedEvent,
} from "../../src/controls-publication/schema.js";
import { fixture } from "./native-policy-fixture.js";
import { publicationFixture } from "./fixtures.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;

function create(f: Fixture, requestId: string) {
  return f.command([
    join(f.host, "publication.mjs"),
    "create-generated-candidate",
    "--request",
    requestId,
    "--identity",
    f.identityPath,
  ]);
}

async function pad(f: Fixture, mode: "repeated" | "unique") {
  const bytes = await readFile(f.ledger);
  const events = bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => parseBytes(Buffer.from(line), validateMixedEvent));
  const projection = new ReplayAllocation();
  for (const event of events) {
    projection.retain(event.record);
    projection.addRow();
  }
  const original = events.find(
    (event) => event.record.kind === "file-claimed",
  )?.record;
  assert.ok(original?.kind === "file-claimed");
  const row = structuredClone(original);
  row.requestId = "capacity-padding";
  row.attemptId = "capacity-padding";
  row.path = "capacity-padding";
  row.file.object.inode = "999999";
  let sequence = events.length;
  const last = events.at(-1);
  assert.ok(last);
  let previous = sha256(encodePublication(last));
  let length = bytes.byteLength;
  const ledger = await open(f.ledger, "a");
  try {
    while (true) {
      row.file.metadata.aclBytesBase64 = (
        mode === "repeated" ? Buffer.alloc(65536, 120) : randomBytes(65536)
      ).toString("base64");
      if (mode === "unique") row.path = `capacity-padding-${sequence}`;
      const encoded = encodePublication({
        schemaVersion: 1,
        sequence,
        previousEventByteSha256: previous,
        record: row,
      });
      if (
        mode === "repeated" &&
        length + encoded.byteLength + 1 >= 256 * 1024 * 1024 - 2048
      ) {
        row.file.metadata.aclBytesBase64 = "";
        const empty = encodePublication({
          schemaVersion: 1,
          sequence,
          previousEventByteSha256: previous,
          record: row,
        });
        const rawLength = Math.max(
          0,
          Math.floor(
            ((256 * 1024 * 1024 - 2052 - length - empty.byteLength - 1) * 3) /
              4,
          ),
        );
        row.file.metadata.aclBytesBase64 = Buffer.alloc(
          rawLength,
          120,
        ).toString("base64");
        const final = encodePublication({
          schemaVersion: 1,
          sequence,
          previousEventByteSha256: previous,
          record: row,
        });
        projection.retain(row);
        projection.addRow();
        await ledger.write(final);
        await ledger.write("\n");
        length += final.byteLength + 1;
        sequence++;
        break;
      }
      projection.retain(row);
      projection.addRow();
      const complete =
        mode === "unique" &&
        projection.byteLength >= maximumReplayAllocation - 1024 * 1024;
      await ledger.write(encoded);
      await ledger.write("\n");
      length += encoded.byteLength + 1;
      previous = sha256(encoded);
      sequence++;
      if (complete) break;
    }
    await ledger.sync();
  } finally {
    await ledger.close();
  }
  return { mode, length, rows: sequence, allocation: projection.byteLength };
}

it("shares immutable mixed replay values while rejecting unsupported allocation profiles", () => {
  const projection = new ReplayAllocation();
  const first = projection.retain({
    kind: "test",
    nested: { value: "x".repeat(65536) },
    rows: [1, 2, 3],
  });
  const before = projection.byteLength;
  const second = projection.retain(structuredClone(first));
  assert.equal(first, second);
  assert.equal(first.nested, second.nested);
  assert.equal(projection.byteLength, before);
  assert.deepEqual(encodePublication(second), encodePublication(first));
  assert.equal(Reflect.set(second.nested, "value", "changed"), false);
  assert.throws(() =>
    requireReplayAccountingProfile("27.0.0", "15.0", "arm64"),
  );
  for (const value of [{}, [], { nested: [] }, [null, "🙂", {}, [1, 2]]]) {
    const allocation = new ReplayAllocation();
    const before = allocation.byteLength;
    allocation.retain(value);
    assert.ok(allocation.byteLength - before <= unsharedAllocation(value));
  }
});

it("replays the original near-256-MiB mixed history after public success and interrupted native recovery", {
  skip: process.platform !== "darwin",
  timeout: 300000,
}, async (context) => {
  const f = await fixture("capacity-repeated");
  context.diagnostic(`Retained capacity fixture ${f.root}`);
  const input = await f.request();
  const padding = await pad(f, "repeated");
  assert.ok(padding.length > 255 * 1024 * 1024);
  assert.ok(padding.allocation < maximumReplayAllocation / 2);
  const created = create(f, "capacity-crossing");
  assert.equal(created.status, 0, created.stdout + created.stderr);
  assert.ok((await stat(f.ledger)).size > 256 * 1024 * 1024);
  await writeFile(
    f.checkpoint,
    JSON.stringify({
      edge: "before-file-sync",
      kind: "native-source-policy-generation-settled",
      action: "kill",
    }),
  );
  const interrupted = await f.run("install-native-source-policy", input);
  assert.equal(interrupted.signal, "SIGKILL");
  const hit = JSON.parse(
    await readFile(join(f.root, "fault-hit.json"), "utf8"),
  );
  assert.equal(hit.edge, "before-file-sync");
  assert.equal(hit.kind, "native-source-policy-generation-settled");
  const retained = await readFile(f.ledger);
  await unlink(f.checkpoint);
  const resumed = await f.run("retry-native-source-policy", input.requestId);
  assert.equal(resumed.status, 0, JSON.stringify(resumed.value));
  const after = await readFile(f.ledger);
  assert.deepEqual(after.subarray(0, retained.byteLength), retained);
  const retry = create(f, "capacity-crossing");
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.deepEqual(JSON.parse(retry.stdout), JSON.parse(created.stdout));
  const nativeRetry = await f.run(
    "retry-native-source-policy",
    input.requestId,
  );
  assert.deepEqual(nativeRetry.value, resumed.value);
  await writeFile(
    join(f.root, "capacity-result.json"),
    JSON.stringify(
      {
        padding,
        beforeRecovery: retained.byteLength,
        finalLength: after.byteLength,
        created: JSON.parse(created.stdout),
        resumed: resumed.value,
        commands: f.commands,
      },
      null,
      2,
    ),
  );
});

it("refuses full generated and three-attempt native suffixes before effects while completed outputs remain accessible", {
  skip: process.platform !== "darwin",
  timeout: 300000,
}, async (context) => {
  const f = await fixture("capacity-unique");
  context.diagnostic(`Retained capacity fixture ${f.root}`);
  const input = await f.request();
  const installed = await f.run("install-native-source-policy", input);
  assert.equal(installed.status, 0, JSON.stringify(installed.value));
  const created = create(f, "completed-before-capacity");
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const padding = await pad(f, "unique");
  const before = await readFile(f.ledger);
  const namespace = join(f.anchor, "academic-os-control-publication");
  const names = await readdir(namespace, { recursive: true });
  const generated = create(f, "must-refuse-create");
  assert.equal(generated.status, 2, generated.stdout + generated.stderr);
  assert.match(generated.stdout, /complete recovery suffix.*256 MiB/u);
  assert.ok(
    typeof installed.value.generation === "object" &&
      installed.value.generation !== null &&
      "sha256" in installed.value.generation,
  );
  const native = await f.run("install-native-source-policy", {
    ...input,
    requestId: "must-refuse-native",
    expectedPriorGeneration: installed.value.generation.sha256,
    slots: [{ ...input.slots[0], sourceKey: "capacity-two" }],
  });
  assert.equal(native.status, 2, JSON.stringify(native.value));
  assert.match(native.stdout, /complete recovery suffix.*256 MiB/u);
  const bundle = join(f.root, "inputs/bundle.json");
  await writeFile(bundle, publicationFixture().bundleBytes);
  const candidateId = JSON.parse(created.stdout).candidate.candidateId;
  const published = f.command([
    join(f.host, "publication.mjs"),
    "publish-generation",
    "--request",
    "must-refuse-publication",
    "--candidate",
    candidateId,
    "--expect-absent",
    "--bundle",
    bundle,
  ]);
  assert.equal(published.status, 2, published.stdout + published.stderr);
  assert.match(published.stdout, /complete recovery suffix.*256 MiB/u);
  assert.deepEqual(await readFile(f.ledger), before);
  assert.deepEqual(await readdir(namespace, { recursive: true }), names);
  const completed = create(f, "completed-before-capacity");
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout), JSON.parse(created.stdout));
  const historical = await f.run("retry-native-source-policy", input.requestId);
  assert.equal(historical.status, 0, JSON.stringify(historical.value));
  assert.deepEqual(historical.value, installed.value);
  assert.deepEqual(await readFile(f.ledger), before);
  await writeFile(
    join(f.root, "capacity-result.json"),
    JSON.stringify(
      {
        padding,
        retainedLedgerSha256: sha256(before),
        ledgerUnchanged: true,
        outputsUnchanged: true,
        generated: JSON.parse(generated.stdout),
        native: native.value,
        published: JSON.parse(published.stdout),
        historical: historical.value,
        commands: f.commands,
      },
      null,
      2,
    ),
  );
});
