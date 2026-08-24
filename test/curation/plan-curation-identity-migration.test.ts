import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planCurationIdentityMigration,
  readCurationRegisterLines,
  standingCurationItems,
  unnumberedSourcePath,
  type ObservedCurationSource,
  type ObservedModuleRegister,
} from "../../src/curation/index.js";

const now = "2026-08-24T06:00:00.000Z";
const unchangedSha256 = "a".repeat(64);
const unchangedMd5 = "b".repeat(32);
const workedSha256 = "c".repeat(64);
const workedMd5 = "d".repeat(32);

function legacyLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    schema_version: 1,
    source_id: "1DriveFileIdentifier",
    integration: "NTULearn",
    role: "handout",
    source_path: "03 Materials/02 Graph Theory/handout.pdf",
    checksum: `md5:${unchangedMd5}`,
    decision: "curated",
    destination: "10 Learning Materials/handout.pdf",
    evidence: "Follows the standing precedent for handouts.",
    timestamp: "2026-01-04T02:00:00.000Z",
    ...overrides,
  });
}

function observed(
  lines: readonly string[],
  sources: Record<string, ObservedCurationSource>,
): ObservedModuleRegister {
  return {
    module: "AA1001",
    semester: "Y2S1",
    register: `${lines.join("\n")}\n`,
    importerRoots: ["NTULearn"],
    sources: new Map(Object.entries(sources)),
  };
}

function planFor(module: ObservedModuleRegister) {
  const plan = planCurationIdentityMigration({ modules: [module], now });
  const only = plan.modules[0];
  assert.ok(only !== undefined);
  return { plan, module: only };
}

describe("unnumberedSourcePath", () => {
  it("strips the importer's ordering prefix from every segment", () => {
    assert.equal(
      unnumberedSourcePath("03 Materials/02 Graph Theory/handout.pdf"),
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
      observed([legacyLine({})], {
        "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
          sha256: unchangedSha256,
          md5: unchangedMd5,
        },
      }),
    );

    assert.equal(module.counts.migrating, 1);
    const migration = module.migrations[0];
    assert.ok(migration !== undefined);
    assert.equal(migration.supersedes, "1DriveFileIdentifier");
    const appended: Record<string, unknown> = JSON.parse(migration.line);
    assert.equal(appended.source_id, "Materials/Graph Theory/handout.pdf");
    assert.equal(appended.checksum, unchangedSha256);
    assert.equal(appended.decision, "curated");
    assert.equal(appended.destination, "10 Learning Materials/handout.pdf");
    assert.equal(appended.role, "handout");
    assert.equal(
      appended.source_path,
      "03 Materials/02 Graph Theory/handout.pdf",
    );
    assert.equal(appended.timestamp, now);
    assert.equal(appended.supersedes, "1DriveFileIdentifier");
  });

  it("leaves a legacy line whose source bytes differ for the curation walk to decide", () => {
    const { module } = planFor(
      observed([legacyLine({})], {
        "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
          sha256: workedSha256,
          md5: workedMd5,
        },
      }),
    );

    assert.equal(module.counts.migrating, 0);
    assert.equal(module.counts.changed, 1);
    assert.deepEqual(module.migrations, []);
    assert.equal(module.discrepancies[0]?.state, "changed");
    assert.match(module.discrepancies[0].evidence, /update arrival/u);
  });

  it("surfaces a legacy line whose source has left the mirror", () => {
    const { module } = planFor(observed([legacyLine({})], {}));

    assert.equal(module.counts["missing-source"], 1);
    assert.deepEqual(module.migrations, []);
  });

  it("cannot prove a legacy line that records no comparable checksum", () => {
    const { module } = planFor(
      observed([legacyLine({ checksum: undefined })], {
        "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
          sha256: unchangedSha256,
          md5: unchangedMd5,
        },
      }),
    );

    assert.equal(module.counts.unprovable, 1);
    assert.deepEqual(module.migrations, []);
  });

  it("reads a line already carrying contract-v4 identity as needing nothing", () => {
    const { plan, module } = planFor(
      observed(
        [
          legacyLine({
            source_id: "Materials/Graph Theory/handout.pdf",
            checksum: unchangedSha256,
          }),
        ],
        {},
      ),
    );

    assert.equal(plan.outcome, "contract-v4");
    assert.equal(module.counts["contract-v4"], 1);
    assert.deepEqual(module.migrations, []);
  });

  it("ignores a line no arrival walk can meet", () => {
    const { module } = planFor(
      observed(
        [
          legacyLine({
            integration: "historical-migration",
            role: "historical-source",
          }),
        ],
        {},
      ),
    );

    assert.deepEqual(module.counts, {
      "contract-v4": 0,
      migrating: 0,
      changed: 0,
      unprovable: 0,
      "missing-source": 0,
    });
  });

  it("plans one migration per item, from the line that currently stands for it", () => {
    const { module } = planFor(
      observed(
        [
          legacyLine({ source_id: "1First", checksum: `md5:${workedMd5}` }),
          legacyLine({ source_id: "1Second" }),
        ],
        {
          "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
            sha256: unchangedSha256,
            md5: unchangedMd5,
          },
        },
      ),
    );

    assert.equal(module.migrations.length, 1);
    assert.equal(module.migrations[0]?.supersedes, "1Second");
  });

  it("refuses to append to a register that is not a valid control", () => {
    const { module } = planFor({
      module: "AA1001",
      semester: "Y2S1",
      register: "not-json\n",
      importerRoots: ["NTULearn"],
      sources: new Map(),
    });

    assert.equal(module.blockers.length, 1);
    assert.deepEqual(module.migrations, []);
  });

  it("writes the checksum notation the register's own contract-v4 lines use", () => {
    const { module } = planFor(
      observed(
        [
          legacyLine({
            source_id: "Materials/Graph Theory/notes.pdf",
            source_path: "03 Materials/02 Graph Theory/notes.pdf",
            checksum: `sha256:${workedSha256}`,
          }),
          legacyLine({}),
        ],
        {
          "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
            sha256: unchangedSha256,
            md5: unchangedMd5,
          },
        },
      ),
    );

    assert.equal(module.migrations[0]?.to, `sha256:${unchangedSha256}`);
  });

  it("plans nothing further over a register it has already migrated", () => {
    const sources = {
      "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
        sha256: unchangedSha256,
        md5: unchangedMd5,
      },
    };
    const first = planFor(observed([legacyLine({})], sources));
    const migrated = observed(
      [legacyLine({}), ...first.module.migrations.map(({ line }) => line)],
      sources,
    );

    const second = planFor(migrated);

    assert.equal(second.plan.outcome, "contract-v4");
    assert.deepEqual(second.module.migrations, []);
    assert.equal(second.module.counts["contract-v4"], 1);
  });

  it("leaves an arrival walk over unchanged material nothing to re-decide", () => {
    const sources = {
      "NTULearn/03 Materials/02 Graph Theory/handout.pdf": {
        sha256: unchangedSha256,
        md5: unchangedMd5,
      },
    };
    const { module } = planFor(observed([legacyLine({})], sources));
    const migrated = observed(
      [legacyLine({}), ...module.migrations.map(({ line }) => line)],
      sources,
    );

    const standing = standingCurationItems(
      readCurationRegisterLines(migrated.register),
      ["NTULearn"],
    );

    assert.equal(standing.length, 1);
    assert.equal(standing[0]?.identity, "contract-v4");
    assert.equal(standing[0]?.sourceId, standing[0]?.unnumberedPath);
    assert.equal(standing[0]?.checksum?.value, unchangedSha256);
  });
});
