import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Finding, Inventory } from "../../src/conformance/index.js";
import {
  compareAuditObservations,
  createAuditObservation,
  type AuditObservation,
} from "../../src/observation/index.js";

const inventory: Inventory = {
  moduleCode: "MH2100",
  entries: [
    {
      path: "10 Learning Materials",
      kind: "directory",
      modifiedAt: "2026-08-11T00:00:00.000Z",
    },
  ],
};

const missingFinals: Finding = {
  ruleId: "MF-UNIVERSAL-001",
  enforcement: "deterministic",
  status: "fail",
  severity: "error",
  path: "30 Assessments/40 Finals",
  evidence: "Required directory is absent.",
  explanation: "Create the universal directory.",
  applicability: "Universal structure applies to every module.",
};

const unknownRoot: Finding = {
  ruleId: "MF-ROOT-002",
  enforcement: "deterministic",
  status: "requires-decision",
  severity: "decision",
  path: "50 Field Work",
  evidence: "Unknown root directory exists.",
  explanation: "Classify the root directory.",
  applicability: "Every module root entry is governed.",
};

describe("audit observations", () => {
  it("classifies first, repeated, introduced, and resolved findings", () => {
    const first = observation([missingFinals], "2026-08-11T01:00:00.000Z");
    assert.deepEqual(compareAuditObservations(first), {
      basis: "no-prior-observation",
      new: [missingFinals],
      unchanged: [],
      resolved: [],
    });

    const repeated = observation([missingFinals], "2026-08-11T02:00:00.000Z");
    assert.deepEqual(compareAuditObservations(repeated, first), {
      basis: "compatible-observation",
      new: [],
      unchanged: [missingFinals],
      resolved: [],
    });

    const introduced = observation(
      [missingFinals, unknownRoot],
      "2026-08-11T03:00:00.000Z",
    );
    assert.deepEqual(compareAuditObservations(introduced, repeated), {
      basis: "compatible-observation",
      new: [unknownRoot],
      unchanged: [missingFinals],
      resolved: [],
    });

    const resolved = observation([], "2026-08-11T04:00:00.000Z");
    assert.deepEqual(compareAuditObservations(resolved, introduced), {
      basis: "compatible-observation",
      new: [],
      unchanged: [],
      resolved: [unknownRoot, missingFinals],
    });
  });

  it("identifies a contract change instead of ordinary drift", () => {
    const previous = observation([missingFinals], "2026-08-11T01:00:00.000Z");
    const current = observation([unknownRoot], "2026-08-11T02:00:00.000Z", 3);

    assert.deepEqual(compareAuditObservations(current, previous), {
      basis: "contract-version-changed",
      contractChange: { from: 2, to: 3 },
      new: [],
      unchanged: [],
      resolved: [],
    });
  });
});

function observation(
  findings: Finding[],
  observedAt: string,
  contractVersion: number | "unavailable" = 2,
): AuditObservation {
  return createAuditObservation({
    target: {
      moduleCode: "MH2100",
      semester: "Y2S1",
      identity: "/synthetic/Modules/Y2S1/MH2100",
    },
    inventory,
    findings,
    observedAt,
    contractVersion,
  });
}
