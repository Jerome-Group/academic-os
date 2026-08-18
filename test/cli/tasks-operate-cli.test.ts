import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCliWithEnvironment } from "../support/run-cli.js";

const temporaryRoots: string[] = [];
const fakeTasksPreload = new URL(
  "../support/fake-tasks-preload.js",
  import.meta.url,
).href;

const readonlyScope = "https://www.googleapis.com/auth/tasks.readonly";
const writeScope = "https://www.googleapis.com/auth/tasks";

const seededRegister = [
  "list_id: first-list",
  "tasks:",
  "  - task_id: mirrored",
  "    title: Read chapter",
  "    do_date: 2026-08-21",
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

describe("academic-os tasks create", () => {
  it("pushes to the live list, verifies it, then refreshes the register", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--do-date",
      "2026-08-27",
      "--notes",
      "Deadline Friday",
      "--assessment",
      "Midterm",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.command, "tasks create");
    assert.equal(report.outcome, "applied");
    assert.deepEqual(report.module, { semester: "Y2S1", module: "MH2100" });
    assert.equal(report.taskId, "created-1");
    assert.equal(report.register.freshness, "fresh");
    assert.deepEqual(report.register.changes, {
      added: 0,
      updated: 0,
      cancelled: 0,
    });

    assert.equal(
      await readFile(fixture.register, "utf8"),
      [
        seededRegister.trimEnd(),
        "  - task_id: created-1",
        "    title: Attempt tutorial 3",
        "    do_date: 2026-08-27",
        "    status: open",
        "    notes: Deadline Friday",
        "    provenance:",
        "      assessment: Midterm",
        "",
      ].join("\n"),
    );

    const provider = await readProvider(fixture);
    assert.deepEqual(
      provider.requests.map(({ method, url, scopes }) => [
        method,
        url.replace("https://tasks.googleapis.com/tasks/v1/lists/", ""),
        scopes[0],
      ]),
      [
        ["POST", "first-list/tasks", writeScope],
        ["GET", "first-list/tasks/created-1", writeScope],
        ["GET", "first-list/tasks", readonlyScope],
      ],
    );
    assert.deepEqual(provider.requests[0]?.body, {
      title: "Attempt tutorial 3",
      due: "2026-08-27T00:00:00.000Z",
      notes: "Deadline Friday",
    });
    assert.equal(provider.requests[0]?.credential, fixture.writeCredential);
    assert.equal(provider.requests[2]?.credential, fixture.readCredential);
  });

  it("keeps the register free of an invented row when the push fails", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);
    await patchProvider(fixture, { taskWriteFailures: ["first-list"] });

    const jsonResult = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--json",
    );
    const humanResult = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
    );

    assert.equal(jsonResult.exitCode, 2, JSON.stringify(jsonResult));
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.outcome, "parked");
    assert.equal(report.taskId, null);
    assert.equal(report.register, null);
    assert.equal(report.failure.code, "operational-failure");
    assert.equal(await readFile(fixture.register, "utf8"), seededRegister);
    assert.equal(humanResult.exitCode, 2);
    assert.match(humanResult.stdout, /^Tasks create: parked$/mu);
    assert.match(humanResult.stdout, /^MH2100 \(Y2S1\): no live change$/mu);
    assert.match(humanResult.stdout, /^operational-failure: .+$/mu);
    assert.deepEqual(
      (await readProvider(fixture)).requests.map(({ method }) => method),
      ["POST", "POST"],
    );
  });

  it("reports a push Google took but did not record as unverified, not parked", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);
    await patchProvider(fixture, { taskWritesIgnored: ["first-list"] });

    const jsonResult = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--do-date",
      "2026-08-27",
      "--json",
    );
    const humanResult = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--do-date",
      "2026-08-27",
    );

    assert.equal(jsonResult.exitCode, 2, JSON.stringify(jsonResult));
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.outcome, "unverified");
    assert.equal(report.taskId, "created-1");
    assert.equal(report.register, null);
    assert.match(report.failure.message, /run tasks refresh/u);
    assert.equal(await readFile(fixture.register, "utf8"), seededRegister);
    assert.match(
      humanResult.stdout,
      /^MH2100 \(Y2S1\): task created-2, live result unverified$/mu,
    );
  });

  it("holds the conflict rules across the refresh its push runs", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);
    await writeFile(
      fixture.register,
      [
        seededRegister.trimEnd(),
        "  - task_id: withdrawn",
        "    title: Collect the handout",
        "    status: open",
        "",
      ].join("\n"),
    );
    await patchProvider(fixture, {
      tasks: {
        "first-list": [
          {
            id: "mirrored",
            title: "Read chapter 4 before the tutorial",
            due: "2026-08-22T00:00:00.000Z",
            status: "needsAction",
          },
          {
            id: "added-on-the-phone",
            title: "Buy the textbook",
            due: "2026-08-30T00:00:00.000Z",
            status: "needsAction",
          },
        ],
      },
    });

    const result = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout).register.changes, {
      added: 1,
      updated: 1,
      cancelled: 1,
    });
    assert.equal(
      await readFile(fixture.register, "utf8"),
      [
        "list_id: first-list",
        "tasks:",
        "  - task_id: mirrored",
        "    title: Read chapter 4 before the tutorial",
        "    do_date: 2026-08-22",
        "    status: open",
        "  - title: Draft the summary",
        "    do_date: 2026-08-25",
        "    status: open",
        "    provenance:",
        "      source: Session decision",
        "  - task_id: withdrawn",
        "    title: Collect the handout",
        "    status: cancelled",
        "  - task_id: created-1",
        "    title: Attempt tutorial 3",
        "    status: open",
        "  - task_id: added-on-the-phone",
        "    title: Buy the textbook",
        "    do_date: 2026-08-30",
        "    status: open",
        "",
      ].join("\n"),
    );
  });

  it("refuses a do-date carrying a time", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "create",
      "--title",
      "Attempt tutorial 3",
      "--do-date",
      "2026-08-27T09:00:00+08:00",
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.error.code, "invalid-arguments");
    assert.match(report.error.message, /date with no time/u);
    assert.equal(await readFile(fixture.register, "utf8"), seededRegister);
  });
});

