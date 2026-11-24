import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sha256 } from "../../src/checksum.js";
import { validateCurationRegister } from "../../src/conformance/validate-curation-register.js";
import {
  readCurationRegisterEvents,
  standingCurationItems,
  walkedCurationItems,
} from "../../src/curation/index.js";

const original = {
  schema_version: 3,
  source_id: "Lectures/Week 9.pdf",
  integration: "ntulearn",
  role: "lecture",
  source_path: "09 Lectures/09 Week 9.pdf",
  checksum: `sha256:${"a".repeat(64)}`,
  decision: "curated",
  evidence: "Original placement omitted its destination.",
  timestamp: "2026-10-22T12:00:00Z",
  extra: { flags: [1, 2] },
};
const complete = {
  ...original,
  destination: "10 Learning Materials/Week 9.pdf",
  evidence:
    "Source and canonical output independently verified against checksum.",
  timestamp: "2026-11-23T12:00:00Z",
  supersedes: "Earlier prose pointer",
};
const raw = (value: unknown): string => JSON.stringify(value);
const reference = (event: Record<string, unknown>) =>
  `raw-sha256:${sha256(raw(event))}`;
const correction = {
  ...original,
  destination: complete.destination,
  evidence:
    "Destination recovered from exact verified prior event; no new copy.",
  timestamp: "2026-11-24T12:00:00Z",
  supersedes: reference(original),
  reconciliation: "original-curated-destination-unrecorded",
  destination_evidence: reference(complete),
};
const finding = (...events: Record<string, unknown>[]) =>
  validateCurationRegister(`${events.map(raw).join("\n")}\n`);

function pair(
  old: Record<string, unknown>,
  evidence: Record<string, unknown>,
  append: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return [
    old,
    evidence,
    {
      ...correction,
      supersedes: reference(old),
      destination_evidence: reference(evidence),
      ...append,
    },
  ];
}

