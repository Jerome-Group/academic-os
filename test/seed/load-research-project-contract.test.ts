import assert from "node:assert/strict";
import { it } from "node:test";

import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";

it("loads every research seed-source template at its destination path", async () => {
  const contract = await loadResearchProjectContract();

  assert.equal(contract.version, 2);
  assert.match(
    contract.seedFiles["AGENTS.md"] ?? "",
    /Owner authors mathematics/u,
  );
  assert.ok(contract.seedFiles["60 Templates/research-note.tex"]);
  assert.ok(contract.seedFiles["10 Source Materials/references.bib"]);
});
