import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ObservedModuleRederivation,
  planCurationRederivation,
} from "../../src/curation/index.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const now = "2026-08-27T06:00:00.000Z";
const sourceSha256 = "a".repeat(64);
const chapterOneSha256 = "1".repeat(64);
const chapterTwoSha256 = "2".repeat(64);
const combined = "03 Combined Notes.pdf";
const itemKey = "ntulearn/Combined Notes.pdf";
const batchStamp = "2026-08-23T20:36:46Z";

const chapterOne = "10 Learning Materials/AB1234_Chapter_01_Notes.pdf";
const chapterTwo = "10 Learning Materials/AB1234_Chapter_02_Notes.pdf";
const wholeCopy = "10 Learning Materials/AB1234_Course_Notes.pdf";

function curatedLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 3,
    source_id: "Combined Notes.pdf",
    integration: "ntulearn",
    role: "lecture",
    source_path: combined,
    checksum: `sha256:${sourceSha256}`,
    decision: "curated",
    destination: chapterOne,
    evidence: "Follows the standing precedent for lecture notes.",
    timestamp: batchStamp,
    ...overrides,
  });
}

function observed(input: {
  register: string;
  artifacts?: Record<string, string>;
  source?: { sha256: string } | undefined;
}): ObservedModuleRederivation {
  return {
    module: "AB1234",
    semester: "Y2S1",
    register: input.register,
    integrations: ["ntulearn"],
    sources:
      input.source === undefined
        ? new Map()
        : new Map([
            [
              itemKey,
              {
                location: `NTULearn/${combined}`,
                sourcePath: combined,
                sha256: input.source.sha256,
              },
            ],
          ]),
    artifacts: new Map(Object.entries(input.artifacts ?? {})),
  };
}

// One source, several artifacts, one line each — the shape MF-CURATION-005 names. The chapters are
// cuts, so their bytes are their own; the whole copy is the source's bytes and is a real curated
// decision beside them.
const splitRegister = [
  curatedLine({ destination: chapterOne }),
  curatedLine({ destination: chapterTwo }),
  curatedLine({ destination: wholeCopy }),
].join("\n");

const splitArtifacts = {
  [chapterOne]: chapterOneSha256,
  [chapterTwo]: chapterTwoSha256,
  [wholeCopy]: sourceSha256,
};

function planOne(module: ObservedModuleRederivation) {
  const plan = planCurationRederivation({ modules: [module], now });
  const planned = plan.modules[0];
  assert.ok(planned !== undefined);
  return { plan, planned };
}

