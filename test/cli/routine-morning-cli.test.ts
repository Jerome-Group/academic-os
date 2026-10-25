import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  beginWeeklyObservation,
  createGhMorningIssue,
  reconcileWeeklyIssue,
} from "../../src/routine/index.js";
import { parsePublication } from "../../src/routine/weekly-review-state.js";
import { writeWeeklyGhFixture } from "../fixtures/weekly-gh-provider.js";
import { runCli } from "../support/run-cli.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function configFile(contents: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-routine-cli-"));
  temporaryRoots.push(root);
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify(contents));
  return path;
}

describe("academic-os routine morning", () => {
  it("states its usage when no config is named", async () => {
    const result = await runCli("routine", "morning", "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  });

  it("requires the cohort configuration", async () => {
    const path = await configFile({
      driveMount: "/drive",
      stateRoot: "/state",
      semester: "Y2S1",
      module: "AB1234",
    });

    const result = await runCli(
      "routine",
      "morning",
      "--config",
      path,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const { error } = JSON.parse(result.stdout);
    assert.equal(error.code, "invalid-config");
    assert.match(error.message, /cohort configuration/u);
  });

  it("requires the paths of the tools it runs at 06:00", async () => {
    const path = await configFile({
      driveMount: "/drive",
      stateRoot: "/state",
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Y2S1", status: "active", modules: ["AB1234"] },
      },
    });

    const result = await runCli(
      "routine",
      "morning",
      "--config",
      path,
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const { error } = JSON.parse(result.stdout);
    assert.equal(error.code, "invalid-config");
    assert.match(error.message, /routine configuration/u);
  });
});

for (const modules of [
  ["AB1234", "AB1234"],
  ["AB1234", "AB1234", "CD5678"],
]) {
  for (const scope of [[], ["--modules-only"]]) {
    it(`refuses unresolved ${modules.length === 2 ? "duplicate-only" : "mixed"} selection before effects in ${scope.length === 0 ? "monitoring-cohort" : "modules-only"} scope`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "academic-os-cohort-refusal-"));
      t.after(async () => {
        if (process.env.ACADEMIC_ROUTINE_EVIDENCE_ROOT === undefined)
          await rm(root, { recursive: true });
      });
      t.diagnostic(`Cohort refusal fixture ${root}`);
      const driveMount = join(root, "drive");
      const stateRoot = join(root, "state");
      for (const module of new Set(modules)) {
        const moduleRoot = join(driveMount, "Semester", module);
        await mkdir(moduleRoot, { recursive: true });
        await writeFile(
          join(moduleRoot, "Owner.txt"),
          "Owner academic bytes\n",
        );
      }
      await mkdir(join(driveMount, "Shelf"));
      await writeFile(
        join(driveMount, "Shelf", "Owner.txt"),
        "Owner shelf bytes\n",
      );
      const repairDirectoryRefusal = join(stateRoot, "repository-repair");
      await mkdir(repairDirectoryRefusal, { recursive: true });
      await chmod(repairDirectoryRefusal, 0o755);
      const { ghPath, providerPath } = await writeWeeklyGhFixture(root);
      const codexPath = join(root, "codex.cjs");
      const codexLog = join(root, "codex-invocations.txt");
      await writeFile(codexLog, "");
      await writeFile(
        codexPath,
        `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(codexLog)}, 'invoked\\n');\nprocess.exitCode = 1;\n`,
      );
      await chmod(codexPath, 0o700);
      const configPath = join(root, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          driveMount,
          stateRoot,
          activeSemester: "Y2S1",
          semesters: { Y2S1: { root: "Semester", status: "active", modules } },
          routine: { codexPath, ghPath },
          textbooks: { shelfRoot: "Shelf" },
          tasks: {
            credentials: {
              scheduledRead: join(root, "absent-read-credentials"),
              interactiveWrite: join(root, "absent-write-credentials"),
            },
          },
        }),
      );
      const before = {
        academic: await snapshot(driveMount),
        state: await snapshot(stateRoot),
        provider: await readFile(providerPath, "utf8"),
        sessions: await readFile(codexLog, "utf8"),
      };
      const result = await runCli(
        "routine",
        "morning",
        "--config",
        configPath,
        "--retain-artifacts",
        ...scope,
        "--json",
      );
      const after = {
        academic: await snapshot(driveMount),
        state: await snapshot(stateRoot),
        provider: await readFile(providerPath, "utf8"),
        sessions: await readFile(codexLog, "utf8"),
      };
      await writeFile(
        join(root, "observations.json"),
        JSON.stringify({ result, before, after }, null, 2),
      );
      assert.deepEqual(
        {
          academicChanged:
            JSON.stringify(after.academic) !== JSON.stringify(before.academic),
          stateChanged:
            JSON.stringify(after.state) !== JSON.stringify(before.state),
          providerChanged: after.provider !== before.provider,
          sessionInvocations: after.sessions,
        },
        {
          academicChanged: false,
          stateChanged: false,
          providerChanged: false,
          sessionInvocations: "",
        },
      );
      assert.equal(result.exitCode, 2, result.stdout);
      const { error } = JSON.parse(result.stdout);
      assert.equal(error.code, "invalid-config");
      assert.match(error.message, /Y2S1\/AB1234.*duplicated-module/u);
      assert.match(error.message, /selection.*unresolved/u);
    });
  }
}

async function snapshot(root: string) {
  return Promise.all(
    (await readdir(root, { recursive: true })).sort().map(async (path) => {
      const fullPath = join(root, path);
      const metadata = await lstat(fullPath);
      return {
        path,
        mode: metadata.mode & 0o777,
        contents: metadata.isFile() ? await readFile(fullPath, "base64") : null,
      };
    }),
  );
}

