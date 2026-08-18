import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCliWithEnvironment } from "../support/run-cli.js";

const temporaryRoots: string[] = [];
const fakeTasksPreload = new URL(
  "../support/fake-tasks-preload.js",
  import.meta.url,
).href;

const seededRegister = [
  "list_id: first-list",
  "tasks:",
  "  - task_id: ticked",
  "    title: Read chapter",
  "    do_date: 2026-08-21",
  "    status: open",
  "    notes: Deadline Friday",
  "    provenance:",
  "      assessment: Midterm",
  "      source: Announcements",
  "      milestone: Submission",
  "  - task_id: removed",
  "    title: Print the notes",
  "    do_date: 2026-08-22",
  "    status: open",
  "  - task_id: purged",
  "    title: Collect the handout",
  "    status: open",
  "  - title: Draft the summary",
  "    do_date: 2026-08-25",
  "    status: open",
  "    provenance:",
  "      source: Session decision",
  "",
].join("\n");

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os tasks refresh", () => {
  it("lands ticks, date changes, additions and cancellations without writing to Google", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.registers.MH2100, seededRegister);
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );

    const jsonResult = await runTasksRefresh(fixture, "--json");

    assert.equal(jsonResult.exitCode, 0, JSON.stringify(jsonResult));
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.command, "tasks refresh");
    assert.equal(report.outcome, "refreshed");
    assert.deepEqual(report.modules[0], {
      semester: "Y2S1",
      module: "MH2100",
      freshness: "fresh",
      listId: "first-list",
      counts: {
        tasks: 5,
        open: 2,
        completed: 1,
        cancelled: 2,
        unpushed: 1,
      },
      changes: { added: 1, updated: 1, cancelled: 2 },
    });

    assert.equal(
      await readFile(fixture.registers.MH2100, "utf8"),
      [
        "list_id: first-list",
        "tasks:",
        "  - task_id: ticked",
        "    title: Read chapter after the lecture",
        "    do_date: 2026-08-24",
        "    status: completed",
        "    notes: Deadline Friday",
        "    provenance:",
        "      assessment: Midterm",
        "      source: Announcements",
        "      milestone: Submission",
        "  - task_id: removed",
        "    title: Print the notes",
        "    do_date: 2026-08-22",
        "    status: cancelled",
        "  - task_id: purged",
        "    title: Collect the handout",
        "    status: cancelled",
        "  - title: Draft the summary",
        "    do_date: 2026-08-25",
        "    status: open",
        "    provenance:",
        "      source: Session decision",
        "  - task_id: added-on-the-phone",
        "    title: Buy the textbook",
        "    do_date: 2026-08-30",
        "    status: open",
        "",
      ].join("\n"),
    );

    const provider = await readProvider(fixture);
    assert.ok(
      provider.requests.every(
        ({ method, credential, scopes }) =>
          method === "GET" &&
          credential === fixture.readCredential &&
          scopes.length === 1 &&
          scopes[0] === "https://www.googleapis.com/auth/tasks.readonly",
      ),
    );
    assert.ok(
      provider.requests.every(
        ({ params }) =>
          params?.showCompleted === true &&
          params?.showDeleted === true &&
          params?.showHidden === true,
      ),
    );
  });

  it("reads every page of a long list", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.registers.MH2100,
      "list_id: first-list\ntasks: []\n",
    );
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );
    const provider = await readProvider(fixture);
    provider.taskPageSizes = { "first-list": 2 };
    await writeProvider(fixture, provider);

    const result = await runTasksRefresh(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(JSON.parse(result.stdout).modules[0].counts.tasks, 2);
    assert.deepEqual(
      (await readProvider(fixture)).requests
        .filter(({ url }) => url.includes("first-list"))
        .map(({ params }) => params?.pageToken),
      [undefined, "2"],
    );
  });

  it("keeps a failed module's register untouched and refreshes the rest", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.registers.MH2100, seededRegister);
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );
    const provider = await readProvider(fixture);
    provider.taskReadFailures = ["first-list"];
    await writeProvider(fixture, provider);

    const jsonResult = await runTasksRefresh(fixture, "--json");
    const humanResult = await runTasksRefresh(fixture);

    assert.equal(jsonResult.exitCode, 2, JSON.stringify(jsonResult));
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.outcome, "partially-refreshed");
    assert.equal(report.modules[0].freshness, "stale");
    assert.equal(report.modules[0].listId, "first-list");
    assert.equal(report.modules[0].failure.code, "operational-failure");
    assert.deepEqual(report.modules[0].changes, {
      added: 0,
      updated: 0,
      cancelled: 0,
    });
    assert.equal(report.modules[1].freshness, "fresh");
    assert.equal(
      await readFile(fixture.registers.MH2100, "utf8"),
      seededRegister,
    );
    assert.match(humanResult.stdout, /^Tasks refresh: partially-refreshed$/mu);
    assert.match(
      humanResult.stdout,
      /^MH2100 \(Y2S1\): 4 tasks; 4 open, 0 completed, 0 cancelled, 1 unpushed; stale; 0 added, 0 updated, 0 newly cancelled; operational-failure: .+$/mu,
    );
    assert.match(
      humanResult.stdout,
      /^MH2101 \(Y2S1\): 1 task; 1 open, 0 completed, 0 cancelled, 0 unpushed; fresh; 0 added, 0 updated, 0 newly cancelled$/mu,
    );
  });

  it("reports a module with no register as stale rather than inventing one", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );

    const result = await runTasksRefresh(fixture, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "partially-refreshed");
    assert.equal(report.modules[0].freshness, "stale");
    assert.equal(report.modules[0].listId, null);
    assert.equal(report.modules[0].failure.code, "missing-target");
    assert.equal(
      await readRegisterOrUndefined(fixture.registers.MH2100),
      undefined,
    );
  });

  it("refreshes one named module without touching the rest of the cohort", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.registers.MH2100,
      "list_id: first-list\ntasks: []\n",
    );
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );

    const result = await runTasksRefresh(
      fixture,
      "--semester",
      "Y2S1",
      "--module",
      "MH2101",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.deepEqual(
      report.modules.map(({ module }: { module: string }) => module),
      ["MH2101"],
    );
    assert.equal(
      await readFile(fixture.registers.MH2100, "utf8"),
      "list_id: first-list\ntasks: []\n",
    );
  });

  it("refuses a register carrying a time on a do-date", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.registers.MH2100,
      [
        "list_id: first-list",
        "tasks:",
        "  - task_id: ticked",
        "    title: Read chapter",
        "    do_date: 2026-08-21T09:00:00+08:00",
        "    status: open",
        "",
      ].join("\n"),
    );
    await writeFile(
      fixture.registers.MH2101,
      "list_id: second-list\ntasks: []\n",
    );

    const result = await runTasksRefresh(fixture, "--json");

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.modules[0].freshness, "stale");
    assert.match(report.modules[0].failure.message, /Task register/u);
  });
});

