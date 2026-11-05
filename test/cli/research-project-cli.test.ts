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
import type { ResearchProjectInitialFile } from "../../src/seed/index.js";
import {
  initialMeetingNote,
  initialMeetingNotePath,
  initialSchedulePath,
  researchMeetingInitialFiles,
} from "../support/research-meeting-intake.js";

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
    assert.equal(report.contractVersion, 3);
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

  it("previews, publishes, replays and audits a complete policy v2 Meeting with exact bytes", async () => {
    const fixture = await setupFixture({ existing: false, generic: true });
    const files = researchMeetingInitialFiles();
    const manifestPath = await writeIntakeManifest(fixture.root, files);
    const target = meetingSeedArguments(fixture, manifestPath);

    const preview = await runCli(...target, "--json");
    assert.equal(preview.exitCode, 0, preview.stdout);
    assert.equal(JSON.parse(preview.stdout).outcome, "preview");
    assert.deepEqual(await readdir(fixture.researchRoot), []);
    assert.deepEqual(await readdir(fixture.stateRoot), []);
    assert.doesNotMatch(preview.stdout, /Exact approved prose|AP8KgEE=/u);

    const applied = await runCli(...target, "--apply", "--json");
    assert.equal(applied.exitCode, 0, applied.stdout);
    assert.equal(JSON.parse(applied.stdout).outcome, "completed");
    await assertIntakeBytes(fixture.projectRoot, files);
    const journal = await onlyJournal(fixture.stateRoot);
    assert.equal(
      JSON.parse(journal.bytes.toString("utf8").split("\n")[0] ?? "").plan
        .intakePolicyVersion,
      2,
    );
    const paths = await readdir(fixture.projectRoot, { recursive: true });

    const replay = await runCli(...target, "--apply", "--resume", "--json");
    assert.equal(replay.exitCode, 0, replay.stdout);
    assert.equal(JSON.parse(replay.stdout).outcome, "completed");
    assert.deepEqual(JSON.parse(replay.stdout).operations, []);
    assert.deepEqual(
      await readdir(fixture.projectRoot, { recursive: true }),
      paths,
    );
    await assertIntakeBytes(fixture.projectRoot, files);
    assert.deepEqual(
      (await onlyJournal(fixture.stateRoot)).bytes,
      journal.bytes,
    );

    const audit = await runCli(
      "audit",
      "--config",
      fixture.configPath,
      "--research-project",
      "example-project",
      "--json",
    );
    assert.equal(audit.exitCode, 0, audit.stdout);
    const report = JSON.parse(audit.stdout);
    assert.equal(report.outcome, "conformant");
    assert.equal(report.contractVersion, 3);
    assert.equal(
      report.findings.find(
        ({ ruleId }: { ruleId: string }) => ruleId === "RP-MEETINGS-001",
      ).status,
      "pass",
    );

    const changedPolicy = JSON.parse(await readFile(manifestPath, "utf8"));
    changedPolicy.schemaVersion = 3;
    await writeFile(manifestPath, JSON.stringify(changedPolicy));
    const unsupported = await runCli(
      ...target,
      "--apply",
      "--resume",
      "--json",
    );
    assert.equal(unsupported.exitCode, 2, unsupported.stdout);
    assert.match(
      JSON.parse(unsupported.stdout).error.message,
      /closed schema v1 or v2/u,
    );
    assert.deepEqual(
      (await onlyJournal(fixture.stateRoot)).bytes,
      journal.bytes,
    );
    await assertIntakeBytes(fixture.projectRoot, files);

    changedPolicy.schemaVersion = 2;
    await writeFile(manifestPath, JSON.stringify(changedPolicy));
    for (const savedPolicy of [
      { version: 3, extraIdentity: {} },
      { version: 3, extraIdentity: { module: "AA9999", semester: "Y2S1" } },
      { version: 2, extraIdentity: { module: "AA9999", semester: "Y2S1" } },
    ]) {
      for (const recomputeDigest of [false, true]) {
        const events = journal.bytes
          .toString("utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        Object.assign(events[0].plan, savedPolicy.extraIdentity, {
          intakePolicyVersion: savedPolicy.version,
        });
        if (recomputeDigest)
          events[0].planDigest = createHash("sha256")
            .update(JSON.stringify(events[0].plan))
            .digest("hex");
        const unsupportedJournal = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
        await writeFile(journal.path, unsupportedJournal);
        const refusedReplay = await runCli(
          ...target,
          "--apply",
          "--resume",
          "--json",
        );
        assert.equal(refusedReplay.exitCode, 1, refusedReplay.stdout);
        assert.match(
          JSON.parse(refusedReplay.stdout).evidence.join(" "),
          /ambiguous journal entry/u,
        );
        assert.equal(await readFile(journal.path, "utf8"), unsupportedJournal);
        await assertIntakeBytes(fixture.projectRoot, files);
      }
    }
    await writeFile(journal.path, journal.bytes);
  });

  it("refuses invalid Meeting intake before publication", async () => {
    const cases: Array<{
      name: string;
      files: ResearchProjectInitialFile[];
      message: RegExp;
      policyVersion?: number;
    }> = [
      {
        name: "missing note",
        files: researchMeetingInitialFiles().filter(
          ({ destination }) => destination !== initialMeetingNotePath,
        ),
        message: /requires file .*Meeting.md|No readable meeting note/u,
      },
      {
        name: "invalid note",
        files: researchMeetingInitialFiles().map((file) =>
          file.destination === initialMeetingNotePath
            ? {
                destination: file.destination,
                encoding: "utf8",
                contents: initialMeetingNote.replace(
                  "date: 2026-11-06",
                  "date: 2026-11-07",
                ),
              }
            : file,
        ),
        message: /date must be 2026-11-06/u,
      },
      {
        name: "missing schedule",
        files: researchMeetingInitialFiles().filter(
          ({ destination }) => destination !== initialSchedulePath,
        ),
        message: /Schedule omits meeting directory/u,
      },
      {
        name: "inconsistent schedule",
        files: researchMeetingInitialFiles().map((file) =>
          file.destination === initialSchedulePath && file.encoding === "utf8"
            ? {
                ...file,
                contents: file.contents.replace("| planned |", "| confirmed |"),
              }
            : file,
        ),
        message: /must match Meeting.md status planned/u,
      },
      {
        name: "binary schedule",
        files: researchMeetingInitialFiles().map((file) =>
          file.destination === initialSchedulePath
            ? {
                destination: file.destination,
                encoding: "binary",
                contentsBase64: "AP8=",
              }
            : file,
        ),
        message: /requires utf8 encoding/u,
      },
      {
        name: "pinned replacement",
        files: [
          ...researchMeetingInitialFiles(),
          {
            destination: "AGENTS.md",
            encoding: "utf8",
            contents: "replacement\n",
          },
        ],
        message: /cannot replace pinned or fixed/u,
      },
      {
        name: "legacy schedule replacement",
        files: researchMeetingInitialFiles(),
        policyVersion: 1,
        message: /requires initial-intake policy v2/u,
      },
      {
        name: "unsupported policy",
        files: researchMeetingInitialFiles(),
        policyVersion: 3,
        message: /closed schema v1 or v2/u,
      },
    ];
    for (const testCase of cases) {
      const fixture = await setupFixture({ existing: false, generic: true });
      const manifest = await writeIntakeManifest(
        fixture.root,
        testCase.files,
        testCase.policyVersion,
      );
      const result = await runCli(
        ...meetingSeedArguments(fixture, manifest),
        "--apply",
        "--json",
      );
      assert.notEqual(result.exitCode, 0, testCase.name);
      assert.match(result.stdout, testCase.message, testCase.name);
      assert.deepEqual(await readdir(fixture.researchRoot), [], testCase.name);
      await assert.rejects(
        readdir(join(fixture.stateRoot, "journals", "seeds")),
      );
    }
  });

  it("preserves conflicting existing notes and schedules before any planned creation", async () => {
    for (const destination of [initialMeetingNotePath, initialSchedulePath]) {
      const fixture = await setupFixture({ generic: true });
      const path = join(fixture.projectRoot, destination);
      await mkdir(dirname(path), { recursive: true });
      const sentinel = Buffer.from(
        `Existing Owner content at ${destination}\n`,
      );
      await writeFile(path, sentinel);
      const paths = await readdir(fixture.projectRoot, { recursive: true });
      const manifest = await writeIntakeManifest(
        fixture.root,
        researchMeetingInitialFiles(),
      );
      const result = await runCli(
        ...meetingSeedArguments(fixture, manifest),
        "--apply",
        "--json",
      );
      assert.equal(result.exitCode, 1, result.stdout);
      assert.match(
        JSON.parse(result.stdout).evidence.join(" "),
        /conflicts with/u,
      );
      assert.deepEqual(await readFile(path), sentinel);
      assert.deepEqual(
        await readdir(fixture.projectRoot, { recursive: true }),
        paths,
      );
      await assert.rejects(
        readdir(join(fixture.stateRoot, "journals", "seeds")),
      );
    }
  });
});

