import assert from "node:assert/strict";
import {
  mkdir,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { AuditResult, Inventory } from "../../src/conformance/index.js";
import {
  readMountedAuditHistory,
  recordMountedAuditObservation,
} from "../../src/mounted/index.js";
import type {
  ObservationPublisher,
  ResolvedTarget,
} from "../../src/mounted/types.js";
import { validModuleControls } from "../fixtures/module-controls.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const inventory: Inventory = {
  moduleCode: "MH2100",
  entries: [
    {
      path: "10 Learning Materials",
      kind: "directory",
      modifiedAt: "2026-08-11T00:00:00.000Z",
    },
  ],
};

const deviation: AuditResult = {
  outcome: "deviation",
  findings: [
    {
      ruleId: "MF-UNIVERSAL-001",
      enforcement: "deterministic",
      status: "fail",
      severity: "error",
      path: "30 Assessments/40 Finals",
      evidence: "Required directory is absent.",
      explanation: "Create the universal directory.",
      applicability: "Universal structure applies to every module.",
    },
  ],
};

describe("recordMountedAuditObservation", () => {
  it("reads missing history without creating storage", async () => {
    const target = await mountedTarget();
    const history = await readMountedAuditHistory(target);

    assert.deepEqual(
      history.diagnostics.map(({ kind }) => kind),
      ["missing-history"],
    );
    await assert.rejects(
      readdir(join(target.stateRoot, "observations")),
      /ENOENT/u,
    );
  });

  it("appends complete observations and compares with compatible history", async () => {
    const target = await mountedTarget();
    const first = await record(target, deviation, "2026-08-11T01:00:00.000Z");
    const firstContents = await readFile(first.observationPath, "utf8");
    assert.equal(first.comparison.basis, "no-prior-observation");
    assert.deepEqual(
      first.historyDiagnostics.map(({ kind }) => kind),
      ["missing-history"],
    );
    assert.deepEqual(first.observation.inventory, inventory);
    assert.deepEqual(first.observation.metadataAvailability, {
      contentChecksums: "unavailable",
      reason: "Mounted audits do not read academic file contents.",
    });

    const repeated = await record(
      target,
      deviation,
      "2026-08-11T02:00:00.000Z",
    );
    assert.equal(repeated.comparison.basis, "compatible-observation");
    assert.deepEqual(repeated.comparison.new, []);
    assert.deepEqual(repeated.comparison.unchanged, deviation.findings);
    assert.equal(await readFile(first.observationPath, "utf8"), firstContents);
    assert.equal(
      (await observationFiles(dirname(first.observationPath))).length,
      2,
    );
  });

  it("uses older compatible history while reporting corrupt and incompatible entries", async () => {
    const target = await mountedTarget();
    const first = await record(target, deviation, "2026-08-11T01:00:00.000Z");
    const historyDirectory = dirname(first.observationPath);
    const incompatible = {
      ...first.observation,
      observedAt: "2026-08-11T03:00:00.000Z",
      ruleSetVersion: 99,
    };
    await writeFile(
      join(historyDirectory, "incompatible.json"),
      JSON.stringify(incompatible),
    );
    await writeFile(join(historyDirectory, "corrupt.json"), "{not json");
    await writeFile(
      join(historyDirectory, "structurally-corrupt.json"),
      JSON.stringify({
        ...first.observation,
        observedAt: "2026-08-11T03:30:00.000Z",
        findings: [null],
      }),
    );

    const result = await record(target, deviation, "2026-08-11T04:00:00.000Z");

    assert.equal(result.comparison.basis, "compatible-observation");
    assert.deepEqual(result.historyDiagnostics.map(({ kind }) => kind).sort(), [
      "corrupt-history",
      "corrupt-history",
      "incompatible-history",
    ]);
  });

  it("preserves complete history when publication is interrupted", async () => {
    const target = await mountedTarget();
    const first = await record(target, deviation, "2026-08-11T01:00:00.000Z");
    const historyDirectory = dirname(first.observationPath);
    const firstContents = await readFile(first.observationPath, "utf8");
    const publisher: ObservationPublisher = {
      publish: async (temporary, destination) => {
        const completeTemporary = JSON.parse(
          await readFile(temporary, "utf8"),
        ) as { observedAt: string };
        assert.equal(completeTemporary.observedAt, "2026-08-11T02:00:00.000Z");
        await assert.rejects(readFile(destination, "utf8"));
        throw new Error("synthetic interruption before publication");
      },
    };

    await assert.rejects(
      record(
        target,
        { outcome: "conformant", findings: [] },
        "2026-08-11T02:00:00.000Z",
        publisher,
      ),
      /Observation could not be appended atomically/u,
    );
    assert.equal(await readFile(first.observationPath, "utf8"), firstContents);
    assert.deepEqual(await observationFiles(historyDirectory), [
      basename(first.observationPath),
    ]);
    const interruptedWrites = (await readdir(historyDirectory)).filter((path) =>
      path.endsWith(".tmp"),
    );
    assert.equal(interruptedWrites.length, 1);

    const result = await record(
      target,
      { outcome: "conformant", findings: [] },
      "2026-08-11T03:00:00.000Z",
    );

    assert.equal(result.comparison.basis, "compatible-observation");
    assert.deepEqual(result.comparison.resolved, deviation.findings);
    assert.equal(
      result.historyDiagnostics.some(
        ({ kind, path }) =>
          kind === "interrupted-write" && path === interruptedWrites[0],
      ),
      true,
    );
    assert.match(
      await readFile(
        join(historyDirectory, interruptedWrites[0] ?? "missing"),
        "utf8",
      ),
      /2026-08-11T02:00:00\.000Z/u,
    );
  });

  it("preserves a complete final observation when interruption follows publication", async () => {
    const target = await mountedTarget();
    const first = await record(target, deviation, "2026-08-11T01:00:00.000Z");
    const historyDirectory = dirname(first.observationPath);
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
        { outcome: "conformant", findings: [] },
        "2026-08-11T02:00:00.000Z",
        publisher,
      ),
      /Observation could not be appended atomically/u,
    );

    assert.equal((await observationFiles(historyDirectory)).length, 2);
    const published = JSON.parse(await readFile(publishedPath, "utf8")) as {
      observedAt: string;
    };
    assert.equal(published.observedAt, "2026-08-11T02:00:00.000Z");
    assert.equal(
      (await readdir(historyDirectory)).some((path) => path.endsWith(".tmp")),
      true,
    );
  });
});

async function mountedTarget(): Promise<ResolvedTarget> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-observations-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const semesterRoot = join(driveMount, "Modules", "Y2S1");
  const moduleRoot = join(semesterRoot, "MH2100");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot);
  return {
    driveMount,
    stateRoot,
    semesterRoot,
    moduleRoot,
    semester: "Y2S1",
    module: "MH2100",
  };
}

async function record(
  target: ResolvedTarget,
  result: AuditResult,
  observedAt: string,
  publisher?: ObservationPublisher,
) {
  return await recordMountedAuditObservation(
    {
      target,
      inventory,
      controls: validModuleControls(),
      result,
      observedAt,
      contractVersion: 4,
    },
    publisher,
  );
}

async function observationFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((path) => path.endsWith(".json"))
    .sort();
}
