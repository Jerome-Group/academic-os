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

  // That it names every bucket is `module-pass-buckets.test.ts`'s question; this one is that it
  // describes them rather than restating the schema the CLI already enforces.
  it("presents the lists as a report rather than as a shape to fill in", () => {
    assert.match(prompt, /Your final message is the report/u);
    assert.match(prompt, /Eight lists, empty where the morning was/u);
    assert.doesNotMatch(prompt, /```json/u);
  });

  it("bounds a withdrawal to a completed walk and parks a mirror missing many at once", () => {
    assert.match(
      prompt,
      /leaves the copy that source produced exactly where it is/u,
    );
    assert.match(prompt, /read every importer root end to end/u);
    assert.match(prompt, /many standing sources have gone at once/u);
  });

  it("draws the line the pass has to apply between a park and a note", () => {
    assert.match(
      prompt,
      /`parked` is what the Owner settles, `noted` is what the Owner is told/u,
    );
    assert.match(prompt, /asks nothing of the Owner/u);
    assert.match(prompt, /correct now and stays correct/u);
  });

  // #197: two unattended mornings each invented a meta-item with an empty note — the pass narrating
  // itself into a bucket meant for facts about the material. The parser drops such an entry, and the
  // drop raises the day's issue, so the prompt is the only surface that can stop it being emitted.
  it("binds a note to something in the module, and leaves the list empty when there is none", () => {
    assert.match(
      prompt,
      /Every note is about the module: a file in the folder, a source in the mirror, a line in the register/u,
    );
    assert.match(prompt, /a morning that found none returns `noted` empty/u);
  });

  it("makes precedent, working state and reasoning what a pass decides with", () => {
    assert.match(
      prompt,
      /The precedent you read, the state you carried from step to step and the reasoning behind a call are what you decide \*with\*/u,
    );
    assert.match(prompt, /a note holds what you decide \*about\*/u);
  });

  it("sends a diverged placed copy holding its ground to `noted`, and an arrival still to `parked`", () => {
    assert.match(
      prompt,
      /A placed copy that has diverged from its source and is holding its ground is `noted`/u,
    );
    assert.match(
      prompt,
      /An update arrival against a worked-on copy is the other case and still parks/u,
    );
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