describe("missing curated destination reconciliation", () => {
  it("accepts only exact append-only recovery and reads it as standing", () => {
    const source = `${[original, complete, correction].map(raw).join("\n")}\n`;
    assert.equal(validateCurationRegister(source).status, "pass");
    assert.equal(source.split("\n")[0], raw(original));
    assert.equal(
      validateCurationRegister(source.replaceAll("\n", "\r\n")).status,
      "pass",
    );
    const items = standingCurationItems(
      walkedCurationItems(readCurationRegisterEvents(source), ["ntulearn"]),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.standing.destination, complete.destination);
    assert.equal(items[0]?.standing.timestamp, correction.timestamp);
    assert.deepEqual(items[0]?.standing.extra, original.extra);
  });

  it("rejects unmarked historical omissions and all other original defects", () => {
    assert.equal(finding(original, complete).status, "fail");
    for (const defect of [
      { schema_version: 2 },
      { destination: null },
      { destination: "" },
      { timestamp: undefined },
      { timestamp: "bad" },
      { source_id: "" },
      { decision: "source-only" },
      { checksum: undefined },
      { checksum: "not-sha256" },
      { derived: ["CONTEXT.md"] },
    ]) {
      assert.equal(
        finding(...pair({ ...original, ...defect }, complete)).status,
        "fail",
        raw(defect),
      );
    }
    assert.equal(
      finding(...pair(original, complete, { reconciliation: undefined }))
        .status,
      "fail",
    );
    assert.equal(
      finding(
        ...pair(original, complete, {
          reconciliation: "original-decision-time-unrecorded",
        }),
      ).status,
      "fail",
    );
  });

  it("requires source identity and checksum to agree across both references and append", () => {
    for (const change of [
      { integration: "other" },
      { source_id: "Other.pdf" },
      { source_path: "Other.pdf" },
      { role: "tutorial" },
      { checksum: `sha256:${"b".repeat(64)}` },
    ]) {
      assert.equal(
        finding(...pair(original, { ...complete, ...change })).status,
        "fail",
        raw(change),
      );
      assert.equal(
        finding(...pair(original, complete, change)).status,
        "fail",
        raw(change),
      );
    }
    for (const change of [
      { destination: "10 Learning Materials/Other.pdf" },
      { extra: { flags: [2] } },
      { schema_version: 2 },
      { timestamp: undefined },
    ])
      assert.equal(
        finding(...pair(original, complete, change)).status,
        "fail",
        raw(change),
      );
  });

  it("retains a standing decision across importer renumbering and legacy IDs", () => {
    const renumbered = {
      ...complete,
      source_id: "legacy-source-id",
      source_path: "10 Lectures/10 Week 9.pdf",
      destination: undefined,
      decision: "source-only",
    };
    const before = [original, complete, renumbered].map(raw).join("\n");
    const items = standingCurationItems(
      walkedCurationItems(readCurationRegisterEvents(before), ["ntulearn"]),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.standing.decision, "source-only");
    assert.equal(
      finding(original, complete, renumbered, correction).status,
      "fail",
    );
  });

  it("requires complete evidence and unique chronological raw references", () => {
    for (const change of [
      { destination: undefined },
      { destination: "../escape.pdf" },
      { timestamp: undefined },
      { timestamp: "bad" },
      { decision: "requires-decision", destination: undefined },
      { reconciliation: "original-curated-destination-unrecorded" },
    ])
      assert.equal(
        finding(...pair(original, { ...complete, ...change })).status,
        "fail",
        raw(change),
      );
    for (const events of [
      [original, correction, complete],
      [complete, original, correction],
      [original, original, complete, correction],
      [original, complete, complete, correction],
      [original, complete, correction, correction],
      [original, complete, { ...correction, supersedes: reference(complete) }],
      [
        original,
        complete,
        { ...correction, destination_evidence: reference(original) },
      ],
      [
        original,
        complete,
        { ...correction, destination_evidence: `raw-sha256:${"0".repeat(64)}` },
      ],
      [
        original,
        complete,
        { ...correction, destination_evidence: "prose pointer" },
      ],
    ])
      assert.equal(finding(...events).status, "fail", raw(events));
    assert.equal(
      finding({ ...complete, destination_evidence: reference(original) })
        .status,
      "fail",
    );
  });

  it("rejects later contradictory decisions and preserves compatible history", () => {
    for (const change of [
      { destination: "10 Learning Materials/Other.pdf" },
      { decision: "source-only", destination: undefined },
      { checksum: `sha256:${"b".repeat(64)}` },
      { source_id: "Other.pdf" },
      { source_path: "Other.pdf" },
      { role: "tutorial" },
    ])
      assert.equal(
        finding(original, complete, { ...complete, ...change }, correction)
          .status,
        "fail",
        raw(change),
      );
    assert.equal(
      finding(
        original,
        complete,
        { ...complete, evidence: "Rechecked again." },
        correction,
      ).status,
      "pass",
    );
    assert.equal(
      finding(
        original,
        complete,
        { ...complete, source_id: "Other.pdf", source_path: "Other.pdf" },
        correction,
      ).status,
      "pass",
    );
  });

  it("rejects numeric token normalization in either raw proof event or append", () => {
    for (const index of [0, 1, 2]) {
      const events = [original, complete, correction].map(raw);
      events[index] =
        events[index]?.replace('"flags":[1,2]', '"flags":[1e0,2]') ?? "";
      const appended = {
        ...correction,
        supersedes: `raw-sha256:${sha256(events[0] ?? "")}`,
        destination_evidence: `raw-sha256:${sha256(events[1] ?? "")}`,
      };
      events[2] =
        index === 2
          ? raw(appended).replace('"flags":[1,2]', '"flags":[1e0,2]')
          : raw(appended);
      assert.equal(
        validateCurationRegister(`${events.join("\n")}\n`).status,
        "fail",
      );
    }
  });
});