describe("academic-os tasks change", () => {
  it("patches the live task and mirrors what Google read back", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "change",
      "--task",
      "mirrored",
      "--title",
      "Read chapter 4",
      "--do-date",
      "2026-08-24",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "applied");
    assert.equal(report.taskId, "mirrored");
    assert.deepEqual(report.register.changes, {
      added: 0,
      updated: 1,
      cancelled: 0,
    });
    assert.match(
      await readFile(fixture.register, "utf8"),
      /- task_id: mirrored\n {4}title: Read chapter 4\n {4}do_date: 2026-08-24\n {4}status: open\n/u,
    );

    const provider = await readProvider(fixture);
    assert.deepEqual(
      provider.requests.map(({ method }) => method),
      ["PATCH", "GET", "GET"],
    );
    assert.deepEqual(provider.requests[0]?.body, {
      title: "Read chapter 4",
      due: "2026-08-24T00:00:00.000Z",
    });
  });

  it("reports a patch the live task did not take as unverified, register untouched", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);
    await patchProvider(fixture, { taskWritesIgnored: ["mirrored"] });

    const result = await runTasks(
      fixture,
      "change",
      "--task",
      "mirrored",
      "--title",
      "Read chapter 4",
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "unverified");
    assert.equal(report.taskId, "mirrored");
    assert.match(report.failure.message, /did not read back/u);
    assert.equal(await readFile(fixture.register, "utf8"), seededRegister);
  });

  it("parks a task the register has no row for rather than pushing blind", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "change",
      "--task",
      "added-on-the-phone",
      "--title",
      "Read chapter 4",
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "parked");
    assert.equal(report.failure.code, "missing-target");
    assert.match(report.failure.message, /run tasks refresh first/u);
    assert.deepEqual((await readProvider(fixture)).requests, []);
    assert.equal(await readFile(fixture.register, "utf8"), seededRegister);
  });
});

describe("academic-os tasks complete", () => {
  it("ticks the live task and lands the tick in the register", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "complete",
      "--task",
      "mirrored",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "applied");
    assert.equal(report.register.counts.completed, 1);
    assert.match(
      await readFile(fixture.register, "utf8"),
      /- task_id: mirrored\n {4}title: Read chapter\n {4}do_date: 2026-08-21\n {4}status: completed\n/u,
    );
    assert.deepEqual((await readProvider(fixture)).requests[0]?.body, {
      status: "completed",
    });
  });
});

