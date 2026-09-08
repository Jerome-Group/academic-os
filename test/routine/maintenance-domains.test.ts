import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  MAINTENANCE_DOMAINS,
  isQuietMaintenanceCoverage,
} from "../../src/routine/index.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";

describe("the daily maintenance domain registry", () => {
  it("assigns every normative module-folder rule exactly once", async () => {
    const contract = await readFile("docs/module-folder-contract.md", "utf8");
    const contractRuleIds = [
      ...new Set(contract.match(/MF-[A-Z]+-[0-9]{3}/gu) ?? []),
    ].sort();
    const assignedRuleIds = MAINTENANCE_DOMAINS.flatMap(({ ruleIds }) => [
      ...ruleIds,
    ]).sort();

    assert.deepEqual(assignedRuleIds, contractRuleIds);
  });

  it("keeps the required nine domains in reporting order", () => {
    assert.deepEqual(
      MAINTENANCE_DOMAINS.map(({ id }) => id),
      [
        "import-health",
        "structure-controls",
        "curation",
        "tasks-calendar",
        "learning-sources",
        "textbooks",
        "assessments-projects",
        "cheatsheets-builds",
        "documentation-lifecycle",
      ],
    );
  });

  it("requires complete evidenced coverage and accepts completed maintenance", () => {
    const quiet = syntheticMaintenanceCoverage();
    const blank = quiet.map((entry) =>
      entry.domain === "import-health" ? { ...entry, evidence: [""] } : entry,
    );

    assert.equal(isQuietMaintenanceCoverage(quiet), true);
    assert.equal(isQuietMaintenanceCoverage(blank), false);
    assert.equal(isQuietMaintenanceCoverage(quiet.slice(1)), false);
    assert.equal(
      isQuietMaintenanceCoverage(
        quiet.map((entry) =>
          entry.domain === "import-health"
            ? { ...entry, status: "maintained" }
            : entry,
        ),
      ),
      true,
    );
  });
});
