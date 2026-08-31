import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os research-project CLI", () => {
  it("previews, applies, and audits one configured project [RP-SEED-002] [RP-AUDIT-002]", async () => {
    const fixture = await setupFixture();
    const target = [
      "seed",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
    ];

    const preview = await runCli(...target, "--json");
    assert.equal(preview.exitCode, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).outcome, "preview");
    assert.deepEqual(await readdir(fixture.projectRoot), ["Icon\r"]);

    const applied = await runCli(...target, "--apply", "--json");
    assert.equal(applied.exitCode, 0, applied.stderr);
    assert.deepEqual(JSON.parse(applied.stdout).project, {
      key: "example-project",
      folder: "Example Project",
    });
    assert.equal(JSON.parse(applied.stdout).outcome, "completed");
    assert.equal(
      await readFile(join(fixture.projectRoot, "Icon\r"), "utf8"),
      "",
    );

    const audit = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--json",
    );
    assert.equal(audit.exitCode, 0, audit.stderr);
    const report = JSON.parse(audit.stdout);
    assert.equal(report.mode, "research-project");
    assert.equal(report.outcome, "conformant");
    assert.equal(report.contractVersion, 1);
    assert.equal(report.inventoryProvenance.source, "mounted");
    assert.equal(report.proposedOperations.length, 0);
    assert.equal(report.observation.schemaVersion, 1);
    assert.equal(report.observation.ruleSetVersion, 1);
    assert.match(
      report.observation.path,
      /\/observations\/research-projects\/[a-f0-9]{64}\//u,
    );
    assert.equal(report.comparison.basis, "no-prior-observation");
    assert.deepEqual(
      report.historyDiagnostics.map(({ kind }: { kind: string }) => kind),
      ["missing-history"],
    );

    const repeated = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--json",
    );
    const repeatedReport = JSON.parse(repeated.stdout);
    assert.equal(repeatedReport.comparison.basis, "compatible-observation");
    assert.deepEqual(repeatedReport.comparison.new, []);
    assert.deepEqual(repeatedReport.comparison.resolved, []);
    await writeFile(
      join(dirname(repeatedReport.observation.path), "corrupt-for-human.json"),
      "{not json",
    );

    const human = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
    );
    assert.match(human.stdout, /Observation: .*research-projects/u);
    assert.match(human.stdout, /Comparison: compatible-observation/u);
    assert.match(human.stdout, /History \[corrupt-history\]/u);
  });

  it("rejects mixed module and research targets and requires an explicit Drive folder ID", async () => {
    const fixture = await setupFixture();
    const mixed = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--semester",
      "Y2S1",
      "--module",
      "MH2100",
      "--research-project",
      "example-project",
      "--json",
    );
    assert.equal(mixed.exitCode, 2);
    assert.equal(JSON.parse(mixed.stdout).error.code, "invalid-arguments");

    const drive = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--inventory",
      "drive-api",
      "--json",
    );
    assert.equal(drive.exitCode, 2);
    assert.match(
      JSON.parse(drive.stdout).error.message,
      /researchProjectFolderIds\.example-project/u,
    );
  });

  it("loads an approved initial manifest only for an explicit research project", async () => {
    const fixture = await setupFixture();
    const bytes = Buffer.from([0, 255, 10, 128, 65]);
    const sourcePath = join(fixture.root, "source.pdf");
    await writeFile(sourcePath, bytes);
    const manifestPath = join(fixture.root, "initial-files.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        files: [
          {
            destination: "10 Source Materials/20 Core Sources/source.pdf",
            source: "source.pdf",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            encoding: "binary",
          },
        ],
      }),
    );
    const target = [
      "seed",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--initial-files-manifest",
      manifestPath,
    ];

    const preview = await runCli(...target, "--json");
    assert.equal(preview.exitCode, 0, preview.stderr);
    const report = JSON.parse(preview.stdout);
    assert.deepEqual(
      report.operations.find(({ path }: { path: string }) =>
        path.endsWith("source.pdf"),
      ),
      {
        kind: "file",
        path: "10 Source Materials/20 Core Sources/source.pdf",
      },
    );
    assert.doesNotMatch(preview.stdout, /AP8KgEE=/u);

    const applied = await runCli(...target, "--apply", "--json");
    assert.equal(applied.exitCode, 0, applied.stderr);
    assert.deepEqual(
      await readFile(
        join(
          fixture.projectRoot,
          "10 Source Materials",
          "20 Core Sources",
          "source.pdf",
        ),
      ),
      bytes,
    );

    const moduleOnly = await runCli(
      "seed",
      "--config",
      fixture.configPath,
      "--profile",
      fixture.profilePath,
      "--definition",
      fixture.definitionPath,
      "--initial-files-manifest",
      manifestPath,
      "--json",
    );
    assert.equal(moduleOnly.exitCode, 2);
    assert.equal(JSON.parse(moduleOnly.stdout).error.code, "invalid-arguments");
  });
});

async function setupFixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-research-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research");
  const projectRoot = join(researchRoot, "Example Project");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(stateRoot);
  await writeFile(join(projectRoot, "Icon\r"), "");
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Modules/Y2S1", status: "active", modules: [] },
      },
      research: {
        root: "Modules/Research",
        projects: {
          "example-project": {
            folder: "Example Project",
            status: "active",
            profile: "ureca",
          },
        },
      },
    })}\n`,
  );
  const profilePath = join(root, "profile.md");
  const definitionPath = join(root, "definition.yaml");
  await writeFile(profilePath, validProfile());
  await writeFile(
    definitionPath,
    `contract_version: 1
project:
  key: example-project
  folder: Example Project
  title: Synthetic project
  status: active
profile: ureca
evidence:
  identity: owner-supplied
  confirmation: unresolved
`,
  );
  return { root, configPath, profilePath, definitionPath, projectRoot };
}

function validProfile(): string {
  return `# Example Project — Synthetic project

## Identity

| Field | Value | Evidence |
| --- | --- | --- |
| Project key | example-project | owner-supplied |
| Folder | Example Project | owner-supplied |
| Title | Synthetic project | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ureca | official-source |

## Purpose and Questions

No research claim.

## Programme

Synthetic profile coverage.

## Supervision

| Field | Value | Evidence |
| --- | --- | --- |

## Deliverables

| Deliverable | Requirement | Evidence |
| --- | --- | --- |

## Source Authority

| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |

## Workspaces

| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Research | Disposable mounted tree | \`70 Research/\` |

## Known Gaps

| Gap | Consequence | Next evidence |
| --- | --- | --- |
| Content accuracy | Not tested here | unresolved |
`;
}
