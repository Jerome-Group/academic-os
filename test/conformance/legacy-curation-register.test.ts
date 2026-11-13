import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sha256 } from "../../src/checksum.js";
import { validateCurationRegister } from "../../src/conformance/validate-curation-register.js";
import {
  planCurationIdentityMigration,
  readCurationRegisterEvents,
  standingCurationItems,
  walkedCurationItems,
} from "../../src/curation/index.js";

const old = {
  schema_version: 2,
  source_id: "Lectures/Week 9 Annotated.pdf",
  integration: "ntulearn",
  role: "lecture",
  source_path: "09 Lectures/09 Week 9 Annotated.pdf",
  checksum: `sha256:${"a".repeat(64)}`,
  decision: "curated",
  destination: "10 Learning Materials/Week 9 Annotated.pdf",
  evidence: "Original placement; time not recorded.",
  extra: { owner: "manual review", flags: [1, 2] },
};
const oldRaw = JSON.stringify(old);
const current = {
  ...old,
  schema_version: 3,
  evidence:
    "Original decision instant unrecorded; source and copy independently rechecked; no new copy.",
  timestamp: "2026-11-13T12:00:00Z",
  supersedes: `raw-sha256:${sha256(oldRaw)}`,
  reconciliation: "original-decision-time-unrecorded",
};
const register = (...lines: string[]) => `${lines.join("\n")}\n`;
const finding = (...lines: string[]) =>
  validateCurationRegister(register(...lines));

function ordinary(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...old,
    timestamp: "2026-10-22T22:45:49Z",
    ...overrides,
  });
}

function numericPair(oldToken: string, currentToken: string): [string, string] {
  const extra = {
    nested: [{ value: 0, label: 'digits "9007199254740993" stay text' }],
  };
  const historical = JSON.stringify({ ...old, extra }).replace(
    '"value":0',
    `"value":${oldToken}`,
  );
  const correction = JSON.stringify({
    ...current,
    extra,
    supersedes: `raw-sha256:${sha256(historical)}`,
  }).replace('"value":0', `"value":${currentToken}`);
  return [historical, correction];
}

describe("legacy Curation Register reconciliation", () => {
  it("accepts only the later exact raw-line correction and reads it as standing", () => {
    const source = register(oldRaw, JSON.stringify(current));
    assert.equal(validateCurationRegister(source).status, "pass");
    assert.equal(source.slice(0, oldRaw.length), oldRaw);
    const items = standingCurationItems(
      walkedCurationItems(readCurationRegisterEvents(source), ["ntulearn"]),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.standing.timestamp, current.timestamp);
    assert.equal(items[0]?.standing.destination, old.destination);
    assert.equal(
      items[0]?.standing.extra && JSON.stringify(items[0]?.standing.extra),
      JSON.stringify(old.extra),
    );
    const plan = planCurationIdentityMigration({
      now: "2026-11-13T12:01:00Z",
      modules: [
        {
          module: "AA1001",
          semester: "Y2S1",
          register: source,
          integrations: ["ntulearn"],
          sources: new Map([
            [
              "ntulearn/Lectures/Week 9 Annotated.pdf",
              {
                sourcePath: old.source_path,
                location: `NTULearn/${old.source_path}`,
                sha256: "a".repeat(64),
                md5: "b".repeat(32),
              },
            ],
          ]),
          ambiguousSources: new Set(),
        },
      ],
    });
    assert.deepEqual(plan.modules[0]?.blockers, []);
    assert.equal(plan.modules[0]?.migrations.length, 0);
    assert.equal(plan.modules[0]?.counts["contract-v4"], 1);
    assert.equal(
      validateCurationRegister(`${oldRaw}\r\n${JSON.stringify(current)}\r\n`)
        .status,
      "pass",
    );
  });

  it("rejects absent, null, empty and malformed timestamps without an exact correction", () => {
    for (const raw of [
      oldRaw,
      ordinary({ timestamp: null }),
      ordinary({ timestamp: "" }),
      ordinary({ timestamp: "2026-02-30T12:00:00Z" }),
    ]) {
      assert.equal(finding(raw).status, "fail");
    }
  });

  it("rejects changed fields, unproved references, duplicate and ambiguous raw lines", () => {
    const cases = [
      [
        oldRaw,
        JSON.stringify({ ...current, checksum: `sha256:${"b".repeat(64)}` }),
      ],
      [
        oldRaw,
        JSON.stringify({
          ...current,
          destination: "10 Learning Materials/other.pdf",
        }),
      ],
      [oldRaw, JSON.stringify({ ...current, extra: { owner: "other" } })],
      [
        oldRaw,
        JSON.stringify({
          ...current,
          supersedes: `raw-sha256:${"0".repeat(64)}`,
        }),
      ],
      [JSON.stringify(current), oldRaw],
      [oldRaw, JSON.stringify(current), JSON.stringify(current)],
      [oldRaw, oldRaw, JSON.stringify(current)],
      [oldRaw, JSON.stringify({ ...current, reconciliation: undefined })],
      [oldRaw, JSON.stringify({ ...current, schema_version: 2 })],
      [oldRaw, JSON.stringify({ ...current, timestamp: null })],
      [ordinary({ timestamp: null }), JSON.stringify(current)],
      [ordinary({ timestamp: "" }), JSON.stringify(current)],
      [
        oldRaw,
        JSON.stringify({ ...current, timestamp: "2026-02-30T12:00:00Z" }),
      ],
    ];
    for (const lines of cases)
      assert.equal(finding(...lines).status, "fail", lines.join("\n"));
  });

  it("refuses numeric tokens that JSON parsing would round during reconciliation", () => {
    const rounded: Array<readonly [string, string]> = [
      ["9007199254740993", "9007199254740992"],
      ["1.0000000000000001", "1"],
      ["0.10000000000000001", "0.1"],
      ["1e400", "1e400"],
      ["1e0", "1"],
      ["1", "1.0000000000000001"],
    ];
    for (const [oldToken, currentToken] of rounded) {
      const pair = numericPair(oldToken, currentToken);
      const result = finding(...pair);
      assert.equal(result.status, "fail", pair.join("\n"));
      assert.match(
        result.evidence,
        /cannot preserve a numeric JSON token exactly/u,
      );
    }
    for (const token of ["9007199254740992", "0.1", "1"]) {
      assert.equal(finding(...numericPair(token, token)).status, "pass");
    }
    const ordinaryHistory = JSON.stringify({
      ...old,
      timestamp: "2026-10-22T22:45:49Z",
      extra: { value: 0 },
    }).replace('"value":0', '"value":1e0');
    assert.equal(finding(ordinaryHistory).status, "pass");
  });

  it("accepts the narrow historical manual alias and UTC spelling", () => {
    const manual = ordinary({
      integration: "owner-download",
      source_path: "/Downloads/owner-file.pdf",
      timestamp: "2026-10-22 22:45:49Z",
    });
    assert.equal(finding(manual).status, "pass");
    assert.equal(
      readCurationRegisterEvents(register(manual))[0]?.timestamp,
      "2026-10-22 22:45:49Z",
    );
    for (const bad of [
      ordinary({
        integration: "owner-downloads",
        source_path: "/Downloads/owner-file.pdf",
      }),
      ordinary({
        integration: "ntulearn",
        source_path: "/Downloads/owner-file.pdf",
      }),
      ordinary({ timestamp: "2026-10-22 22:45:49+00:00" }),
      ordinary({ timestamp: "2026-10-22 22:45:49" }),
      ordinary({ timestamp: "2026-10-22T22:45:49+25:00" }),
    ])
      assert.equal(finding(bad).status, "fail");
  });
});
