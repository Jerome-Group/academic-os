import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planCurationIdentityMigration,
  readCurationRegisterEvents,
  standingCurationItems,
  unnumberedSourcePath,
  walkedCurationItems,
  type ObservedModuleRegister,
} from "../../src/curation/index.js";

const now = "2026-08-24T06:00:00.000Z";
const unchangedSha256 = "a".repeat(64);
const unchangedMd5 = "b".repeat(32);
const workedSha256 = "c".repeat(64);
const workedMd5 = "d".repeat(32);
const recordedPath = "03 Materials/02 Graph Theory/handout.pdf";
const itemKey = "ntulearn/Materials/Graph Theory/handout.pdf";

function legacyLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    source_id: "1DriveFileIdentifier",
    integration: "ntulearn",
    role: "handout",
    source_path: recordedPath,
    checksum: `md5:${unchangedMd5}`,
    decision: "curated",
    destination: "10 Learning Materials/handout.pdf",
    evidence: "Follows the standing precedent for handouts.",
    timestamp: "2026-01-04T02:00:00.000Z",
    ...overrides,
  });
}

// The line the curation walk appends once the Owner's precedent says the source is gone for good.
// It supersedes nothing: the line that placed the copy stays the record of where the item went.
function withdrawnLine(): string {
  return legacyLine({
    schema_version: 3,
    source_id: "Materials/Graph Theory/handout.pdf",
    decision: "withdrawn",
    destination: undefined,
    checksum: undefined,
    evidence: "The source has left the mirror; the placed copy stays.",
    timestamp: "2026-08-25T06:00:00.000Z",
  });
}

const noItems = {
  "contract-v4": 0,
  migrating: 0,
  changed: 0,
  unprovable: 0,
  "missing-source": 0,
};

// The mirror as the pass indexes it: keyed by contract-v4 identity's path half, and carrying the
// path the file is at now, which is not the one the standing line recorded once numbering shifts.
function mirror(
  sources: Record<string, { sha256: string; md5: string; sourcePath?: string }>,
) {
  return new Map(
    Object.entries(sources).map(([key, source]) => [
      key,
      {
        sourcePath: source.sourcePath ?? recordedPath,
        location: `NTULearn/${source.sourcePath ?? recordedPath}`,
        sha256: source.sha256,
        md5: source.md5,
      },
    ]),
  );
}

const unchangedMirror = mirror({
  [itemKey]: { sha256: unchangedSha256, md5: unchangedMd5 },
});

function observed(input: {
  lines: readonly string[];
  sources?: ReturnType<typeof mirror>;
  ambiguous?: readonly string[];
}): ObservedModuleRegister {
  return {
    module: "AA1001",
    semester: "Y2S1",
    register: input.lines.length === 0 ? "" : `${input.lines.join("\n")}\n`,
    integrations: ["ntulearn"],
    sources: input.sources ?? new Map(),
    ambiguousSources: new Set(input.ambiguous ?? []),
  };
}

function planFor(module: ObservedModuleRegister) {
  const plan = planCurationIdentityMigration({ modules: [module], now });
  const only = plan.modules[0];
  assert.ok(only !== undefined);
  return { plan, module: only };
}

function appendedEvent(line: string | undefined): Record<string, unknown> {
  assert.ok(line !== undefined);
  return JSON.parse(line);
}

describe("unnumberedSourcePath", () => {
  it("strips the importer's ordering prefix from every segment", () => {
    assert.equal(
      unnumberedSourcePath(recordedPath),
      "Materials/Graph Theory/handout.pdf",
    );
  });

  it("leaves a name whose own number is not an ordering prefix alone", () => {
    assert.equal(
      unnumberedSourcePath("2026 Review/handout.pdf"),
      "2026 Review/handout.pdf",
    );
  });
});

