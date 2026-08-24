import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planRetentionPurge } from "../../src/routine/index.js";

const today = "2026-08-23";

describe("the routine's retention purge", () => {
  it("keeps session artifacts for seven days and reports for thirty", () => {
    const purge = planRetentionPurge({
      today,
      sessionDates: ["2026-08-16", "2026-08-15", "2026-08-23"],
      reportDates: ["2026-07-24", "2026-07-23", "2026-08-23"],
    });

    assert.deepEqual(purge.sessions, ["2026-08-15"]);
    assert.deepEqual(purge.reports, ["2026-07-23"]);
  });

  it("purges every day past the window, oldest first", () => {
    const purge = planRetentionPurge({
      today,
      sessionDates: ["2026-08-01", "2026-07-30", "2026-08-14"],
      reportDates: [],
    });

    assert.deepEqual(purge.sessions, [
      "2026-07-30",
      "2026-08-01",
      "2026-08-14",
    ]);
    assert.deepEqual(purge.reports, []);
  });

  it("leaves a day the routine has not reached yet alone", () => {
    const purge = planRetentionPurge({
      today,
      sessionDates: ["2026-08-24"],
      reportDates: ["2026-08-24"],
    });

    assert.deepEqual(purge.sessions, []);
    assert.deepEqual(purge.reports, []);
  });
});
