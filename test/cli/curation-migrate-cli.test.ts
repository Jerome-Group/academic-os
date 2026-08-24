import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { md5Bytes, sha256Bytes } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import {
  readCurationRegisterEvents,
  standingCurationItems,
  walkedCurationItems,
} from "../../src/curation/index.js";
import { runCli } from "../support/run-cli.js";

const registerPath = writtenControlPaths.curationRegister;
const sourcePath = "03 Materials/02 Graph Theory/handout.pdf";
const unnumberedPath = "Materials/Graph Theory/handout.pdf";
const placedBytes = "The handout exactly as it arrived.\n";
const reissuedBytes = "The handout, reissued upstream.\n";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function legacyLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    source_id: "1DriveFileIdentifier",
    integration: "ntulearn",
    role: "handout",
    source_path: sourcePath,
    checksum: `md5:${md5Bytes(Buffer.from(placedBytes, "utf8"))}`,
    decision: "curated",
    destination: "10 Learning Materials/handout.pdf",
    evidence: "Follows the standing precedent for handouts.",
    timestamp: "2026-01-04T02:00:00.000Z",
    ...overrides,
  });
}

function contractV4Line(): string {
  return legacyLine({
    source_id: "Materials/Graph Theory/slides.pdf",
    source_path: "03 Materials/02 Graph Theory/slides.pdf",
    checksum: sha256Bytes(Buffer.from("Slides already joined.\n", "utf8")),
  });
}

interface CohortFixture {
  configPath: string;
  stateRoot: string;
  moduleRoots: Map<string, string>;
}

async function writeInto(
  root: string,
  relativePath: string,
  contents: string,
): Promise<string> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

async function cohortFixture(input: {
  sourceBytes: string;
}): Promise<CohortFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-curation-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "state");
  await mkdir(stateRoot, { recursive: true });
  const moduleRoots = new Map<string, string>();
  for (const module of ["CC0006", "MH2100"]) {
    const moduleRoot = join(driveMount, "Modules", "Y2S1", module);
    moduleRoots.set(module, moduleRoot);
    await writeInto(
      moduleRoot,
      join("NTULearn", sourcePath),
      input.sourceBytes,
    );
  }
  await writeInto(
    moduleRoots.get("CC0006") ?? "",
    registerPath,
    `${legacyLine()}\n`,
  );
  await writeInto(
    moduleRoots.get("MH2100") ?? "",
    registerPath,
    `${contractV4Line()}\n`,
  );
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: {
          root: "Modules/Y2S1",
          status: "active",
          modules: ["CC0006", "MH2100"],
        },
      },
    }),
    "utf8",
  );
  return { configPath, stateRoot, moduleRoots };
}

function registerOf(fixture: CohortFixture, module: string): Promise<string> {
  return readFile(
    join(fixture.moduleRoots.get(module) ?? "", registerPath),
    "utf8",
  );
}

describe("academic-os curation migrate", () => {
  it("previews what each legacy line becomes and writes nothing", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });
    const before = await registerOf(fixture, "CC0006");

    const result = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, "curation migrate");
    assert.equal(report.mode, "preview");
    assert.equal(report.outcome, "legacy");
    assert.equal(report.counts.migrating, 1);
    assert.equal(report.counts["contract-v4"], 1);
    const migrating = report.modules.find(
      ({ module }: { module: string }) => module === "CC0006",
    );
    assert.equal(migrating.counts.migrating, 1);
    assert.equal(migrating.migrations[0].key, `ntulearn/${unnumberedPath}`);
    assert.equal(migrating.migrations[0].supersedes, "1DriveFileIdentifier");
    assert.equal(migrating.migrations[0].line, undefined);
    assert.equal(await registerOf(fixture, "CC0006"), before);
    assert.deepEqual(await readdir(fixture.stateRoot), []);
  });

  it("appends a superseding line on apply and leaves the history it grew from intact", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });
    const before = await registerOf(fixture, "CC0006");

    const applied = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--apply",
      "--json",
    );

    assert.equal(applied.exitCode, 0, JSON.stringify(applied));
    const report = JSON.parse(applied.stdout);
    assert.equal(report.outcome, "contract-v4");
    assert.equal(report.appended, 1);
    assert.match(String(report.journal), /journals\/curation-identity\//u);
    const after = await registerOf(fixture, "CC0006");
    assert.ok(after.startsWith(before));
    const items = standingCurationItems(
      walkedCurationItems(readCurationRegisterEvents(after), ["ntulearn"]),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.identity, "contract-v4");
    assert.equal(items[0]?.sourceId, unnumberedPath);
    assert.equal(
      items[0]?.checksum?.value,
      sha256Bytes(Buffer.from(placedBytes, "utf8")),
    );
    assert.equal(
      items[0]?.standing.destination,
      "10 Learning Materials/handout.pdf",
    );
  });

  it("plans nothing further over the register it has already migrated", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });
    await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--apply",
      "--json",
    );
    const migrated = await registerOf(fixture, "CC0006");

    const second = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(second.exitCode, 0, JSON.stringify(second));
    const report = JSON.parse(second.stdout);
    assert.equal(report.outcome, "contract-v4");
    assert.equal(report.counts.migrating, 0);
    assert.equal(await registerOf(fixture, "CC0006"), migrated);
  });

  it("leaves an item whose source bytes differ for the curation walk to decide", async () => {
    const fixture = await cohortFixture({ sourceBytes: reissuedBytes });
    const before = await registerOf(fixture, "CC0006");

    const result = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--apply",
      "--json",
    );

    assert.equal(result.exitCode, 3, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.counts.changed, 1);
    assert.equal(report.appended, 0);
    assert.equal(await registerOf(fixture, "CC0006"), before);
  });

  it("names each migration in human output and stops without --apply", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });

    const result = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
    );

    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.match(
      result.stdout,
      /Curation register identity: legacy \(preview\)/u,
    );
    assert.match(
      result.stdout,
      /Migrate CC0006 NTULearn\/03 Materials\/02 Graph Theory\/handout\.pdf: supersedes 1DriveFileIdentifier, becomes Materials\/Graph Theory\/handout\.pdf/u,
    );
    assert.match(result.stdout, /Preview only\. Re-run with --apply\./u);
  });

  it("reports a module it cannot read without hiding what the others owe", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });
    await rm(fixture.moduleRoots.get("MH2100") ?? "", { recursive: true });

    const result = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.unresolved.length, 1);
    assert.equal(report.unresolved[0].module, "MH2100");
    assert.equal(report.counts.migrating, 1);
  });

  it("rejects an unknown flag rather than guessing", async () => {
    const fixture = await cohortFixture({ sourceBytes: placedBytes });

    const result = await runCli(
      "curation",
      "migrate",
      "--config",
      fixture.configPath,
      "--force",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.match(result.stderr, /Unexpected argument: --force\./u);
  });
});