async function setupFixture(
  options: { existing?: boolean; generic?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-research-cli-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research");
  const projectRoot = join(researchRoot, "Example Project");
  await mkdir(options.existing === false ? researchRoot : projectRoot, {
    recursive: true,
  });
  await mkdir(stateRoot);
  if (options.existing !== false)
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
            ...(options.generic ? {} : { profile: "ureca" }),
          },
        },
      },
    })}\n`,
  );
  const profilePath = join(root, "profile.md");
  const definitionPath = join(root, "definition.yaml");
  await writeFile(
    profilePath,
    validProfile(options.generic ? "generic" : "ureca"),
  );
  await writeFile(
    definitionPath,
    `contract_version: 3
project:
  key: example-project
  folder: Example Project
  title: Synthetic project
  status: active
profile: ${options.generic ? "generic" : "ureca"}
evidence:
  identity: owner-supplied
  confirmation: unresolved
`,
  );
  return {
    root,
    configPath,
    profilePath,
    definitionPath,
    projectRoot,
    researchRoot,
    stateRoot,
  };
}

function validProfile(profile: "generic" | "ureca" = "ureca"): string {
  return `# Example Project — Synthetic project

## Identity

| Field | Value | Evidence |
| --- | --- | --- |
| Project key | example-project | owner-supplied |
| Folder | Example Project | owner-supplied |
| Title | Synthetic project | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ${profile} | official-source |

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

