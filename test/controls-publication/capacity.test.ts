import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
  base64DecodedLength,
  canonicalBase64,
  encodePublication,
} from "../../src/controls-publication/codec.js";
import {
  futureEventEnvelope,
  maximumReceiptBytes,
  normalPostIntentKinds,
} from "../../src/controls-publication/event-envelope.js";
import { PublicationFailure } from "../../src/controls-publication/failure.js";
import { createPublicationService } from "../../src/controls-publication/index.js";
import {
  maximumEventBytes,
  maximumFileBytes,
  maximumInputBytes,
  requireFileBytes,
} from "../../src/controls-publication/limits.js";
import {
  parseBytes,
  publicationInputBase64,
  validateCreateInput,
  validateEvent,
  validatePublishInput,
  wireSchema,
} from "../../src/controls-publication/schema.js";
import { PublicationStore } from "../../src/controls-publication/store.js";
import { publicationFixture } from "./fixtures.js";

it("bounds canonical wire bytes before decode, including equal encoded lengths across the raw boundary", async () => {
  for (const length of [
    maximumInputBytes - 1,
    maximumInputBytes,
    maximumInputBytes + 1,
    maximumInputBytes + 2,
  ]) {
    const value = Buffer.alloc(length, 120).toString("base64");
    assert.equal(canonicalBase64(value), true);
    assert.equal(base64DecodedLength(value), length);
    assert.equal(publicationInputBase64(value), length <= maximumInputBytes);
    assert.equal(
      validateCreateInput({
        requestId: "boundary",
        identityBytesBase64: value,
      }),
      length <= maximumInputBytes,
    );
    assert.equal(
      validatePublishInput({
        candidateId: "candidate",
        requestId: "boundary",
        expectedHead: { kind: "absent" },
        inputBytesBase64: value,
      }),
      length <= maximumInputBytes,
    );
  }
  assert.equal(
    Buffer.alloc(maximumInputBytes).toString("base64").length,
    Buffer.alloc(maximumInputBytes + 1).toString("base64").length,
  );
  for (const value of ["Zg=", "Zh==", "Zm9=", "Zg==\n", "====", "AA=A", "éAAA"])
    assert.equal(canonicalBase64(value), false, value);
  for (const value of ["", "Zg==", "Zm8=", "Zm9v"])
    assert.equal(canonicalBase64(value), true, value);
  const raw = Buffer.alloc(maximumInputBytes + 1);
  const service = createPublicationService();
  assert.deepEqual(
    await service.create({ requestId: "oversize", identityBytes: raw }),
    {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Raw publication input exceeds 8 MiB."],
    },
  );
  assert.deepEqual(
    await service.publish({
      requestId: "oversize",
      candidateId: "candidate",
      expectedHead: { kind: "absent" },
      bundleBytes: raw,
    }),
    {
      kind: "refused",
      code: "invalid-controls",
      evidence: ["Raw publication input exceeds 8 MiB."],
    },
  );
  assert.doesNotThrow(() => requireFileBytes(maximumFileBytes));
  assert.throws(
    () => requireFileBytes(maximumFileBytes + 1),
    PublicationFailure,
  );
  const schema = JSON.stringify(wireSchema("CreateWireInput"));
  assert.match(schema, /"maxLength":11184812/u);
});

