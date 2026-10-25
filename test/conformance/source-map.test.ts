import assert from "node:assert/strict";
import { it } from "node:test";
import { parseDocument } from "yaml";

import { readControlDocument } from "../../src/conformance/control-document.js";
import { readSourceMap } from "../../src/conformance/source-map.js";
import { isRecord } from "../../src/conformance/value-shape.js";
import {
  collidingSourceMaps,
  identityUnit,
  nativeObjectSourceMap,
  nativeObjectUnits,
  orderedSourceMap,
  orderedUnits,
} from "../fixtures/source-map-identity.js";

const unit = identityUnit;
const compatibleMaps: ReadonlyArray<{
  name: string;
  source: string;
  expected: readonly (readonly [string, string])[];
}> = [
  {
    name: "mixed names and numbers",
    source: orderedSourceMap,
    expected: orderedUnits,
  },
  {
    name: "Date merge and raw alias",
    source: nativeObjectSourceMap,
    expected: nativeObjectUnits,
  },
  {
    name: "root merge",
    source: `%YAML 1.1\n---\n<<: {units: {Week: ${unit("named")}, 2: ${unit("two")}, 1: ${unit("one")}, '01': ${unit("padded")}}}`,
    expected: [
      ["Week", "named"],
      ["2", "two"],
      ["1", "one"],
      ["01", "padded"],
    ],
  },
  {
    name: "aliased units in reused root merge",
    source: `%YAML 1.1\n---\n<<: &base {units: &u {Week: ${unit("named")}, 2: ${unit("two")}, 1: ${unit("one")}}}\nunits: *u`,
    expected: [
      ["Week", "named"],
      ["2", "two"],
      ["1", "one"],
    ],
  },
  {
    name: "earlier merge source and direct override",
    source: `%YAML 1.1\n---\nunits: { <<: [{2: ${unit("first")}, Week: ${unit("named")}}, {2: ${unit("ignored")}, 1: ${unit("one")}}], 2: ${unit("explicit")} }`,
    expected: [
      ["2", "explicit"],
      ["Week", "named"],
      ["1", "one"],
    ],
  },
  {
    name: "raw alias between repeated merges",
    source: `%YAML 1.1\n---\nunits: { <<: {&day !!timestamp 2026-01-01: ${unit("first")}}, *day : ${unit("second")}, <<: {*day : ${unit("ignored")}} }`,
    expected: [
      [String(new Date("2026-01-01")), "first"],
      ["*day", "second"],
    ],
  },
  {
    name: "fallback merge and raw scalar alias",
    source: `%YAML 1.1\n---\nunits: { &merge !!str <<: {One: ${unit("first")}}, *merge : ${unit("second")} }`,
    expected: [
      ["One", "first"],
      ["<<", "second"],
    ],
  },
  {
    name: "own reserved property names",
    source: `units: { __proto__: ${unit("first")}, constructor: ${unit("second")} }`,
    expected: [
      ["__proto__", "first"],
      ["constructor", "second"],
    ],
  },
  {
    name: "Set merge shadowed before",
    source: `%YAML 1.1\n---\nunits: {a: ${unit("kept")}, <<: !!set {ab: null}}`,
    expected: [["a", "kept"]],
  },
  {
    name: "Set merge shadowed after",
    source: `%YAML 1.1\n---\nunits: {<<: !!set {ab: null}, a: ${unit("kept")}}`,
    expected: [["a", "kept"]],
  },
  {
    name: "Set merge shadowed under root merge",
    source: `%YAML 1.1\n---\n<<: {units: {a: ${unit("kept")}, <<: !!set {ab: null}}}`,
    expected: [["a", "kept"]],
  },
];

it("returns every native Source Map payload in declaration order through merges and aliases", () => {
  for (const { name, source, expected } of compatibleMaps) {
    const read = readSourceMap(source);
    assert.equal(read.kind, "valid", `${name}: ${read.finding.evidence}`);
    assert.ok(read.kind === "valid");
    assert.deepEqual(
      read.units.map(({ unit, source }) => [unit, source.topics[0]]),
      expected,
      name,
    );
    const native: unknown = parseDocument(source).toJS();
    assert.ok(isRecord(native) && isRecord(native.units));
    assert.equal(read.units.length, Object.keys(native.units).length, name);
    for (const entry of read.units)
      assert.deepEqual(
        entry.source,
        native.units[entry.unit],
        `${name}: ${entry.unit}`,
      );
  }
});

it("retains actual native records and shared aliases in the scoped parser projection", () => {
  const result = readControlDocument(
    `units: {Week: &shared ${unit("same")}, 2: *shared, 1: ${unit("last")}}`,
    (value, entriesOf) => {
      assert.ok(isRecord(value) && isRecord(value.units));
      const entries = entriesOf(value.units);
      assert.deepEqual(
        entries.map(([name]) => name),
        ["Week", "2", "1"],
      );
      for (const [name, payload] of entries)
        assert.strictEqual(payload, value.units[name]);
      assert.strictEqual(entries[0]?.[1], entries[1]?.[1]);
      return { value: entries };
    },
  );
  assert.ok("value" in result);
  assert.deepEqual(Object.keys(result), ["value"]);
  const read = readSourceMap(
    `units: {Week: &shared ${unit("same")}, 2: *shared}`,
  );
  assert.ok(read.kind === "valid");
  assert.strictEqual(read.units[0]?.source, read.units[1]?.source);
  assert.deepEqual(Object.keys(readControlDocument("units: {}")), ["value"]);
  const unowned = readControlDocument("units: {}", (_value, entriesOf) => ({
    value: entriesOf({}),
  }));
  assert.ok("problems" in unowned);
  assert.match(unowned.problems.join(" "), /no declared property order/u);
  assert.deepEqual(Object.keys(unowned), ["problems"]);
});

it("returns no ordered domain value for collisions or an invalid first payload", () => {
  for (const source of [
    ...collidingSourceMaps,
    `units: {First: malformed, Second: ${unit("second")}}`,
  ]) {
    const read = readSourceMap(source);
    assert.equal(read.kind, "invalid", source);
    assert.equal(read.finding.status, "fail");
    assert.ok(!("units" in read));
  }
});
