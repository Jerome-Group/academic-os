import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectControlShape, readControls } from "../../src/controls/index.js";
import {
  canonicalFixture,
  file,
  generationPath,
  headPath,
  identityPath,
  jsonFile,
  legacyFixture,
  moduleCode,
  moduleId,
} from "./fixtures.js";

function read(files = canonicalFixture()) {
  return readControls({ moduleCode, files });
}
function codes(value: ReturnType<typeof read>): string[] {
  return value.diagnostics.map((item) => item.code);
}

describe("version-aware public control reads", () => {
  it("binds a canonical head, generation and real referenced bytes without claiming complete conformance", () => {
    const files = canonicalFixture();
    const result = read(files);
    assert.equal(result.kind, "canonical");
    if (result.kind !== "canonical") return;
    assert.equal(result.coverage, "incomplete-module-contract");
    assert.deepEqual(result.unsupportedReads, [
      "definition",
      "profile",
      "source-map",
      "learning-records",
      "workflows",
      "module-conformance",
      "migration-readiness",
    ]);
    assert.equal(result.controls[0]?.value.module, moduleId);
    assert.equal(result.controls[0]?.path, identityPath);
    for (const evidence of result.evidence)
      assert.deepEqual(
        Buffer.from(evidence.bytesBase64, "base64"),
        files.find((file) => file.path === evidence.path)?.bytes,
      );
    assert.equal(detectControlShape({ moduleCode, files }).kind, "canonical");
  });

  it("preserves legacy raw values, declaration order, missing controls and partial claims", () => {
    const files = legacyFixture();
    const before = files.map((file) =>
      file.kind === "file" ? Buffer.from(file.bytes) : undefined,
    );
    const result = readControls({ moduleCode, files });
    assert.equal(result.kind, "legacy");
    if (result.kind !== "legacy") return;
    assert.deepEqual(result.shape.declared, {
      schemaVersion: 2,
      contractVersion: 3,
    });
    assert.equal(result.shape.procedureFingerprints.length, 2);
    assert.equal(
      new Set(result.shape.procedureFingerprints.map((file) => file.sha256))
        .size,
      2,
    );
    assert.ok(
      result.shape.missingControls.includes(
        "00 Module Admin/30 Task Register.yaml",
      ),
    );
    assert.equal(result.sourceMap.kind, "read");
    if (result.sourceMap.kind === "read") {
      assert.deepEqual(
        result.sourceMap.units.map((unit) => unit.unit),
        ["10", "2"],
      );
      assert.equal(
        typeof result.sourceMap.units[0]?.source.tutorials[0],
        "string",
      );
      assert.equal(
        typeof result.sourceMap.units[1]?.source.tutorials[0],
        "object",
      );
    }
    assert.deepEqual(result.records[0]?.target, { kind: "unknown" });
    assert.deepEqual(result.records[0]?.status, { kind: "unknown" });
    assert.deepEqual(result.records[0]?.supersedes, ["earlier.md"]);
    assert.equal(result.records[0]?.supersedesRepresentation, "scalar");
    assert.deepEqual(result.records[1]?.supersedes, [
      "earlier.md",
      "partial.md",
    ]);
    assert.equal(result.records[1]?.supersedesRepresentation, "list");
    assert.deepEqual(result.records[2]?.target, { kind: "unknown" });
    assert.deepEqual(result.records[2]?.status, {
      kind: "observed",
      value: "reviewed",
    });
    assert.equal(result.coverage, "legacy-observation-only");
    files.forEach((file, index) => {
      if (file.kind === "file")
        assert.deepEqual(Buffer.from(file.bytes), before[index]);
    });
  });

  it("preserves numeric scalar/list supersedes and curation unknown fields without inventing digest claims", () => {
    const files = [
      ...legacyFixture(),
      file(
        "70 Learning/30 Revision/records/numeric.md",
        "---\nsupersedes: [0012, 13]\n---\nNumeric record IDs.\n",
      ),
      file(
        "70 Learning/30 Revision/records/scalar.md",
        "---\nsupersedes: 0012\n---\nNumeric record ID.\n",
      ),
    ];
    const result = readControls({ moduleCode, files });
    assert.equal(result.kind, "legacy");
    if (result.kind !== "legacy") return;
    assert.deepEqual(result.records.at(-2)?.supersedes, [12, 13]);
    assert.deepEqual(result.records.at(-1)?.supersedes, [12]);
    const register = result.documents.find(
      (document) => document.format === "jsonl",
    );
    assert.deepEqual(register?.value, [
      {
        checksum: "abcdef0123456789abcdef0123456789",
        destination: "90 Resources/Native bundle",
        decision: "curated",
        unknown: { preserve: true },
      },
      { sha256: "0".repeat(64), decision: "source-only" },
      { decision: "unresolved" },
    ]);
    assert.equal(result.diagnostics.length, 0);
  });

  it("retains absent and unsupported legacy Source Maps explicitly", () => {
    assert.deepEqual(readControls({ moduleCode, files: [] }).kind, "legacy");
    const absent = readControls({
      moduleCode,
      files: legacyFixture().filter(
        (file) => !file.path.endsWith("Source Map.yaml"),
      ),
    });
    assert.ok(absent.kind === "legacy" && absent.sourceMap.kind === "absent");
    const invalid = readControls({
      moduleCode,
      files: [
        file("00 Module Admin/40 Source Map.yaml", "units: [unsupported]\n"),
      ],
    });
    assert.ok(
      invalid.kind === "legacy" && invalid.sourceMap.kind === "invalid",
    );
    assert.ok(codes(invalid).includes("invalid-legacy-source-map"));
  });

  for (const source of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"x":9007199254740992}',
    '{"x":-0}',
    '{"x":1.0}',
    '{"x":1e0}',
    '{"x":"\\ud800"}',
    '{"x":NaN}',
    '{"x":1,}',
    "\ufeff{}",
  ]) {
    it(`refuses unsafe canonical JSON bytes ${JSON.stringify(source)}`, () => {
      const result = readControls({
        moduleCode,
        files: [...legacyFixture(), file(headPath, source)],
      });
      assert.equal(result.kind, "unsupported");
      assert.ok(codes(result).includes("invalid-json-bytes"));
    });
  }
  it("refuses invalid UTF-8 and unreadable canonical paths without legacy fallback", () => {
    for (const head of [
      {
        kind: "file" as const,
        path: headPath,
        bytes: Uint8Array.from([0xc3, 0x28]),
      },
      {
        kind: "unreadable" as const,
        failure: "unsafe" as const,
        path: headPath,
        reason: "Symbolic link.",
      },
    ]) {
      const result = readControls({
        moduleCode,
        files: [...legacyFixture(), head],
      });
      assert.equal(result.kind, "unsupported");
      assert.ok(result.diagnostics.length > 0);
    }
  });

  it("refuses absent references, byte mismatches, identity conflicts and unsupported versions", () => {
    const scenarios = [
      {
        files: canonicalFixture().filter(
          (file) => file.path !== generationPath,
        ),
        code: "missing-canonical-reference",
      },
      {
        files: canonicalFixture().map((item) =>
          item.path === identityPath ? file(identityPath, "{}") : item,
        ),
        code: "canonical-hash-mismatch",
      },
      {
        files: canonicalFixture({ generation: { module: "module:other" } }),
        code: "canonical-identity-conflict",
      },
      {
        files: canonicalFixture({ identity: { module: "module:other" } }),
        code: "canonical-identity-conflict",
      },
      {
        files: canonicalFixture({ head: { schemaVersion: 2 } }),
        code: "invalid-control-schema",
      },
      {
        files: canonicalFixture({
          generation: {
            controls: [
              {
                role: "unknown",
                schema: "urn:unknown:9",
                file: "unknown.json",
                byteSha256: "0".repeat(64),
              },
            ],
          },
        }),
        code: "unsupported-control-schema",
      },
    ];
    for (const scenario of scenarios) {
      const result = readControls({
        moduleCode,
        files: [...legacyFixture(), ...scenario.files],
      });
      assert.equal(result.kind, "unsupported");
      assert.ok(
        codes(result).includes(scenario.code),
        JSON.stringify(result.diagnostics),
      );
    }
  });

  it("refuses duplicate observations, duplicate control roles and unsafe paths", () => {
    assert.ok(
      codes(
        read([
          ...canonicalFixture(),
          canonicalFixture()[0] ?? jsonFile(headPath, {}),
        ]),
      ).includes("conflicting-observations"),
    );
    for (const path of [
      "../escape.json",
      "/absolute.json",
      "./identity.json",
      "nested//identity.json",
      "C:\\identity.json",
      "generation.json",
    ]) {
      const result = read(
        canonicalFixture({
          generation: {
            controls: [
              {
                role: "module-identity",
                schema: "urn:academic-os:module-identity:1",
                file: path,
                byteSha256: "0".repeat(64),
              },
            ],
          },
        }),
      );
      assert.ok(codes(result).includes("unsafe-control-path"), path);
    }
    const generation = canonicalFixture().find(
      (file) => file.path === generationPath,
    );
    assert.ok(generation);
    const value = JSON.parse(Buffer.from(generation.bytes).toString("utf8"));
    const result = read(
      canonicalFixture({
        generation: { controls: [...value.controls, ...value.controls] },
      }),
    );
    assert.ok(codes(result).includes("conflicting-control-identity"));
  });
});
