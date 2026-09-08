import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  evaluateImportStatusReceipt,
  type ImportCounts,
  type ImportStatusReceipt,
  validateImportStatusReceipt,
} from "../../src/imports/index.js";

const fixture = JSON.parse(
  readFileSync(resolve("test/fixtures/import-status-v1.json"), "utf8"),
) as ImportStatusReceipt;
const observedAt = "2026-09-08T12:00:00.000Z";
const zeroCounts: ImportCounts = {
  downloaded: 0,
  skipped: 0,
  markdown: 0,
  uncopied: 0,
  failures: 0,
};

function receipt(
  overrides: Partial<Omit<ImportStatusReceipt, "counts">> & {
    counts?: Partial<ImportCounts>;
  } = {},
): ImportStatusReceipt {
  return {
    ...fixture,
    ...overrides,
    counts: { ...fixture.counts, ...overrides.counts },
  } as ImportStatusReceipt;
}

function assertInvalid(value: unknown, message?: RegExp): void {
  const validation = validateImportStatusReceipt(value, observedAt);
  assert.equal(validation.valid, false);
  if (!validation.valid && message !== undefined) {
    assert.match(validation.problems.join("\n"), message);
  }
}

describe("import status receipt", () => {
  it("accepts the shared v1 fixture at a fixed observation time", () => {
    const validation = validateImportStatusReceipt(fixture, observedAt);

    assert.equal(validation.valid, true);
    if (validation.valid) assert.deepEqual(validation.receipt, fixture);
  });

  it("treats the freshness boundary as current and the next millisecond as stale", () => {
    const boundary = "2026-09-09T12:01:00.000Z";
    const afterBoundary = "2026-09-09T12:01:00.001Z";

    assert.equal(
      evaluateImportStatusReceipt(fixture, boundary, 36).status,
      "current",
    );
    assert.equal(
      evaluateImportStatusReceipt(fixture, afterBoundary, 36).status,
      "stale",
    );
  });

  it("preserves every non-complete lifecycle state regardless of retained success", () => {
    const cases: Array<[ImportStatusReceipt, string]> = [
      [
        receipt({
          status: "running",
          finishedAt: null,
          lastSuccessfulAt: "2026-09-07T00:00:00.000Z",
          counts: zeroCounts,
          unread: [],
        }),
        "running",
      ],
      [
        receipt({
          status: "partial",
          lastSuccessfulAt: "2026-09-07T00:00:00.000Z",
          counts: { failures: 1 },
        }),
        "partial",
      ],
      [
        receipt({
          status: "partial",
          lastSuccessfulAt: "2026-09-07T00:00:00.000Z",
          unread: ["announcements"],
        }),
        "partial",
      ],
      [
        receipt({
          status: "failed",
          lastSuccessfulAt: "2026-09-07T00:00:00.000Z",
          counts: zeroCounts,
        }),
        "failed",
      ],
    ];

    for (const [value, status] of cases) {
      const evaluated = evaluateImportStatusReceipt(value, observedAt, 36);
      assert.equal(evaluated.validation.valid, true);
      assert.equal(evaluated.status, status);
    }
  });

  it("requires the closed root and counts shapes", () => {
    const { producer: _producer, ...missingRoot } = fixture;
    const { skipped: _skipped, ...missingCount } = fixture.counts;
    const cases: unknown[] = [
      missingRoot,
      { ...fixture, detail: "private" },
      { ...fixture, counts: missingCount },
      { ...fixture, counts: { ...fixture.counts, bytes: 100 } },
    ];

    for (const value of cases) assertInvalid(value, /field|undeclared/u);
  });

  it("requires every count to be a nonnegative safe integer", () => {
    const cases: unknown[] = [
      receipt({ counts: { downloaded: -1 } }),
      receipt({ counts: { skipped: 1.5 } }),
      receipt({ counts: { markdown: Number.MAX_SAFE_INTEGER + 1 } }),
      receipt({ counts: { uncopied: Number.NaN } }),
    ];

    for (const value of cases)
      assertInvalid(value, /nonnegative safe integer/u);
  });

  it("accepts canonical leap-day timestamps and rejects malformed or inconsistent time", () => {
    const leapDay = receipt({
      startedAt: "2028-02-29T00:00:00.000Z",
      finishedAt: "2028-02-29T00:01:00.000Z",
      lastSuccessfulAt: "2028-02-29T00:01:00.000Z",
    });
    assert.equal(
      validateImportStatusReceipt(leapDay, "2028-02-29T12:00:00.000Z").valid,
      true,
    );

    const cases: unknown[] = [
      receipt({ startedAt: "2027-02-29T00:00:00.000Z" }),
      receipt({ startedAt: "2026-09-08T00:00:00Z" }),
      receipt({ startedAt: "2026-09-08T08:00:00.000+08:00" }),
      receipt({ startedAt: "2026-09-09T00:00:00.000Z" }),
      receipt({
        startedAt: "2026-09-08T00:02:00.000Z",
        finishedAt: "2026-09-08T00:01:00.000Z",
        lastSuccessfulAt: "2026-09-08T00:01:00.000Z",
      }),
      receipt({
        status: "failed",
        startedAt: "2026-09-08T00:00:00.000Z",
        lastSuccessfulAt: "2026-09-08T00:00:00.001Z",
      }),
    ];

    for (const value of cases)
      assertInvalid(value, /timestamp|observation|at or/u);
    const invalidObservation = validateImportStatusReceipt(
      fixture,
      "not-an-instant",
    );
    assert.equal(invalidObservation.valid, false);
    if (!invalidObservation.valid) {
      assert.match(invalidObservation.problems.join("\n"), /observedAt/u);
    }
  });

  it("rejects unsupported producers, versions, statuses, and unread shapes", () => {
    const cases: unknown[] = [
      { ...fixture, schemaVersion: 2 },
      { ...fixture, producer: "other" },
      { ...fixture, status: "successful" },
      { ...fixture, unread: ["announcements", "announcements"] },
      { ...fixture, unread: ["conversations", "announcements"] },
      { ...fixture, unread: ["grades"] },
    ];

    for (const value of cases) assertInvalid(value);
  });

  it("enforces lifecycle-specific terminal fields and evidence", () => {
    const cases: unknown[] = [
      receipt({ status: "running", finishedAt: fixture.finishedAt }),
      receipt({
        status: "running",
        finishedAt: null,
        counts: { downloaded: 1 },
      }),
      receipt({
        status: "running",
        finishedAt: null,
        counts: zeroCounts,
        unread: ["announcements"],
      }),
      receipt({ status: "complete", counts: { failures: 1 } }),
      receipt({ status: "complete", unread: ["conversations"] }),
      receipt({
        status: "complete",
        lastSuccessfulAt: "2026-09-07T00:00:00.000Z",
      }),
      receipt({ status: "partial", counts: zeroCounts, unread: [] }),
      receipt({ status: "failed", finishedAt: null, counts: zeroCounts }),
    ];

    for (const value of cases) assertInvalid(value);
  });
});
