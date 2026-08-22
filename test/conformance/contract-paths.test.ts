import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { controlPaths } from "../../src/conformance/contract-paths.js";
import {
  isGovernedControlHome,
  moduleControlPaths,
  writtenControlPaths,
} from "../../src/conformance/control-paths.js";
import { pinnedDocumentPaths } from "../../src/contract/pinned-documents.js";

describe("isGovernedControlHome", () => {
  it("reaches a root control and one in Module Admin, and stops at the open interiors", () => {
    assert.equal(isGovernedControlHome("AGENTS.md"), true);
    assert.equal(
      isGovernedControlHome("00 Module Admin/00 Module Profile.md"),
      true,
    );
    assert.equal(isGovernedControlHome("docs/20 Teaching Procedure.md"), false);
    assert.equal(
      isGovernedControlHome("70 Learning/templates/preferences.md"),
      false,
    );
  });
});

describe("controlPaths", () => {
  it("holds every control a basename rule can reach, and only those", () => {
    assert.deepEqual(
      [...controlPaths],
      [
        ["00 Module Profile.md", "00 Module Admin/00 Module Profile.md"],
        [
          "10 Module Definition.yaml",
          "00 Module Admin/10 Module Definition.yaml",
        ],
        [
          "20 Curation Register.jsonl",
          "00 Module Admin/20 Curation Register.jsonl",
        ],
        ["30 Task Register.yaml", "00 Module Admin/30 Task Register.yaml"],
        ["40 Source Map.yaml", "00 Module Admin/40 Source Map.yaml"],
        [
          "50 Textbook Register.yaml",
          "00 Module Admin/50 Textbook Register.yaml",
        ],
        ["AGENTS.md", "AGENTS.md"],
        ["CLAUDE.md", "CLAUDE.md"],
        ["CONTEXT.md", "CONTEXT.md"],
      ],
    );
  });

  it("leaves out the controls whose interiors a file-name rule has no purchase in", () => {
    const excluded = Object.values(moduleControlPaths).filter(
      (path) => ![...controlPaths.values()].includes(path),
    );

    assert.deepEqual(excluded, [
      "docs/00 Structure and Naming.md",
      "docs/10 Curation Procedure.md",
      "docs/20 Teaching Procedure.md",
      "docs/30 Textbook Procedure.md",
      "70 Learning/templates/preferences.md",
    ]);
  });

  it("keys every entry by its own basename, so a lookup cannot disagree with its home", () => {
    for (const [name, path] of controlPaths) {
      assert.equal(path.split("/").at(-1), name);
    }
  });

  it("takes a control from either half without a second edit", () => {
    const written = Object.values(writtenControlPaths);
    const homes = [...controlPaths.values()];

    assert.ok(written.every((path) => homes.includes(path)));
    assert.ok(homes.includes(pinnedDocumentPaths.agents));
    assert.equal(homes.length, written.length + 1);
  });
});
