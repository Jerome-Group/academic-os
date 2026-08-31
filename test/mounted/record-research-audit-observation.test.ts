import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type {
  ResearchAuditResult,
  ResearchProjectInventory,
} from "../../src/conformance/index.js";
import {
  readResearchProjectAuditHistory,
  recordResearchProjectAuditObservation,
  type ObservationPublisher,
  type ResolvedConfiguredResearchProjectRoots,
} from "../../src/mounted/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const mountedInventory: ResearchProjectInventory = {
  projectKey: "example-project",
  entries: [{ path: "00 Project Admin", kind: "directory" }],
  provenance: {
    source: "mounted",
    target: "/synthetic/Example Project",
    completeness: "complete",
    diagnostics: [],
    excludedTrashedItems: 0,
  },
};

const deviation: ResearchAuditResult = {
  outcome: "requires-decision",
  findings: [
    {
      ruleId: "RP-ROOT-002",
      enforcement: "deterministic",
      status: "requires-decision",
      severity: "decision",
      path: "Unclassified Area",
      evidence: "An unclassified root directory exists.",
      explanation: "Classify the directory before moving it.",
      applicability: "Root placement applies to every Research project.",
    },
  ],
};

describe("Research-project audit observations", () => {
  it("keeps missing history read-only and stores a distinct Research schema", async () => {
    const target = await researchTarget();
    const missing = await readResearchProjectAuditHistory(target);

    assert.deepEqual(
      missing.diagnostics.map(({ kind }) => kind),
      ["missing-history"],
    );
    await assert.rejects(
      readdir(join(target.stateRoot, "observations")),
      /ENOENT/u,
    );

    const first = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T01:00:00.000Z",
    );

    assert.equal(first.comparison.basis, "no-prior-observation");
    assert.deepEqual(first.comparison.new, deviation.findings);
    assert.match(
      first.observationPath,
      /\/observations\/research-projects\/[a-f0-9]{64}\//u,
    );
    assert.equal(first.observation.observationType, "research-project-audit");
    assert.deepEqual(first.observation.target, {
      kind: "research-project",
      projectKey: "example-project",
      profile: "ureca",
      identity: target.projectRoot,
    });
    assert.equal(first.observation.inventory.projectKey, "example-project");
    assert.equal(first.observation.inventory.provenance?.source, "mounted");

    const second = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T02:00:00.000Z",
    );
    assert.equal(second.comparison.basis, "compatible-observation");
    assert.deepEqual(second.comparison.new, []);
    assert.deepEqual(second.comparison.unchanged, deviation.findings);

    const resolved = await record(
      target,
      mountedInventory,
      { outcome: "conformant", findings: [] },
      "2026-08-31T03:00:00.000Z",
    );
    assert.deepEqual(resolved.comparison.resolved, deviation.findings);
    assert.equal(
      (await observationFiles(dirname(first.observationPath))).length,
      3,
    );
  });

  it("preserves Drive API provenance in the observation", async () => {
    const target = await researchTarget();
    const driveInventory: ResearchProjectInventory = {
      ...mountedInventory,
      provenance: {
        source: "drive-api",
        target: "drive-folder-id",
        completeness: "complete",
        diagnostics: [],
        excludedTrashedItems: 2,
      },
    };

    const recorded = await record(
      target,
      driveInventory,
      { outcome: "conformant", findings: [] },
      "2026-08-31T01:00:00.000Z",
    );

    assert.deepEqual(recorded.observation.inventory.provenance, {
      source: "drive-api",
      target: "drive-folder-id",
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 2,
    });
    assert.deepEqual(recorded.observation.metadataAvailability, {
      contentChecksums: "entry-specific",
      reason:
        "Each Drive inventory entry records whether a provider checksum was observed.",
    });
  });

  it("uses compatible history while diagnosing corruption and incompatible schemas", async () => {
    const target = await researchTarget();
    const first = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T01:00:00.000Z",
    );
    const directory = dirname(first.observationPath);
    await writeFile(join(directory, "invalid-json.json"), "{not json");
    await writeFile(
      join(directory, "invalid-shape.json"),
      JSON.stringify({ ...first.observation, findings: [null] }),
    );
    await writeFile(
      join(directory, "future-research-schema.json"),
      JSON.stringify({ ...first.observation, ruleSetVersion: 99 }),
    );
    await writeFile(
      join(directory, "module-observation.json"),
      JSON.stringify({
        schemaVersion: 1,
        ruleSetVersion: 1,
        contractVersion: 4,
        target: {
          moduleCode: "MH2100",
          semester: "Y2S1",
          identity: target.projectRoot,
        },
      }),
    );

    const repeated = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T04:00:00.000Z",
    );

    assert.equal(repeated.comparison.basis, "compatible-observation");
    assert.deepEqual(
      repeated.historyDiagnostics.map(({ kind }) => kind).sort(),
      [
        "corrupt-history",
        "corrupt-history",
        "incompatible-history",
        "incompatible-history",
      ],
    );
  });

  it("preserves complete Research history and the temporary write on interruption", async () => {
    const target = await researchTarget();
    const first = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T01:00:00.000Z",
    );
    const directory = dirname(first.observationPath);
    const firstContents = await readFile(first.observationPath, "utf8");
    const publisher: ObservationPublisher = {
      publish: async (temporary, destination) => {
        const complete = JSON.parse(await readFile(temporary, "utf8")) as {
          observationType: string;
        };
        assert.equal(complete.observationType, "research-project-audit");
        await assert.rejects(readFile(destination, "utf8"));
        throw new Error("synthetic interruption before publication");
      },
    };

    await assert.rejects(
      record(
        target,
        mountedInventory,
        { outcome: "conformant", findings: [] },
        "2026-08-31T02:00:00.000Z",
        publisher,
      ),
      /Research-project observation could not be appended atomically/u,
    );
    assert.equal(await readFile(first.observationPath, "utf8"), firstContents);
    assert.deepEqual(await observationFiles(directory), [
      basename(first.observationPath),
    ]);
    const temporary = (await readdir(directory)).find((name) =>
      name.endsWith(".tmp"),
    );
    assert.notEqual(temporary, undefined);

    const recovered = await record(
      target,
      mountedInventory,
      { outcome: "conformant", findings: [] },
      "2026-08-31T03:00:00.000Z",
    );
    assert.deepEqual(recovered.comparison.resolved, deviation.findings);
    assert.equal(
      recovered.historyDiagnostics.some(
        ({ kind, path }) => kind === "interrupted-write" && path === temporary,
      ),
      true,
    );
  });

  it("retains a complete final observation when interruption follows publication", async () => {
    const target = await researchTarget();
    const first = await record(
      target,
      mountedInventory,
      deviation,
      "2026-08-31T01:00:00.000Z",
    );
    const directory = dirname(first.observationPath);
    let publishedPath = "";
    const publisher: ObservationPublisher = {
      publish: async (temporary, destination) => {
        await link(temporary, destination);
        publishedPath = destination;
        throw new Error("synthetic interruption after publication");
      },
    };

    await assert.rejects(
      record(
        target,
        mountedInventory,
        { outcome: "conformant", findings: [] },
        "2026-08-31T02:00:00.000Z",
        publisher,
      ),
      /Research-project observation could not be appended atomically/u,
    );

    assert.equal((await observationFiles(directory)).length, 2);
    assert.equal(
      JSON.parse(await readFile(publishedPath, "utf8")).observedAt,
      "2026-08-31T02:00:00.000Z",
    );
  });
});

async function researchTarget(): Promise<ResolvedConfiguredResearchProjectRoots> {
  const root = await mkdtemp(
    join(tmpdir(), "academic-os-research-observation-"),
  );
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research");
  const projectRoot = join(researchRoot, "Example Project");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(stateRoot);
  return {
    driveMount,
    stateRoot,
    researchRoot,
    projectRoot,
    project: {
      key: "example-project",
      root: "Modules/Research",
      folder: "Example Project",
      status: "active",
      profile: "ureca",
    },
  };
}

async function record(
  target: ResolvedConfiguredResearchProjectRoots,
  inventory: ResearchProjectInventory,
  result: ResearchAuditResult,
  observedAt: string,
  publisher?: ObservationPublisher,
) {
  return await recordResearchProjectAuditObservation(
    {
      target,
      inventory,
      result,
      observedAt,
      contractVersion: 1,
    },
    publisher,
  );
}

async function observationFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
}
