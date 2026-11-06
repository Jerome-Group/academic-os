import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeBundle,
  generationFiles,
  moduleAggregate,
} from "../../src/controls-publication/bundle.js";
import {
  encodePublication,
  freezeBytes,
  thawBytes,
} from "../../src/controls-publication/codec.js";
import { publicationFixture } from "./fixtures.js";

describe("publication wire bytes and complete graph", () => {
  it("encodes UTF-8 key order with preserved arrays and rejects unsupported values", () => {
    assert.equal(
      Buffer.from(
        encodePublication({ "😀": 1, "\uE000": 2, a: [2, 1] }),
      ).toString(),
      '{"a":[2,1],"":2,"😀":1}',
    );
    for (const value of [
      NaN,
      Infinity,
      -0,
      1.5,
      undefined,
      { a: undefined },
      "\ud800",
      new Date(),
    ])
      assert.throws(() => encodePublication(value));
  });
  it("binds the actual complete 18-role reader and all immutable evidence bytes", () => {
    const fixture = publicationFixture();
    const aggregate = moduleAggregate(fixture.identity);
    const bundle = decodeBundle(fixture.bundleBytes, aggregate);
    const files = generationFiles(bundle, aggregate, "generation-synthetic");
    assert.equal(bundle.controls.length, 18);
    assert.equal(
      files.filter((file) => file.kind === "retained-input").length,
      2,
    );
    assert.deepEqual(
      thawBytes(freezeBytes(fixture.bundleBytes)),
      fixture.bundleBytes,
    );
  });
  it("refuses duplicate JSON, unsafe numbers, bad byte bindings, incomplete roles and unsupported effects", () => {
    const fixture = publicationFixture();
    const aggregate = moduleAggregate(fixture.identity);
    for (const bytes of [
      Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),
      Buffer.from('{"n":1e0}'),
      Buffer.from([0xff]),
    ])
      assert.throws(() => decodeBundle(bytes, aggregate));
    const missing = structuredClone(fixture.bundle);
    missing.controls.pop();
    assert.throws(() =>
      generationFiles(
        decodeBundle(encodePublication(missing), aggregate),
        aggregate,
        "missing",
      ),
    );
    const changed = structuredClone(fixture.bundle);
    const dependency = changed.dependencies[0];
    assert.ok(dependency);
    dependency.bytes.byteSha256 = "0".repeat(64);
    assert.throws(() => decodeBundle(encodePublication(changed), aggregate));
    assert.throws(() =>
      decodeBundle(
        encodePublication({
          ...fixture.bundle,
          nativeArtifactEffects: [{ path: "foreign" }],
        }),
        aggregate,
      ),
    );
  });
});
