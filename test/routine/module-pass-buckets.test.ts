import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderModulePassSummary } from "../../src/commands/render-module-pass-summary.js";
import {
  MODULE_PASS_SCHEMA,
  type ModulePassOutcome,
  morningSessionPrompt,
  readModulePassOutcome,
  renderMorningReport,
} from "../../src/routine/index.js";
import { failedModulePass } from "../../src/routine/routine-failure.js";

// The one place the pass's buckets are written down as a list. Every copy in the source is checked
// against it below, because a bucket the schema gained and one renderer never learned to print is
// the failure this repository has already shipped once.
const buckets = [
  "curated",
  "rederived",
  "superseded",
  "withdrawn",
  "parked",
  "docWrites",
  "failures",
  "noted",
] as const;

const empty: ModulePassOutcome = {
  curated: [],
  rederived: [],
  superseded: [],
  withdrawn: [],
  parked: [],
  docWrites: [],
  failures: [],
  noted: [],
};

// `docWrites` reads as "Doc writes" in the report and "doc writes" at the terminal, so both titles
// come from the key rather than from a second list that could disagree with it.
function words(bucket: string): string {
  return bucket.replace(/(?<=[a-z])(?=[A-Z])/gu, " ").toLowerCase();
}

describe("the buckets a module pass reports", () => {
  it("is the same list in the schema the harness enforces", () => {
    assert.deepEqual(MODULE_PASS_SCHEMA.required, buckets);
    assert.deepEqual(Object.keys(MODULE_PASS_SCHEMA.properties), [...buckets]);
  });

  it("is the same list the parser reads and a dead session reports", () => {
    assert.deepEqual(
      Object.keys(readModulePassOutcome(JSON.stringify(empty))),
      [...buckets],
    );
    assert.deepEqual(Object.keys(failedModulePass(new Error("gone"), "x")), [
      ...buckets,
    ]);
  });

  it("is the same list the morning report and the terminal summary count", () => {
    const module = {
      semester: "Y2S1",
      module: "AB1234",
      artifacts: "/state/routine/sessions/2026-08-23/AB1234",
      ...empty,
    };
    const report = renderMorningReport({
      date: "2026-08-23",
      prelude: [],
      modules: [module],
      purge: { sessions: [], reports: [] },
    });
    const summary = renderModulePassSummary(module);

    for (const bucket of buckets) {
      const title = words(bucket);
      assert.ok(
        report.includes(
          `- ${title.charAt(0).toUpperCase()}${title.slice(1)} — 0`,
        ),
        `the morning report renders no ${bucket} bucket`,
      );
      assert.ok(
        summary.includes(`0 ${title}`),
        `the terminal summary counts no ${bucket}`,
      );
    }
  });

  it("is the same list the session prompt names", () => {
    const prompt = morningSessionPrompt("AB1234");

    for (const bucket of buckets) {
      assert.ok(
        prompt.includes(`\`${bucket}\``),
        `the session prompt never names ${bucket}`,
      );
    }
  });
});