describe("planning a split source's correction", () => {
  it("makes one rederived line out of a curated line per artifact [MF-CURATION-005]", () => {
    const { plan, planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(plan.outcome, "split");
    assert.equal(planned.rederivations.length, 1);
    const [correction] = planned.rederivations;
    assert.ok(correction !== undefined);

    recordBehaviorEvidence("MF-CURATION-005", () => {
      const line: Record<string, unknown> = JSON.parse(correction.line);
      assert.equal(line.decision, "rederived");
      assert.deepEqual(line.derived, [chapterOne, chapterTwo]);
      assert.equal(line.destination, undefined);
      assert.equal(line.source_id, "Combined Notes.pdf");
      assert.equal(line.supersedes, `Combined Notes.pdf@${batchStamp}`);
    });
  });

  // The whole copy is the case a correction reading "split, therefore nothing was copied" destroys.
  it("leaves a destination holding the source's own bytes curated", () => {
    const { planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    const [correction] = planned.rederivations;
    assert.deepEqual(correction?.copies, [wholeCopy]);
    assert.equal(correction?.derived.includes(wholeCopy), false);
    assert.match(
      correction?.line ?? "",
      /holds the source's own bytes and stays curated/u,
    );
  });

  it("plans nothing for a source curated to one destination", () => {
    const { plan, planned } = planOne(
      observed({
        register: curatedLine(),
        artifacts: { [chapterOne]: chapterOneSha256 },
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(plan.outcome, "settled");
    assert.deepEqual(planned.rederivations, []);
    assert.deepEqual(planned.discrepancies, []);
  });

  // The join table's update arrival stacks many curated lines under one key by design, and each
  // batch supersedes the one before it. Reading them together would rewrite a settled re-decision.
  it("reads only the last batch, so a superseded update arrival is not a split", () => {
    const arrival = [
      curatedLine({
        destination: chapterOne,
        timestamp: "2026-08-20T01:00:00Z",
      }),
      curatedLine({
        destination: chapterTwo,
        timestamp: "2026-08-20T01:00:00Z",
      }),
      curatedLine({
        destination: wholeCopy,
        timestamp: batchStamp,
        supersedes: `Combined Notes.pdf@2026-08-20T01:00:00Z`,
      }),
    ].join("\n");

    const { plan } = planOne(
      observed({
        register: arrival,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(plan.outcome, "settled");
    assert.equal(plan.counts.rederiving, 0);
  });

  it("leaves a source whose bytes have moved to the curation walk", () => {
    const { plan, planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: splitArtifacts,
        source: { sha256: "f".repeat(64) },
      }),
    );

    assert.equal(plan.counts.changed, 1);
    assert.deepEqual(planned.rederivations, []);
    assert.match(
      planned.discrepancies[0]?.evidence ?? "",
      /update arrival for the curation walk to decide/u,
    );
  });

  // #194's ruling, applied to a register line: the smaller claim gets the smaller answer.
  it("corrects the item around one line whose digest it cannot read", () => {
    const register = [
      curatedLine({ destination: chapterOne }),
      curatedLine({
        destination: chapterTwo,
        checksum: `sha256:${"a".repeat(63)}`,
      }),
      curatedLine({ destination: wholeCopy }),
    ].join("\n");

    const { planned } = planOne(
      observed({
        register,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    const [correction] = planned.rederivations;
    assert.deepEqual(correction?.unreadable, [chapterTwo]);
    assert.deepEqual(correction?.derived, [chapterOne, chapterTwo]);
  });

  it("names a destination the mount does not hold rather than asserting it", () => {
    const { planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: {
          [chapterOne]: chapterOneSha256,
          [wholeCopy]: sourceSha256,
        },
        source: { sha256: sourceSha256 },
      }),
    );

    const [correction] = planned.rederivations;
    assert.deepEqual(correction?.missing, [chapterTwo]);
    assert.deepEqual(correction?.derived, [chapterOne]);
  });

  // A whole copy the Owner has annotated differs from its source exactly as a cut does. Sweeping it
  // into `derived` would close the item and retire the standing divergence MF-CURATION-002 tells.
  it("refuses a batch where nothing holds the source's own bytes", () => {
    const { plan, planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: {
          [chapterOne]: chapterOneSha256,
          [chapterTwo]: chapterTwoSha256,
          [wholeCopy]: "9".repeat(64),
        },
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(plan.counts.unprovable, 1);
    assert.deepEqual(planned.rederivations, []);
    assert.match(
      planned.discrepancies[0]?.evidence ?? "",
      /cannot tell 3 artifacts cut out of the source from a copy of it that was placed and then worked on/u,
    );
  });

  it("sends a batch still on legacy identity to the migration first", () => {
    const legacy = [
      curatedLine({
        source_id: "1DriveFileIdentifier",
        destination: chapterOne,
      }),
      curatedLine({
        source_id: "1DriveFileIdentifier",
        destination: chapterTwo,
      }),
    ].join("\n");

    const { plan, planned } = planOne(
      observed({
        register: legacy,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(plan.counts["legacy-identity"], 1);
    assert.match(
      planned.discrepancies[0]?.evidence ?? "",
      /Run curation migrate first/u,
    );
  });

  it("reports a register it cannot read as a blocker rather than throwing", () => {
    const { planned } = planOne(observed({ register: "{not json}\n" }));

    assert.equal(planned.blockers.length, 1);
    assert.deepEqual(planned.rederivations, []);
  });

  it("plans nothing twice: a corrected register's standing batch is the rederived line", () => {
    const { planned } = planOne(
      observed({
        register: splitRegister,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );
    const corrected = `${splitRegister}\n${planned.rederivations[0]?.line}`;

    const { plan: second } = planOne(
      observed({
        register: corrected,
        artifacts: splitArtifacts,
        source: { sha256: sourceSha256 },
      }),
    );

    assert.equal(second.outcome, "settled");
    assert.equal(second.counts.rederiving, 0);
  });
});
