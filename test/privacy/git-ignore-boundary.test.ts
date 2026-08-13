import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

describe("version-control privacy boundary", () => {
  it("refuses private state, credentials, and academic material", () => {
    const candidates = [
      "observations/MH2100.json",
      "journals/seed.jsonl",
      "reports/audit.json",
      "docs/reports/audit.json",
      "scratch/observations/MH2100.json",
      "tmp/journals/seed.jsonl",
      "credentials.json",
      "nested/credentials.json",
      "client_secret_google.json",
      "application_default_credentials.json",
      "drive-api-responses/page-1.json",
      "nested/audit.drive-api-response.json",
      "calendar/owned-calendars.json",
      "calendar-provider-responses/setup.json",
      "nested/setup.calendar-provider-response.json",
      "calendar-read.credentials.json",
      "calendar-write.credentials.json",
      "modules/MH2100/lecture.pdf",
    ];

    for (const candidate of candidates) {
      const result = spawnSync("git", ["check-ignore", "--quiet", candidate]);
      assert.equal(
        result.status,
        0,
        `${candidate} must be refused by .gitignore`,
      );
    }
  });
});
