import assert from "node:assert/strict";
import { it } from "node:test";
import { parseDocument } from "yaml";

import { readControlDocument } from "../../src/conformance/control-document.js";
import {
  validateSourceMap,
  validateTaskRegister,
} from "../../src/conformance/index.js";
import {
  collidingSourceMaps,
  identityUnit,
} from "../fixtures/source-map-identity.js";

it("refuses distinct scalar identities lost at object conversion in either order", () => {
  for (const [left, right] of [
    ["1", "'1'"],
    ["true", "'true'"],
    [".nan", "'NaN'"],
    ["null", "''"],
    ["0x10", "'16'"],
    ["1.0", "'1'"],
    ["!!timestamp 2026-01-01", "!!timestamp 2026-01-01"],
  ]) {
    for (const keys of [
      [left, right],
      [right, left],
    ]) {
      const result = readControlDocument(
        `{ ${keys[0]}: first, ${keys[1]}: second }`,
      );
      assert.ok("problems" in result, JSON.stringify({ keys, result }));
      assert.match(result.problems.join(" "), /YAML mapping keys/u);
    }
  }
});

it("refuses repeated native identities before Map or Set conversion", () => {
  for (const source of [
    "{ .nan: first, .NaN: second }",
    "{ &key .nan: first, *key : second }",
    "{ &key 1: first, *key : second }",
    "{ &key !!timestamp 2026-01-01: first, *key : second }",
    "!!set { &key !!timestamp 2026-01-01: null, *key : null }",
    "!!set { .nan: null, .NaN: null }",
    "!!omap [ { &key 1: first }, { *key : second } ]",
  ]) {
    const result = readControlDocument(source);
    assert.ok("problems" in result, JSON.stringify({ source, result }));
  }
});

it("refuses alias scalar collisions and nested collisions at public validators", () => {
  for (const source of [
    "anchor: &key 1\nmap: { *key : first, '1': second }",
    "map: { &key 1: first, '1': second }",
  ])
    assert.ok("problems" in readControlDocument(source), source);
  for (const source of [
    ...collidingSourceMaps,
    `units: { Unit: { 1: malformed, '1': ignored, topics: [], lectures: [], textbook: [], tutorials: [] } }`,
    `units: { Unit: { topics: [], lectures: [], textbook: [], tutorials: [{ block: A, exercises: Q1, sources: [{ 1: malformed, '1': ignored, file: source.md, locator: Q1, role: questions }] }] } }`,
    `units: { 1: malformed, '1': ${identityUnit("second")} }`,
  ]) {
    const finding = validateSourceMap(source);
    assert.equal(finding.status, "fail", source);
    assert.match(finding.evidence, /YAML mapping keys/u);
  }
  const task = validateTaskRegister(
    "list_id: null\ntasks: [{ 1: invalid, '1': ignored }]\n",
  );
  assert.equal(task.status, "fail");
  assert.match(task.evidence, /YAML mapping keys/u);
});

it("checks final merge property provenance rather than cardinality or presumed keys", () => {
  for (const source of [
    "{ <<: { null: A, 1: B }, null: C, '1': D }",
    "{ <<: { null: A, 'null': B }, null: C }",
    "{ null: C, <<: { null: A, 'null': B } }",
    "{ <<: [{ null: A }, { 'null': B }] }",
    "{ <<: [{ 'null': B }, { null: A }] }",
    "{ '1': A, <<: { 1: B } }",
    "anchor: &merge !!merge '<<'\nsource: &source { *merge : A }\ntarget: { <<: *source }",
  ]) {
    const yaml = `%YAML 1.1\n---\n${source}`;
    assert.ok("problems" in readControlDocument(yaml), yaml);
  }
});

it("preserves native values, aliases, collection tags and legitimate merge precedence", () => {
  for (const source of [
    "left: { null: A }\nright: { '': B }",
    "a: &a { key: [one, two] }\nb: *a\nc: *a",
    "a: &a !!timestamp 2026-01-01\nmap: { *a : aliased, !!timestamp 2026-01-02: direct }",
    "date: !!timestamp 2026-01-01\nbinary: !!binary SGVsbG8=",
    "value: !!set { 1: null, '1': null }",
    "value: !!omap [ { 1: first }, { '1': second } ]",
    "{ __proto__: safe, constructor: safe }",
    "{ <<: literal, other: value }",
    "%YAML 1.1\n---\n{ <<: { null: A }, null: C }",
    "%YAML 1.1\n---\n{ One: C, <<: { One: A } }",
    "%YAML 1.1\n---\n{ <<: { One: A }, One: C }",
    "%YAML 1.1\n---\n{ <<: { 1: A }, 1: C }",
    "%YAML 1.1\n---\n{ <<: { .nan: A }, .nan: C }",
    "%YAML 1.1\n---\n{ <<: [{ One: A, Two: B }, { One: C, Three: D }] }",
    "%YAML 1.1\n---\n{ <<: { One: A }, <<: { Two: B } }",
    "%YAML 1.1\n---\nfirst: &first { One: A }\nsecond: &second { <<: *first, Two: B }\nthird: { <<: [*first, *second], Three: C }",
    "%YAML 1.1\n---\n? &merge <<\n: { One: A }\n? *merge\n: ordinary-alias-key",
  ]) {
    const parsed = readControlDocument(source);
    assert.ok("value" in parsed, JSON.stringify({ source, parsed }));
    assert.deepEqual(parsed.value, parseDocument(source).toJS(), source);
  }
  const aliases = readControlDocument("a: &a { key: value }\nb: *a");
  assert.ok("value" in aliases);
  const native = aliases.value;
  assert.ok(
    native && typeof native === "object" && "a" in native && "b" in native,
  );
  assert.equal(native.a, native.b);
});

it("retains malformed, unresolved, collection-key, circular and alias-limit refusals", () => {
  for (const source of [
    "units: [",
    "value: *missing",
    "? [one, two]\n: value",
    "value: &a { child: *a }",
    "value: &a !!omap [ { child: *a } ]",
    "%YAML 1.1\n---\nvalue: &a { <<: *a }",
    `anchor: &a [one]\naliases: [${Array.from({ length: 101 }, () => "*a").join(", ")}]`,
  ])
    assert.ok("problems" in readControlDocument(source), source);
});

it("refuses native collection values where the Source Map requires a record", () => {
  for (const source of [
    "units: !!set {}",
    "units: !!omap []",
    "units: !!timestamp 2026-01-01",
    "units: !!binary SGVsbG8=",
  ]) {
    const finding = validateSourceMap(source);
    assert.equal(finding.status, "fail", source);
    assert.match(finding.evidence, /requires a units mapping/u);
  }
});