describe("planCurationIdentityMigration", () => {
  it("carries a legacy line whose bytes are unchanged onto contract-v4 identity", () => {
    const { module } = planFor(
      observed({ lines: [legacyLine()], sources: unchangedMirror }),
    );

    assert.equal(module.counts.migrating, 1);
    assert.equal(module.legacyLines, 1);
    const migration = module.migrations[0];
    assert.ok(migration !== undefined);
    assert.equal(migration.supersedes, "1DriveFileIdentifier");
    assert.equal(migration.sha256, unchangedSha256);
    assert.equal(migration.sourceLocation, `NTULearn/${recordedPath}`);
    const appended = appendedEvent(migration.line);
    assert.equal(appended.source_id, "Materials/Graph Theory/handout.pdf");
    assert.equal(appended.checksum, unchangedSha256);
    assert.equal(appended.decision, "curated");
    assert.equal(appended.destination, "10 Learning Materials/handout.pdf");
    assert.equal(appended.role, "handout");
    assert.equal(appended.source_path, recordedPath);
    assert.equal(appended.timestamp, now);
    assert.equal(appended.supersedes, "1DriveFileIdentifier");
  });

  it("writes today's schema version rather than the retired one it supersedes", () => {
    const { module } = planFor(
      observed({ lines: [legacyLine()], sources: unchangedMirror }),
    );

    assert.equal(appendedEvent(module.migrations[0]?.line).schema_version, 3);
  });

  it("records where a renumbered source actually is now", () => {
    const { module } = planFor(
      observed({
        lines: [legacyLine()],
        sources: mirror({
          [itemKey]: {
            sha256: unchangedSha256,
            md5: unchangedMd5,
            sourcePath: "04 Materials/02 Graph Theory/handout.pdf",
          },
        }),
      }),
    );

    assert.equal(module.counts.migrating, 1);
    assert.equal(
      module.migrations[0]?.sourceLocation,
      "NTULearn/04 Materials/02 Graph Theory/handout.pdf",
    );
    assert.equal(
      appendedEvent(module.migrations[0]?.line).source_path,
      "04 Materials/02 Graph Theory/handout.pdf",
    );
  });

  it("carries a rederived line's derived artifacts across untouched", () => {
    const { module } = planFor(
      observed({
        lines: [
          legacyLine({
            schema_version: 2,
            decision: "rederived",
            destination: undefined,
            derived: ["docs/adr/0002-graph-conventions.md"],
          }),
        ],
        sources: unchangedMirror,
      }),
    );

    const appended = appendedEvent(module.migrations[0]?.line);
    assert.equal(appended.decision, "rederived");
    assert.equal(appended.destination, undefined);
    assert.deepEqual(appended.derived, ["docs/adr/0002-graph-conventions.md"]);
  });

  it("gives a source-only line no destination it never had", () => {
    const { module } = planFor(
      observed({
        lines: [
          legacyLine({ decision: "source-only", destination: undefined }),
        ],
        sources: unchangedMirror,
      }),
    );

    const appended = appendedEvent(module.migrations[0]?.line);
    assert.equal(appended.decision, "source-only");
    assert.equal(appended.destination, undefined);
  });

  it("leaves a legacy line whose source bytes differ for the curation walk to decide", () => {
    const { module } = planFor(
      observed({
        lines: [legacyLine()],
        sources: mirror({
          [itemKey]: { sha256: workedSha256, md5: workedMd5 },
        }),
      }),
    );

    assert.equal(module.counts.migrating, 0);
    assert.equal(module.counts.changed, 1);
    assert.deepEqual(module.migrations, []);
    assert.equal(module.discrepancies[0]?.state, "changed");
    assert.match(module.discrepancies[0].evidence, /update arrival/u);
  });

  it("surfaces a legacy line whose source has left the mirror", () => {
    const { module } = planFor(observed({ lines: [legacyLine()] }));

    assert.equal(module.counts["missing-source"], 1);
    assert.deepEqual(module.migrations, []);
  });

  // #186: a standing line whose source has left the mirror was reported every morning and nothing
  // could close it. The withdrawal is what closes it, and closing it is what ends the report.
  it("stops reporting an item once a withdrawal has closed it", () => {
    const before = planFor(observed({ lines: [legacyLine()] }));

    assert.equal(before.module.counts["missing-source"], 1);
    assert.equal(before.module.legacyLines, 1);

    const after = planFor(observed({ lines: [legacyLine(), withdrawnLine()] }));

    assert.equal(after.plan.outcome, "contract-v4");
    assert.deepEqual(after.module.counts, noItems);
    assert.deepEqual(after.module.discrepancies, []);
    assert.deepEqual(after.module.migrations, []);
    assert.equal(after.module.legacyLines, 0);
  });

  it("leaves a source that came back for the arrival walk to classify", () => {
    const { module } = planFor(
      observed({
        lines: [legacyLine(), withdrawnLine()],
        sources: unchangedMirror,
      }),
    );

    assert.deepEqual(module.counts, noItems);
    assert.deepEqual(module.migrations, []);
    assert.deepEqual(module.discrepancies, []);
  });

  it("writes nothing for a key two files in the mirror both answer to", () => {
    const { module } = planFor(
      observed({ lines: [legacyLine()], ambiguous: [itemKey] }),
    );

    assert.equal(module.counts.unprovable, 1);
    assert.deepEqual(module.migrations, []);
    assert.match(module.discrepancies[0]?.evidence ?? "", /Two files/u);
  });

  it("cannot prove a legacy line that records no comparable checksum", () => {
    const { module } = planFor(
      observed({
        lines: [legacyLine({ checksum: undefined })],
        sources: unchangedMirror,
      }),
    );

    assert.equal(module.counts.unprovable, 1);
    assert.deepEqual(module.migrations, []);
  });

  it("reads a line already carrying contract-v4 identity as needing nothing", () => {
    const { plan, module } = planFor(
      observed({
        lines: [
          legacyLine({
            source_id: "Materials/Graph Theory/handout.pdf",
            checksum: unchangedSha256,
          }),
        ],
      }),
    );

    assert.equal(plan.outcome, "contract-v4");
    assert.equal(module.counts["contract-v4"], 1);
    assert.equal(module.legacyLines, 0);
    assert.deepEqual(module.migrations, []);
  });

  it("ignores a line no arrival walk can meet", () => {
    const { module } = planFor(
      observed({
        lines: [
          legacyLine({
            integration: "historical-migration",
            role: "historical-source",
          }),
        ],
      }),
    );

    assert.equal(module.legacyLines, 0);
    assert.deepEqual(module.counts, noItems);
  });

  it("plans nothing at all for an empty register", () => {
    const { plan, module } = planFor(observed({ lines: [] }));

    assert.equal(plan.outcome, "contract-v4");
    assert.deepEqual(module.blockers, []);
    assert.deepEqual(module.migrations, []);
  });

  it("reads a register whose lines end with CRLF", () => {
    const { module } = planFor({
      ...observed({ lines: [], sources: unchangedMirror }),
      register: `${legacyLine()}\r\n`,
    });

    assert.equal(module.counts.migrating, 1);
  });

  it("plans one migration per item, from the line that currently stands for it", () => {
    const { module } = planFor(
      observed({
        lines: [
          legacyLine({ source_id: "1First", checksum: `md5:${workedMd5}` }),
          legacyLine({ source_id: "1Second" }),
        ],
        sources: unchangedMirror,
      }),
    );

    assert.equal(module.migrations.length, 1);
    assert.equal(module.migrations[0]?.supersedes, "1Second");
    assert.equal(module.legacyLines, 2);
  });

  it("refuses to append to a register that is not a valid control", () => {
    const { module } = planFor({
      ...observed({ lines: [] }),
      register: "not-json\n",
    });

    assert.equal(module.blockers.length, 1);
    assert.deepEqual(module.migrations, []);
  });

  it("writes the checksum notation the register's own contract-v4 lines use", () => {
    const { module } = planFor(
      observed({
        lines: [
          legacyLine({
            source_id: "Materials/Graph Theory/notes.pdf",
            source_path: "03 Materials/02 Graph Theory/notes.pdf",
            checksum: `sha256:${workedSha256}`,
          }),
          legacyLine(),
        ],
        sources: unchangedMirror,
      }),
    );

    assert.equal(
      appendedEvent(module.migrations[0]?.line).checksum,
      `sha256:${unchangedSha256}`,
    );
  });

  it("plans nothing further over a register it has already migrated", () => {
    const first = planFor(
      observed({ lines: [legacyLine()], sources: unchangedMirror }),
    );
    const migrated = observed({
      lines: [legacyLine(), ...first.module.migrations.map(({ line }) => line)],
      sources: unchangedMirror,
    });

    const second = planFor(migrated);

    assert.equal(second.plan.outcome, "contract-v4");
    assert.deepEqual(second.module.migrations, []);
    assert.equal(second.module.counts["contract-v4"], 1);
  });

  it("leaves an arrival walk over unchanged material nothing to re-decide", () => {
    const { module } = planFor(
      observed({ lines: [legacyLine()], sources: unchangedMirror }),
    );
    const migrated = observed({
      lines: [legacyLine(), ...module.migrations.map(({ line }) => line)],
      sources: unchangedMirror,
    });

    const standing = standingCurationItems(
      walkedCurationItems(readCurationRegisterEvents(migrated.register), [
        "ntulearn",
      ]),
    );

    assert.equal(standing.length, 1);
    assert.equal(standing[0]?.identity, "contract-v4");
    assert.equal(standing[0]?.sourceId, standing[0]?.unnumberedPath);
    assert.equal(standing[0]?.checksum?.value, unchangedSha256);
  });
});
