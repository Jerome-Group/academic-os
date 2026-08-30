import assert from "node:assert/strict";
import { it } from "node:test";

import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";

it("loads every research seed-source template at its destination path", async () => {
  const contract = await loadResearchProjectContract();

  assert.equal(contract.version, 1);
  assert.match(
    contract.seedFiles["AGENTS.md"] ?? "",
    /Owner authors the mathematics/u,
  );
  assert.ok(contract.seedFiles["70 Research/templates/mathematics-note.tex"]);
  assert.ok(contract.seedFiles["10 Source Materials/references.bib"]);
});