interface TasksFixture {
  configPath: string;
  providerPath: string;
  readCredential: string;
  registers: Record<"MH2100" | "MH2101", string>;
}

async function setupFixture(): Promise<TasksFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-tasks-refresh-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const semesterRoot = join(driveMount, "Semesters", "Y2S1");
  await Promise.all([
    mkdir(join(semesterRoot, "MH2100", "00 Module Admin"), { recursive: true }),
    mkdir(join(semesterRoot, "MH2101", "00 Module Admin"), { recursive: true }),
    mkdir(stateRoot),
  ]);
  const configPath = join(root, "academic-os.config.json");
  const readCredential = join(root, "tasks-read.credentials.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: {
          root: join("Semesters", "Y2S1"),
          status: "active",
          modules: ["MH2100", "MH2101"],
        },
      },
      tasks: {
        credentials: {
          scheduledRead: readCredential,
          interactiveWrite: join(root, "tasks-write.credentials.json"),
        },
      },
    })}\n`,
  );
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    `${JSON.stringify({
      lists: [
        { id: "first-list", title: "MH2100" },
        { id: "second-list", title: "MH2101" },
      ],
      tasks: {
        "first-list": [
          {
            id: "ticked",
            title: "Read chapter after the lecture",
            due: "2026-08-24T00:00:00.000Z",
            status: "completed",
            notes: "Deadline Friday",
          },
          { id: "removed", title: "Print the notes", deleted: true },
          {
            id: "added-on-the-phone",
            title: "Buy the textbook",
            due: "2026-08-30T00:00:00.000Z",
            status: "needsAction",
          },
        ],
        "second-list": [
          { id: "second-task", title: "Plan the week", status: "needsAction" },
        ],
      },
    })}\n`,
  );
  return {
    configPath,
    providerPath,
    readCredential,
    registers: {
      MH2100: join(
        semesterRoot,
        "MH2100",
        "00 Module Admin",
        "30 Task Register.yaml",
      ),
      MH2101: join(
        semesterRoot,
        "MH2101",
        "00 Module Admin",
        "30 Task Register.yaml",
      ),
    },
  };
}

async function runTasksRefresh(fixture: TasksFixture, ...arguments_: string[]) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_TASKS_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeTasksPreload}`,
    },
    "tasks",
    "refresh",
    "--config",
    fixture.configPath,
    ...arguments_,
  );
}

async function readRegisterOrUndefined(
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readProvider(fixture: TasksFixture): Promise<{
  taskPageSizes?: Record<string, number>;
  taskReadFailures?: string[];
  requests: Array<{
    credential: string;
    method: string;
    params?: Record<string, unknown>;
    scopes: string[];
    url: string;
  }>;
}> {
  return JSON.parse(await readFile(fixture.providerPath, "utf8"));
}

async function writeProvider(
  fixture: TasksFixture,
  provider: unknown,
): Promise<void> {
  await writeFile(fixture.providerPath, `${JSON.stringify(provider)}\n`);
}