it("maintains the native and schema bounds behind the complete post-intent envelope", () => {
  const native = readFileSync(
    "src/controls-publication/native/filesystem.cc",
    "utf8",
  );
  const binding = readFileSync(
    "src/controls-publication/native/binding.cc",
    "utf8",
  );
  assert.match(native, /length > 65536/u);
  assert.match(native, /name\.size\(\) > NAME_MAX/u);
  assert.match(native, /char text\[37\]/u);
  assert.match(native, /std::string decimal\(uint64_t value\)/u);
  assert.match(binding, /number\(napi_env env, uint64_t value\)/u);
  const schema: unknown = JSON.parse(
    readFileSync(
      "src/controls-publication/schemas/publication-contract-1.schema.json",
      "utf8",
    ),
  );
  const text = JSON.stringify(schema);
  assert.match(text, /"maximum":9007199254740991/u);
  assert.match(text, /\{0,79\}/u);
  assert.match(
    text,
    /"pendingReceipt":\{"\$ref":"#\/definitions\/FrozenBytes"\},"receipt":\{"\$ref":"#\/definitions\/PublicationReceipt"\}/u,
  );
  assert.equal(maximumReceiptBytes(), 3595116);
  assert.deepEqual(Object.fromEntries(futureEventEnvelope()), {
    "temporary-reserved": 1084,
    "file-claimed": 89074,
    "receipt-ready": 4882877,
    "promotion-intent": 89284,
    "promotion-observed": 1668,
    settled: 88889,
    "orphan-attempt": 1206,
    "head-observed": 3595564,
  });
  assert.equal(normalPostIntentKinds.length + 1, 8);
  assert.ok(
    [...futureEventEnvelope().values()].every(
      (length) => length <= maximumEventBytes,
    ),
  );
});

it("includes LF in exact event admission and checks terminal offset and sequence states", () => {
  const fixture = publicationFixture();
  const record = {
    schemaVersion: 1 as const,
    kind: "candidate-reserved" as const,
    candidateId: "candidate-boundary",
    binding: {
      requestId: "boundary",
      identityBytes: {
        byteLength: 0,
        byteSha256: "f".repeat(64),
        bytesBase64: "",
      },
      releaseDigest: "f".repeat(64),
      effect: "private-generated-controls/1" as const,
    },
    aggregate: {
      kind: "module" as const,
      module: fixture.identity.module,
      moduleCode: fixture.identity.moduleCode,
    },
    target: {
      parent: {
        kind: "directory" as const,
        volumeUuid: "f".repeat(36),
        device: "1",
        inode: "1",
        birthtimeNs: "1",
      },
      rawNameBase64: "eA==",
    },
  };
  // Capacity preflight needs scalar replay state only, before any native operation.
  const store = Object.create(PublicationStore.prototype) as PublicationStore;
  Reflect.set(store, "native", { maximumFileOffset: Number.MAX_SAFE_INTEGER });
  Reflect.set(store, "ledgerLength", 0);
  Reflect.set(store, "nextSequence", 0);
  Reflect.set(store, "previousHash", null);
  const base = store.preflightRecord(record).byteLength;
  record.target.parent.volumeUuid += "A".repeat(maximumEventBytes - base - 1);
  assert.equal(store.preflightRecord(record).byteLength + 1, maximumEventBytes);
  record.target.parent.volumeUuid += "A";
  assert.throws(
    () => store.preflightRecord(record),
    (error) =>
      error instanceof PublicationFailure &&
      error.result.kind === "refused" &&
      error.result.code === "invalid-controls",
  );
  record.target.parent.volumeUuid = "f".repeat(36);
  Reflect.set(store, "nextSequence", Number.MAX_SAFE_INTEGER - 7);
  assert.doesNotThrow(() => store.requireAppendCapacity(1, 8));
  Reflect.set(store, "nextSequence", Number.MAX_SAFE_INTEGER - 6);
  assert.throws(() => store.requireAppendCapacity(1, 8), PublicationFailure);
  Reflect.set(store, "nextSequence", Number.MAX_SAFE_INTEGER);
  const bytes = store.preflightRecord(record);
  assert.equal(
    parseBytes(bytes, validateEvent).sequence,
    Number.MAX_SAFE_INTEGER,
  );
  Reflect.set(store, "nextSequence", null);
  assert.throws(() => store.preflightRecord(record), PublicationFailure);
  Reflect.set(store, "nextSequence", 0);
  Reflect.set(store, "ledgerLength", Number.MAX_SAFE_INTEGER - 1);
  assert.doesNotThrow(() => store.requireAppendCapacity(1));
  assert.throws(() => store.requireAppendCapacity(2), PublicationFailure);
  assert.ok(encodePublication(record).byteLength < maximumEventBytes);
});
