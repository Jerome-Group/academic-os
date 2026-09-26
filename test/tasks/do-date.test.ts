import assert from "node:assert/strict";
import { it } from "node:test";
import { isDoDate, liveDoDate } from "../../src/tasks/do-date.js";

it("accepts actual calendar days and rejects impossible do-dates", () => {
  for (const day of [
    "2026-02-31",
    "2025-02-29",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-09-31",
  ]) {
    assert.equal(isDoDate(day), false, day);
    assert.equal(liveDoDate(`${day}T00:00:00.000Z`), undefined, day);
  }
  assert.equal(isDoDate("2024-02-29"), true);
  assert.equal(isDoDate("2026-09-26"), true);
});