it("rejects invalid or unpaired model overrides before reading configuration", async () => {
  for (const flags of [
    ["--model", "gpt-6.1-sol"],
    ["--reasoning-effort", "medium"],
    ["--model", "gpt-6-luna", "--reasoning-effort", "medium"],
    ["--model", "gpt-6.1-sol", "--reasoning-effort", "invalid"],
    ["--retain-artifacts", "--retain-artifacts"],
  ]) {
    const result = await runCli(
      "routine",
      "morning",
      "--config",
      "/missing/synthetic-config",
      ...flags,
      "--json",
    );
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  }
});

it("retains modules-only CLI evidence and resolves quiet full coverage with existing v2 history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-retained-cli-"));
  t.after(async () => {
    if (process.env.ACADEMIC_ROUTINE_EVIDENCE_ROOT === undefined)
      await rm(root, { recursive: true });
  });
  t.diagnostic(`Modules-only follow-up fixture ${root}`);
  const driveMount = join(root, "drive");
  const stateRoot = join(root, "state");
  await mkdir(driveMount);
  await mkdir(join(stateRoot, "routine/sessions/2000-01-01"), {
    recursive: true,
  });
  await mkdir(join(stateRoot, "routine/reports"), { recursive: true });
  const oldReport = join(stateRoot, "routine/reports/2000-01-01.md");
  await writeFile(oldReport, "old preserved report\n");
  const { ghPath, providerPath } = await writeWeeklyGhFixture(root);
  const path = await configFile({
    driveMount,
    stateRoot,
    activeSemester: "Y2S1",
    semesters: { Y2S1: { root: "Semester", status: "active", modules: [] } },
    routine: { codexPath: join(root, "unused-codex"), ghPath },
    tasks: {
      credentials: {
        scheduledRead: join(root, "unused-read"),
        interactiveWrite: join(root, "unused-write"),
      },
    },
    research: {
      root: "../excluded",
      projects: { excluded: { folder: "Excluded", status: "active" } },
    },
  });
  const invoke = () =>
    runCli(
      "routine",
      "morning",
      "--config",
      path,
      "--retain-artifacts",
      "--modules-only",
      "--model",
      "gpt-6.1-sol",
      "--reasoning-effort",
      "medium",
      "--json",
    );
  const first = await invoke();
  const second = await invoke();
  assert.equal(first.exitCode, 0, first.stdout);
  assert.equal(second.exitCode, 0, second.stdout);
  const reports = [first, second].map(({ stdout }) => JSON.parse(stdout));
  assert.notEqual(reports[0].report, reports[1].report);
  for (const report of reports) {
    assert.equal(report.run.retention, "retained");
    assert.equal(report.run.scope, "modules-only");
    assert.equal(report.run.requestedModel, "gpt-6.1-sol");
    assert.equal(report.run.requestedReasoningEffort, "medium");
    assert.equal(report.run.modelAttestation, "unverified");
    assert.equal(report.prelude[1].outcome, "skipped");
    assert.deepEqual(report.purge, { sessions: [], reports: [] });
    const metadata = JSON.parse(
      await readFile(join(report.run.artifactStateRoot, "run.json"), "utf8"),
    );
    assert.deepEqual(metadata.run, report.run);
    await readFile(report.report, "utf8");
  }
  const provider = JSON.parse(await readFile(providerPath, "utf8"));
  assert.equal(provider.issues.length, 1);
  assert.equal(provider.comments.length, 1);
  assert.equal(reports[1].issue.outcome, "not-needed");
  assert.equal(await readFile(oldReport, "utf8"), "old preserved report\n");
  const existing = parsePublication(provider.comments[0].body);
  assert.ok(existing);
  assert.equal(existing.needsOwner, false);
  assert.equal(existing.summary.preludePending, 1);
  assert.equal("coverage" in existing, false);
  const ownerBody = `${provider.issues[0].body}\nOWNER  whitespace\t\n`;
  provider.issues[0].body = ownerBody;
  await writeFile(providerPath, JSON.stringify(provider));
  const journalPath = join(stateRoot, "weekly-publication/publication.jsonl");
  const beforeJournal = await readFile(journalPath, "utf8");
  await writeFile(
    join(root, "modules-only-provider.json"),
    JSON.stringify(provider),
  );
  await writeFile(join(root, "modules-only-journal.jsonl"), beforeJournal);
  const issue = createGhMorningIssue(ghPath);
  const observation = await beginWeeklyObservation({
    issue,
    stateRoot,
    date: reports[0].date,
    cohort: "Y2S1",
    moduleCodes: [],
    scope: "monitoring-cohort",
  });
  const complete = await reconcileWeeklyIssue({
    issue,
    stateRoot,
    observation,
    summary: { ...existing.summary, preludePending: 0 },
    needsOwner: false,
    repository: { merged: [], unresolved: 0, awaiting: 0 },
  });
  const after = JSON.parse(await readFile(providerPath, "utf8"));
  const journal = (await readFile(journalPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const close = journal.find(
    (entry) => entry.kind === "intent" && entry.operation.kind === "resolution",
  );
  await writeFile(
    join(root, "observations.json"),
    JSON.stringify(
      { reports, existing, complete, anchor: after.issues[0], close },
      null,
      2,
    ),
  );
  assert.equal(complete.outcome, "closed");
  assert.equal(complete.actionable, false);
  assert.equal(after.issues[0].state, "closed");
  assert.equal(after.issues[0].body, ownerBody);
  assert.deepEqual(after.comments[0], provider.comments[0]);
  assert.ok(close);
  assert.equal(close.operation.publicationId, complete.publicationId);
  assert.ok(
    journal.some((entry) => entry.kind === "receipt" && entry.id === close.id),
  );
  assert.ok((await readFile(journalPath, "utf8")).startsWith(beforeJournal));
});
