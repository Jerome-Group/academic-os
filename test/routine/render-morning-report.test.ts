import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PreludeStepReport,
  renderMorningReport,
} from "../../src/routine/index.js";

const prelude: PreludeStepReport[] = [
  {
    step: "textbook-shelf-catch-up",
    outcome: "requires-decision",
    parked: 1,
    detail: [
      "9 on the shelf, 7 already indexed, 1 appended",
      "Appended Axler — Linear Algebra Done Right 4e Axler.pdf",
    ],
  },
  {
    step: "task-register-pull",
    outcome: "refreshed",
    parked: 0,
    detail: ["AB1234 (Y2S1): fresh; 1 added, 0 updated, 0 newly cancelled"],
  },
];

describe("the morning report's fixed format", () => {
  it("renders every section and every bucket, empty or not", () => {
    const text = renderMorningReport({
      date: "2026-08-23",
      prelude,
      modules: [
        {
          semester: "Y2S1",
          module: "AB1234",
          artifacts: "/state/routine/sessions/2026-08-23/AB1234",
          curated: [{ item: "source/handout.pdf", destination: "placed.pdf" }],
          rederived: [{ item: "source/notice.html", derived: ["profile.md"] }],
          superseded: [],
          withdrawn: [
            {
              item: "source/makeup-class.md",
              evidence:
                "Follows the module's standing precedent for a page the site has removed.",
            },
          ],
          parked: [
            {
              item: "source/odd.zip",
              reason: "no precedent",
              evidence: "the register cites nothing like it",
            },
          ],
          docWrites: [{ file: "CONTEXT.md", summary: "minted a term" }],
          failures: [],
          noted: [
            {
              item: "source/worked-handout.pdf",
              note: "The placed copy has diverged from its source and holds its ground.",
            },
          ],
        },
      ],
      purge: { sessions: ["2026-08-15"], reports: [] },
    });

    assert.equal(
      text,
      [
        "# Morning report 2026-08-23",
        "",
        "## Prelude",
        "",
        "- Textbook shelf catch-up — requires-decision",
        "  - 9 on the shelf, 7 already indexed, 1 appended",
        "  - Appended Axler — Linear Algebra Done Right 4e Axler.pdf",
        "  - Parked — 1",
        "- Task register pull — refreshed",
        "  - AB1234 (Y2S1): fresh; 1 added, 0 updated, 0 newly cancelled",
        "  - Parked — 0",
        "",
        "## Modules",
        "",
        "### AB1234 — Y2S1",
        "",
        "- Curated — 1",
        "  - source/handout.pdf → placed.pdf",
        "- Rederived — 1",
        "  - source/notice.html → profile.md",
        "- Superseded — 0",
        "- Withdrawn — 1",
        "  - source/makeup-class.md — Follows the module's standing precedent for a page the site has removed.",
        "- Parked — 1",
        "  - source/odd.zip — no precedent; evidence: the register cites nothing like it",
        "- Doc writes — 1",
        "  - CONTEXT.md — minted a term",
        "- Failures — 0",
        "- Noted — 1",
        "  - source/worked-handout.pdf — The placed copy has diverged from its source and holds its ground.",
        "- Artifacts — /state/routine/sessions/2026-08-23/AB1234",
        "",
        "## Retention purge",
        "",
        "- Session artifacts — 1",
        "  - 2026-08-15",
        "- Reports — 0",
        "",
      ].join("\n"),
    );
  });

  it("says a prelude step failed rather than leaving the line out", () => {
    const text = renderMorningReport({
      date: "2026-08-23",
      prelude: [
        {
          step: "textbook-shelf-catch-up",
          outcome: "failed",
          parked: 0,
          detail: [],
          failure: { code: "invalid-config", message: "the shelf is missing" },
        },
      ],
      modules: [],
      purge: { sessions: [], reports: [] },
    });

    assert.match(text, /- Failed — invalid-config: the shelf is missing/u);
    assert.match(
      text,
      /## Modules\n\n_No modules in the monitoring cohort\._/u,
    );
  });
});
