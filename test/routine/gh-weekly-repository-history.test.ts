import assert from "node:assert/strict";
import { it } from "node:test";
import { createGhWeeklyRepositoryHistory } from "../../src/routine/gh-weekly-repository-history.js";

it("discovers all merged facts in the exact Singapore week with public-safe fields only", async () => {
  const rows = [
    {
      number: 10,
      mergedAt: "2026-09-27T15:59:59Z",
      mergeCommit: { oid: "a".repeat(40) },
    },
    {
      number: 11,
      mergedAt: "2026-09-27T16:00:00Z",
      mergeCommit: { oid: "b".repeat(40) },
      title: "synthetic-private-title",
      body: "synthetic-private-body",
    },
    {
      number: 12,
      mergedAt: "2026-10-04T15:59:59Z",
      mergeCommit: { oid: "c".repeat(40) },
    },
    {
      number: 13,
      mergedAt: "2026-10-04T16:00:00Z",
      mergeCommit: { oid: "d".repeat(40) },
    },
  ];
  const collector = createGhWeeklyRepositoryHistory("unused", (input) => {
    assert.deepEqual(input.arguments.slice(-2), [
      "--json",
      "number,mergeCommit,mergedAt",
    ]);
    assert.ok(input.arguments.includes("merged:2026-09-27..2026-10-04"));
    return JSON.stringify(rows);
  });
  const summary = await collector("2026-09-28");
  assert.deepEqual(
    summary.merged.map((row) => row.pullRequest),
    [11, 12],
  );
  assert.ok(
    summary.merged.every(
      (row) => row.verification === "awaiting" && row.rollout === "awaiting",
    ),
  );
  assert.ok(!JSON.stringify(summary).includes("synthetic-private"));
});

it("refuses malformed, duplicate and potentially truncated merge evidence", async () => {
  const row = {
    number: 11,
    mergedAt: "2026-09-28T00:00:00Z",
    mergeCommit: { oid: "a".repeat(40) },
  };
  for (const rows of [
    null,
    [row, row],
    [{ ...row, mergeCommit: { oid: "private prose" } }],
    Array.from({ length: 1000 }, (_, i) => ({ ...row, number: i + 1 })),
  ]) {
    await assert.rejects(
      createGhWeeklyRepositoryHistory("unused", () => JSON.stringify(rows))(
        "2026-09-28",
      ),
    );
  }
});
