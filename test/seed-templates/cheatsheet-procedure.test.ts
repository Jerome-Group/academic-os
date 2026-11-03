import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const procedurePath = "seed-templates/docs/40 Cheatsheet Procedure.template.md";

it("keeps independent source enumeration, preservation and frozen review gates explicit", async () => {
  const procedure = await readFile(procedurePath, "utf8");
  assert.match(procedure, /Read every selected source completely/u);
  assert.match(procedure, /every numbered or\nlettered subpart/u);
  for (const gate of [
    "Source completeness",
    "Prior-content preservation",
    "Mathematical sufficiency",
    "Selected proof checks",
    "Layout",
    "Portability",
  ]) {
    assert.ok(
      procedure.includes(`**${gate}:**`),
      `missing ${gate} review verdict`,
    );
  }
  assert.match(procedure, /Freeze the PDF SHA-256 before review/u);
  assert.match(
    procedure,
    /every full page and enlarged images of every column/u,
  );
  assert.match(procedure, /failure inspected/u);
  assert.match(procedure, /Restore original bytes/u);
});

it("keeps transformed generation under one authority and current build evidence", async () => {
  const procedure = await readFile(procedurePath, "utf8");
  assert.match(procedure, /Declare exactly\none composition mode/u);
  assert.match(procedure, /Transformations must\nbe materialized/u);
  assert.match(procedure, /fresh staging/u);
  assert.match(procedure, /full `pdftohtml -xml -hidden` output/u);
  assert.match(procedure, /resolve paths from the current report/u);
  assert.match(
    procedure,
    /Unknown geometry or review\nobservations remain unknown/u,
  );
  assert.match(procedure, /Around\n4 pt is a configurable/u);
});
