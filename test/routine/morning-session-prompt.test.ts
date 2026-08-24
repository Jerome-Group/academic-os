import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCalendarDay,
  morningSessionPrompt,
  offeringCalendarDay,
} from "../../src/routine/index.js";

const prompt = morningSessionPrompt("AB1234");

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
    assert.match(prompt, /belongs in `docWrites`/u);
  });

  it("names the six lists the final message carries, without restating their schema", () => {
    for (const bucket of [
      "curated",
      "rederived",
      "superseded",
      "parked",
      "docWrites",
      "failures",
    ]) {
      assert.match(prompt, new RegExp(`\`${bucket}\``, "u"));
    }
    assert.match(prompt, /Your final message is the report/u);
    assert.doesNotMatch(prompt, /```json/u);
  });

  it("leaves tasks and compilation to the surfaces that own them", () => {
    assert.match(
      prompt,
      /Leave the register and the live list exactly as it left them/u,
    );
    assert.match(prompt, /created in a session with the Owner present/u);
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
