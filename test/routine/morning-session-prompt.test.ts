import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCalendarDay,
  MAINTENANCE_DOMAINS,
  morningSessionPrompt,
  offeringCalendarDay,
  type ModuleMaintenanceWorkOrder,
} from "../../src/routine/index.js";

const workOrder = {
  schemaVersion: 1,
  module: { code: "AB1234", semester: "Y2S1" },
  observedAt: "2026-08-23T06:00:00+08:00",
  contractVersion: 6,
  audit: {
    outcome: "deviation",
    findings: [],
    omittedFindings: 0,
    proposedDirectories: ["20 Tutorials"],
  },
  imports: { available: true, roots: [] },
  learningSources: {
    outcome: "gaps",
    summary: {
      units: 1,
      references: 1,
      available: 0,
      missing: 1,
      nonFiles: 0,
      unavailable: 0,
      declaredMissing: 0,
      emptyUnits: 0,
    },
    units: [
      {
        unit: "Unit 1",
        topics: ["Synthetic topic"],
        status: "gaps",
        gaps: ["lectures: NTULearn/week-1.pdf (missing)"],
      },
    ],
    omittedUnits: 0,
    problems: [],
  },
  writeJournalDirectory: "/private/session/attempt-1/write-journal",
  writeJournalPath: "/private/session/attempt-1/write-journal/operations.jsonl",
  writeJournalSchemaVersion: 1,
  domains: MAINTENANCE_DOMAINS.map((domain) => ({
    domain: domain.id,
    label: domain.label,
    ruleIds: domain.ruleIds,
    evidence: ["synthetic evidence"],
    findings: [],
    proposedDirectories: [],
  })),
} as ModuleMaintenanceWorkOrder;

const prompt = morningSessionPrompt("AB1234", workOrder);

describe("the module session's prompt", () => {
  it("takes the Maintenance route and covers every registered domain", () => {
    assert.match(prompt, /take its \*\*Maintenance\*\* route/u);
    assert.match(prompt, /all nine work-order domains/u);
    for (const { id } of MAINTENANCE_DOMAINS)
      assert.match(prompt, new RegExp(id, "u"));
    assert.match(prompt, /`docs\/10 Curation Procedure\.md`/u);
  });

  it("inlines the bounded private work order", () => {
    assert.match(prompt, /<maintenance-work-order>/u);
    assert.match(prompt, /"proposedDirectories": \[/u);
    assert.match(prompt, /"20 Tutorials"/u);
    assert.match(prompt, /NTULearn\/week-1\.pdf \(missing\)/u);
    assert.doesNotMatch(prompt, /```json/u);
  });

  it("permits only evidence-backed, reversible maintenance", () => {
    assert.match(prompt, /create only missing empty directories/u);
    assert.match(
      prompt,
      /Factual Profile edits must cite current module sources/u,
    );
    assert.match(prompt, /reconcile Source Map mappings/u);
    assert.match(
      prompt,
      /add useful RESOURCES links only from named, current sources/u,
    );
    assert.match(
      prompt,
      /reconcile the Textbook register only from the shelf and module evidence/u,
    );
  });

  it("parks destructive, authoritative, pinned, academic, and external writes", () => {
    assert.match(prompt, /Never move, rename, or delete issued material/u);
    assert.match(prompt, /overwrite an annotated Owner copy/u);
    assert.match(prompt, /enable a Definition category/u);
    assert.match(prompt, /change `contract_version`/u);
    assert.match(prompt, /edit a pinned file/u);
    assert.match(prompt, /infer mastery/u);
    assert.match(prompt, /generate solutions or graded work/u);
    assert.match(prompt, /write to external Tasks or Calendar/u);
  });

  it("requires four fresh mounted-write proofs and journals intent and result", () => {
    assert.match(prompt, /prove all four requirements/u);
    assert.match(prompt, /realpath is contained/u);
    assert.match(prompt, /taken exclusively/u);
    assert.match(prompt, /materialized real bytes/u);
    assert.match(prompt, /freshly read immediately before/u);
    assert.match(prompt, /Before each mounted write append exactly/u);
    assert.match(prompt, /result record immediately after/u);
    assert.match(prompt, /"writeJournalDirectory":/u);
    assert.match(prompt, /"writeJournalPath":/u);
  });

  it("disables withdrawal inference on non-current imports", () => {
    assert.match(
      prompt,
      /If any receipt is not current, do not infer withdrawals/u,
    );
    assert.match(
      prompt,
      /Withdraw only after a complete, current importer walk/u,
    );
    assert.match(prompt, /Park a bulk disappearance/u);
  });

  it("requires complete evidenced maintenance coverage plus the action buckets", () => {
    assert.match(
      prompt,
      /Fill `maintenance` with each of the nine domain IDs exactly once/u,
    );
    assert.match(prompt, /at least one nonblank evidence line/u);
    for (const bucket of [
      "curated",
      "rederived",
      "superseded",
      "withdrawn",
      "parked",
      "docWrites",
      "failures",
      "noted",
    ])
      assert.match(prompt, new RegExp(`${bucket}`, "u"));
  });

  it("does full maintenance even with no arrivals or after a small fix", () => {
    assert.match(prompt, /even when there are no arrivals/u);
    assert.match(prompt, /even after a small structural fix/u);
    assert.match(prompt, /Leave every `\.tex`/u);
    assert.match(
      prompt,
      /Leave the Task register, live Tasks, and Calendar unchanged/u,
    );
  });
});

describe("the offering's calendar day", () => {
  it("reads a 06:00 Singapore firing as its own day, not the UTC one", () => {
    assert.equal(
      offeringCalendarDay(new Date("2026-08-22T22:00:00Z")),
      "2026-08-23",
    );
  });

  it("accepts a real calendar day and refuses anything else", () => {
    assert.equal(isCalendarDay("2026-08-23"), true);
    assert.equal(isCalendarDay("2026-8-3"), false);
    assert.equal(isCalendarDay("2026-13-01"), false);
    assert.equal(isCalendarDay("2026-02-31"), false);
    assert.equal(isCalendarDay("../.."), false);
  });
});
