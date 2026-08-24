import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readDefinitionImporterRoots,
  readDefinitionImporterSources,
} from "../../src/conformance/index.js";
import {
  readCurationRegisterEvents,
  walkedCurationItems,
} from "../../src/curation/index.js";

// A real Definition, in the shape the cohort's actually take.
const definition = [
  "sources:",
  "  ntulearn:",
  "    - {role: primary, destination: NTULearn, evidence: [course-site]}",
  "",
].join("\n");

// A real register line: `integration` is the key under `sources`, never the destination folder.
const register = `${JSON.stringify({
  schema_version: 2,
  source_id: "1DriveFileIdentifier",
  integration: "ntulearn",
  role: "primary",
  source_path: "01 Materials/handout.pdf",
  checksum: "md5:0f7e8b1c2d3a4b5c6d7e8f90a1b2c3d4",
  decision: "curated",
  destination: "10 Learning Materials/handout.pdf",
  evidence: "the standing precedent",
  timestamp: "2026-01-04T02:00:00.000Z",
})}\n`;

describe("the two importer vocabularies", () => {
  it("reads the integration key and the destination folder as different things", () => {
    const sources = readDefinitionImporterSources(definition);

    assert.deepEqual(sources, [
      { integration: "ntulearn", destinations: ["NTULearn"] },
    ]);
    assert.deepEqual(readDefinitionImporterRoots(definition), ["NTULearn"]);
    assert.notDeepEqual(
      sources.map(({ integration }) => integration),
      readDefinitionImporterRoots(definition),
    );
  });

  // The bug this pins: matching a line's `integration` against a destination kept nothing, and the
  // pass reported an all-clear over every legacy line in the cohort.
  it("meets a register line when matched on the integration key", () => {
    const sources = readDefinitionImporterSources(definition);

    const met = walkedCurationItems(
      readCurationRegisterEvents(register),
      sources.map(({ integration }) => integration),
    );

    assert.equal(met.length, 1);
    assert.equal(met[0]?.identity, "legacy");
    assert.equal(met[0]?.key, "ntulearn/Materials/handout.pdf");
  });

  it("meets nothing when matched on the destination folder instead", () => {
    const met = walkedCurationItems(
      readCurationRegisterEvents(register),
      readDefinitionImporterSources(definition).flatMap(
        ({ destinations }) => destinations,
      ),
    );

    assert.deepEqual(met, []);
  });
});