describe("academic-os tasks cancel", () => {
  it("deletes the live task and cancels its row rather than dropping it", async () => {
    const fixture = await setupFixture();
    await writeFile(fixture.register, seededRegister);

    const result = await runTasks(
      fixture,
      "cancel",
      "--task",
      "mirrored",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "applied");
    assert.deepEqual(report.register.changes, {
      added: 0,
      updated: 0,
      cancelled: 1,
    });
    assert.match(
      await readFile(fixture.register, "utf8"),
      /- task_id: mirrored\n {4}title: Read chapter\n {4}do_date: 2026-08-21\n {4}status: cancelled\n/u,
    );
    assert.deepEqual(
      (await readProvider(fixture)).requests.map(({ method }) => method),
      ["DELETE", "GET", "GET"],
    );
  });

  it("never re-pushes a row the register holds as cancelled", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.register,
      [
        "list_id: first-list",
        "tasks:",
        "  - task_id: mirrored",
        "    title: Read chapter",
        "    status: cancelled",
        "",
      ].join("\n"),
    );

    const result = await runTasks(
      fixture,
      "complete",
      "--task",
      "mirrored",
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "parked");
    assert.equal(report.failure.code, "invalid-target");
    assert.deepEqual((await readProvider(fixture)).requests, []);
  });

  it("parks a module that has no register at all", async () => {
    const fixture = await setupFixture();

    const result = await runTasks(
      fixture,
      "cancel",
      "--task",
      "mirrored",
      "--json",
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "parked");
    assert.equal(report.failure.code, "missing-target");
    assert.match(report.failure.message, /tasks provision/u);
  });
});

interface TasksFixture {
  configPath: string;
  providerPath: string;
  readCredential: string;
  writeCredential: string;
  register: string;
}

async function setupFixture(): Promise<TasksFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-tasks-operate-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Semesters", "Y2S1", "MH2100");
  await Promise.all([
    mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true }),
    mkdir(stateRoot),
  ]);
  const configPath = join(root, "academic-os.config.json");
  const readCredential = join(root, "tasks-read.credentials.json");
  const writeCredential = join(root, "tasks-write.credentials.json");
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
          modules: ["MH2100"],
        },
      },
      tasks: {
        credentials: {
          scheduledRead: readCredential,
          interactiveWrite: writeCredential,
        },
      },
    })}\n`,
  );
  const providerPath = join(root, "provider.json");
  await writeFile(
    providerPath,
    `${JSON.stringify({
      lists: [{ id: "first-list", title: "MH2100" }],
      tasks: {
        "first-list": [
          {
            id: "mirrored",
            title: "Read chapter",
            due: "2026-08-21T00:00:00.000Z",
            status: "needsAction",
          },
        ],
      },
    })}\n`,
  );
  return {
    configPath,
    providerPath,
    readCredential,
    writeCredential,
    register: join(moduleRoot, "00 Module Admin", "30 Task Register.yaml"),
  };
}

async function runTasks(
  fixture: TasksFixture,
  operation: string,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_TASKS_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeTasksPreload}`,
    },
    "tasks",
    operation,
    "--config",
    fixture.configPath,
    "--semester",
    "Y2S1",
    "--module",
    "MH2100",
    ...arguments_,
  );
}

async function readProvider(fixture: TasksFixture): Promise<{
  tasks: Record<string, Array<{ id: string; [field: string]: unknown }>>;
  requests: Array<{
    body?: Record<string, unknown>;
    credential: string;
    method: string;
    scopes: string[];
    url: string;
  }>;
}> {
  const provider = JSON.parse(await readFile(fixture.providerPath, "utf8"));
  return { requests: [], ...provider };
}

async function patchProvider(
  fixture: TasksFixture,
  patch: Record<string, unknown>,
): Promise<void> {
  const provider = JSON.parse(await readFile(fixture.providerPath, "utf8"));
  await writeFile(
    fixture.providerPath,
    `${JSON.stringify({ ...provider, ...patch })}\n`,
  );
}
