import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  Finding,
  Inventory,
  ResearchFinding,
} from "../../src/conformance/index.js";
import {
  createAuditObservation,
  createResearchAuditObservation,
  isAuditObservation,
  isResearchAuditObservation,
} from "../../src/observation/index.js";

const finding = {
  enforcement: "deterministic",
  status: "pass",
  severity: "information",
  path: ".",
  evidence: "The required structure is present.",
  explanation: "The structure follows the contract.",
  applicability: "Universal structure applies.",
} as const;
const inventory: Inventory = {
  moduleCode: "MH2100",
  entries: [{ path: "00 Module Admin", kind: "directory" }],
  provenance: {
    source: "synthetic",
    target: "/synthetic/MH2100",
    completeness: "complete",
    diagnostics: [
      {
        kind: "unavailable-metadata",
        severity: "warning",
        evidence: "No checksum is exposed.",
      },
    ],
    excludedTrashedItems: 0,
  },
};

function observations() {
  return [
    {
      validate: isAuditObservation,
      value: createAuditObservation({
        target: {
          moduleCode: "MH2100",
          semester: "Y2S1",
          identity: "/synthetic/MH2100",
        },
        contractVersion: 7,
        observedAt: "2026-10-23T00:00:00.000Z",
        inventory,
        findings: [{ ...finding, ruleId: "MF-UNIVERSAL-001" }],
      }),
    },
    {
      validate: isResearchAuditObservation,
      value: createResearchAuditObservation({
        target: {
          kind: "research-project",
          projectKey: "example-project",
          profile: "generic",
          identity: "/synthetic/Example Project",
        },
        contractVersion: 3,
        observedAt: "2026-10-23T00:00:00.000Z",
        inventory: { ...inventory, projectKey: "example-project" },
        findings: [{ ...finding, ruleId: "RP-UNIVERSAL-001" }],
      }),
    },
  ];
}

function malformedScalars(value: string): unknown[] {
  return [[value], { toString: () => value }, { value }, null, 0];
}

describe("audit observation input validation", () => {
  it("rejects non-scalar finding and metadata enums for Modules and Research projects", () => {
    for (const { value, validate } of observations()) {
      for (const [field, scalar] of Object.entries({
        status: "pass",
        severity: "information",
      })) {
        for (const invalid of malformedScalars(scalar)) {
          assert.equal(
            validate({
              ...value,
              findings: [{ ...value.findings[0], [field]: invalid }],
            }),
            false,
            field,
          );
        }
      }
      for (const invalid of malformedScalars("unavailable")) {
        assert.equal(
          validate({
            ...value,
            metadataAvailability: {
              ...value.metadataAvailability,
              contentChecksums: invalid,
            },
          }),
          false,
          "contentChecksums",
        );
      }
    }
  });

  it("rejects coerced inventory kind, provenance and diagnostic enums", () => {
    for (const { value, validate } of observations()) {
      for (const invalid of malformedScalars("file")) {
        assert.equal(
          validate({
            ...value,
            inventory: {
              ...value.inventory,
              entries: [{ path: "file", kind: invalid }],
            },
          }),
          false,
          "entry kind",
        );
        assert.equal(
          validate({
            ...value,
            inventory: {
              ...value.inventory,
              excludedEntries: [{ path: "file", kind: invalid }],
            },
          }),
          false,
          "excluded entry kind",
        );
      }
      for (const [field, scalar] of Object.entries({
        source: "synthetic",
        completeness: "complete",
      })) {
        for (const invalid of malformedScalars(scalar)) {
          assert.equal(
            validate({
              ...value,
              inventory: {
                ...value.inventory,
                provenance: { ...inventory.provenance, [field]: invalid },
              },
            }),
            false,
            field,
          );
        }
      }
      for (const [field, scalar] of Object.entries({
        kind: "rate-limit",
        severity: "warning",
      })) {
        for (const invalid of malformedScalars(scalar)) {
          assert.equal(
            validate({
              ...value,
              inventory: {
                ...value.inventory,
                provenance: {
                  ...inventory.provenance,
                  diagnostics: [
                    {
                      kind: "rate-limit",
                      severity: "warning",
                      evidence: "The provider refused a page.",
                      [field]: invalid,
                    },
                  ],
                },
              },
            }),
            false,
            `diagnostic ${field}`,
          );
        }
      }
    }
  });

  it("accepts every supported scalar enum for Modules and Research projects", () => {
    const statuses: Finding["status"][] = [
      "pass",
      "fail",
      "warning",
      "manual-review",
      "requires-decision",
      "not-applicable",
    ];
    const severities: ResearchFinding["severity"][] = [
      "information",
      "warning",
      "error",
      "decision",
    ];
    for (const { value, validate } of observations()) {
      assert.equal(validate(value), true);
      for (const status of statuses) {
        for (const severity of severities) {
          assert.equal(
            validate({
              ...value,
              findings: [{ ...value.findings[0], status, severity }],
            }),
            true,
            `${status} ${severity}`,
          );
        }
      }
      for (const contentChecksums of ["unavailable", "entry-specific"]) {
        assert.equal(
          validate({
            ...value,
            metadataAvailability: {
              ...value.metadataAvailability,
              contentChecksums,
            },
          }),
          true,
          contentChecksums,
        );
      }
      for (const kind of ["directory", "file", "symlink", "other"]) {
        assert.equal(
          validate({
            ...value,
            inventory: {
              ...value.inventory,
              entries: [{ path: "entry", kind }],
            },
          }),
          true,
          kind,
        );
      }
      for (const source of ["mounted", "drive-api", "synthetic"]) {
        for (const completeness of ["complete", "partial"]) {
          for (const kind of [
            "duplicate-visible-name",
            "pagination-failure",
            "rate-limit",
            "shortcut-cycle",
            "unavailable-metadata",
          ]) {
            for (const severity of ["warning", "error"]) {
              assert.equal(
                validate({
                  ...value,
                  inventory: {
                    ...value.inventory,
                    provenance: {
                      ...inventory.provenance,
                      source,
                      completeness,
                      diagnostics: [
                        {
                          kind,
                          severity,
                          evidence: "The provider reported a diagnostic.",
                        },
                      ],
                    },
                  },
                }),
                true,
                `${source} ${completeness} ${kind} ${severity}`,
              );
            }
          }
        }
      }
    }
  });
});
