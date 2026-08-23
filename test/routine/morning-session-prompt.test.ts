import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCalendarDay,
  MORNING_SESSION_RESULT_FILENAME,
  morningSessionPrompt,
  offeringCalendarDay,
} from "../../src/routine/index.js";

const prompt = morningSessionPrompt({
  module: "AB1234",
  resultPath: `/state/routine/sessions/2026-08-23/AB1234/${MORNING_SESSION_RESULT_FILENAME}`,
});

describe("the module session's prompt", () => {
  it("routes into the module's own router and procedure rather than restating them", () => {
    assert.match(
      prompt,
      /Read `AGENTS\.md` and take its \*\*Curation\*\* route/u,
    );
    assert.match(prompt, /`docs\/10 Curation Procedure\.md`/u);
    assert.doesNotMatch(prompt, /MF-CURATION/u);
  });

  it("says what the folder cannot: nobody is awake, and precedent is the only resolver", () => {
    assert.match(prompt, /Nobody is awake/u);
    assert.match(prompt, /Precedent is your only resolver/u);
    assert.match(prompt, /park the item with its evidence/u);
  });

  it("bounds the derived-docs mandate to what the morning touched, and surfaces every write", () => {
    assert.match(prompt, /to what step 1 touched, and to nothing else/u);
    assert.match(prompt, /domain-modeling discipline/u);
    assert.match(prompt, /appears in `docWrites`/u);
  });

  it("names the result file, its six buckets, and where to write it", () => {
    assert.match(
      prompt,
      /\/state\/routine\/sessions\/2026-08-23\/AB1234\/result\.json/u,
    );
    for (const bucket of [
      "curated",
      "rederived",
      "superseded",
      "parked",
      "docWrites",
      "failures",
    ]) {
      assert.match(prompt, new RegExp(`"${bucket}"`, "u"));
    }
    assert.match(prompt, /six empty arrays/u);
  });

  it("leaves tasks and compilation to the surfaces that own them", () => {
    assert.match(
      prompt,
      /leave the register and the live list as the pull left them/u,
    );
    assert.match(
      prompt,
      /Leave every `\.tex` for a teaching session to compile/u,
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
    assert.equal(isCalendarDay("../.."), false);
  });
});
