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

it("retains distinct CLI-run metadata and reports while preserving prior evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-retained-cli-"));
  temporaryRoots.push(root);
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
});
