import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

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
  const ghPath = join(root, "fake-gh.mjs");
  await writeFile(
    ghPath,
    `#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const path = ${JSON.stringify(join(root, "fake-issue.json"))};
const args=process.argv.slice(2);
let issue; try {issue=JSON.parse(readFileSync(path,'utf8'));} catch {}
if(args[0]==='pr') process.stdout.write('[]');
else if(args[0]==='api' && args[1].endsWith('/issues/42')) process.stdout.write(JSON.stringify(issue));
else if(args[0]==='api') process.stdout.write(JSON.stringify({count:issue?1:0,issues:issue?[issue]:[]}));
else if(args[0]==='issue' && args[1]==='create') {
 issue={number:42,title:args[args.indexOf('--title')+1],body:readFileSync(0,'utf8'),state:'open'};
 writeFileSync(path,JSON.stringify(issue));process.stdout.write('https://github.com/synthetic/repo/issues/42');
} else if(args[0]==='issue' && args[1]==='edit') {
 issue.body=readFileSync(0,'utf8');writeFileSync(path,JSON.stringify(issue));
} else {process.exitCode=1;}
`,
  );
  await chmod(ghPath, 0o700);
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
  assert.equal(await readFile(oldReport, "utf8"), "old preserved report\n");
});