function meetingSeedArguments(
  fixture: Awaited<ReturnType<typeof setupFixture>>,
  manifestPath: string,
): string[] {
  return [
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
}

async function writeIntakeManifest(
  root: string,
  files: readonly ResearchProjectInitialFile[],
  policyVersion = 2,
): Promise<string> {
  const rows = [];
  for (const [index, file] of files.entries()) {
    const source = `intake-${index}.payload`;
    const bytes =
      file.encoding === "utf8"
        ? Buffer.from(file.contents, "utf8")
        : Buffer.from(file.contentsBase64, "base64");
    await writeFile(join(root, source), bytes);
    rows.push({
      destination: file.destination,
      source,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      encoding: file.encoding,
    });
  }
  const path = join(root, "initial-files.json");
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: policyVersion, files: rows }),
  );
  return path;
}

async function assertIntakeBytes(
  projectRoot: string,
  files: readonly ResearchProjectInitialFile[],
): Promise<void> {
  for (const file of files) {
    const expected =
      file.encoding === "utf8"
        ? Buffer.from(file.contents, "utf8")
        : Buffer.from(file.contentsBase64, "base64");
    assert.deepEqual(
      await readFile(join(projectRoot, file.destination)),
      expected,
      file.destination,
    );
  }
}

async function onlyJournal(
  stateRoot: string,
): Promise<{ path: string; bytes: Buffer }> {
  const root = join(stateRoot, "journals", "seeds");
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  const path = join(root, entries[0] ?? "missing");
  return { path, bytes: await readFile(path) };
}
