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

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("academic-os tasks provision", () => {
  it("previews a missing list without creating it or writing a register", async () => {
    const fixture = await setupFixture();

    const jsonResult = await runTasksProvision(fixture, "--json");
    const humanResult = await runTasksProvision(fixture);

    assert.equal(jsonResult.exitCode, 0, JSON.stringify(jsonResult));
    assert.deepEqual(JSON.parse(jsonResult.stdout), {
      schemaVersion: 1,
      command: "tasks provision",
      outcome: "preview",
      module: { semester: "Y2S1", module: "MH2100" },
      list: { title: "MH2100", action: "would-create", listId: null },
      register: "not-written",
    });
    assert.match(humanResult.stdout, /^Tasks provision: preview$/mu);
    assert.match(humanResult.stdout, /^MH2100 \(Y2S1\): would create$/mu);
    assert.match(humanResult.stdout, /^Register: not written$/mu);
    assert.equal(await readRegisterOrUndefined(fixture), undefined);

    const provider = await readProvider(fixture);
    assert.ok(provider.requests.every(({ method }) => method === "GET"));
    assert.ok(
      provider.requests.every(
        ({ credential, scopes }) =>
          credential === fixture.readCredential &&
          scopes.length === 1 &&
          scopes[0] === "https://www.googleapis.com/auth/tasks.readonly",
      ),
    );
  });

  it("creates the module's list under --apply and persists its exact ID", async () => {
    const fixture = await setupFixture();

    const result = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "provisioned");
    assert.equal(report.list.action, "created");
    assert.equal(report.list.listId, "created-1");
    assert.equal(report.register, "written");
    assert.equal(
      await readRegisterText(fixture),
      "list_id: created-1\ntasks: []\n",
    );

    const provider = await readProvider(fixture);
    const created = provider.requests.filter(({ method }) => method === "POST");
    assert.deepEqual(
      created.map(({ body, credential, scopes }) => ({
        body,
        credential,
        scopes,
      })),
      [
        {
          body: { title: "MH2100" },
          credential: fixture.writeCredential,
          scopes: ["https://www.googleapis.com/auth/tasks"],
        },
      ],
    );
  });

  it("previews an adoptable list without writing a register", async () => {
    const fixture = await setupFixture();
    const provider = await readProvider(fixture);
    provider.lists = [{ id: "module-list", title: "MH2100" }];
    await writeProvider(fixture, provider);

    const result = await runTasksProvision(fixture, "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "preview");
    assert.equal(report.list.action, "would-adopt");
    assert.equal(report.list.listId, "module-list");
    assert.equal(report.register, "not-written");
    assert.equal(await readRegisterOrUndefined(fixture), undefined);
  });

  it("adopts an exactly titled list rather than creating a second one", async () => {
    const fixture = await setupFixture();
    const provider = await readProvider(fixture);
    provider.lists = [
      { id: "other-list", title: "Groceries" },
      { id: "module-list", title: "MH2100" },
    ];
    await writeProvider(fixture, provider);

    const result = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.list.action, "adopted");
    assert.equal(report.list.listId, "module-list");
    assert.equal(
      await readRegisterText(fixture),
      "list_id: module-list\ntasks: []\n",
    );
    assert.ok(
      (await readProvider(fixture)).requests.every(
        ({ method }) => method === "GET",
      ),
    );
  });

  it("binds an already-provisioned register without rewriting its rows", async () => {
    const fixture = await setupFixture();
    const provider = await readProvider(fixture);
    provider.lists = [{ id: "module-list", title: "MH2100" }];
    await writeProvider(fixture, provider);
    const existing = [
      "list_id: module-list",
      "tasks:",
      "  - title: Read the notes",
      "    do_date: 2026-08-21",
      "    status: open",
      "    provenance:",
      "      assessment: Midterm",
      "",
    ].join("\n");
    await writeFile(fixture.registerPath, existing);

    const result = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "provisioned");
    assert.equal(report.list.action, "bound");
    assert.equal(report.list.listId, "module-list");
    assert.equal(report.register, "not-written");
    assert.equal(await readRegisterText(fixture), existing);
  });

  it("fills the seeded register rather than reading it as already bound", async () => {
    const fixture = await setupFixture();
    const provider = await readProvider(fixture);
    provider.lists = [{ id: "module-list", title: "MH2100" }];
    await writeProvider(fixture, provider);
    const seeded = "# Seeded before the list existed.\ntasks: []\n";
    await writeFile(fixture.registerPath, seeded);

    const preview = await runTasksProvision(fixture, "--json");

    assert.equal(preview.exitCode, 0, JSON.stringify(preview));
    assert.equal(JSON.parse(preview.stdout).list.action, "would-adopt");
    assert.equal(await readRegisterText(fixture), seeded);

    const result = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.list.action, "adopted");
    assert.equal(report.list.listId, "module-list");
    assert.equal(report.register, "written");
    assert.equal(
      await readRegisterText(fixture),
      "list_id: module-list\ntasks: []\n",
    );
  });

  it("refuses a duplicated title and a register whose list Google no longer has", async () => {
    const fixture = await setupFixture();
    const provider = await readProvider(fixture);
    provider.lists = [
      { id: "first", title: "MH2100" },
      { id: "second", title: "MH2100" },
    ];
    await writeProvider(fixture, provider);

    const duplicated = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(duplicated.exitCode, 2, JSON.stringify(duplicated));
    const duplicatedReport = JSON.parse(duplicated.stdout);
    assert.equal(duplicatedReport.outcome, "operational-failure");
    assert.equal(duplicatedReport.error.code, "ambiguous-target");
    assert.equal(await readRegisterOrUndefined(fixture), undefined);

    await writeFile(fixture.registerPath, "list_id: retired-list\ntasks: []\n");
    const retired = await runTasksProvision(fixture, "--apply", "--json");

    assert.equal(retired.exitCode, 2, JSON.stringify(retired));
    assert.equal(JSON.parse(retired.stdout).error.code, "missing-target");
    assert.equal(
      await readRegisterText(fixture),
      "list_id: retired-list\ntasks: []\n",
    );
  });
});

interface TasksFixture {
  configPath: string;
  providerPath: string;
  readCredential: string;
  registerPath: string;
  writeCredential: string;
}

async function setupFixture(): Promise<TasksFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-tasks-provision-"));
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
  await writeFile(providerPath, `${JSON.stringify({ lists: [] })}\n`);
  return {
    configPath,
    providerPath,
    readCredential,
    registerPath: join(moduleRoot, "00 Module Admin", "30 Task Register.yaml"),
    writeCredential,
  };
}

async function runTasksProvision(
  fixture: TasksFixture,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_TASKS_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeTasksPreload}`,
    },
    "tasks",
    "provision",
    "--config",
    fixture.configPath,
    "--semester",
    "Y2S1",
    "--module",
    "MH2100",
    ...arguments_,
  );
}

async function readRegisterText(fixture: TasksFixture): Promise<string> {
  return await readFile(fixture.registerPath, "utf8");
}

async function readRegisterOrUndefined(
  fixture: TasksFixture,
): Promise<string | undefined> {
  try {
    return await readRegisterText(fixture);
  } catch {
    return undefined;
  }
}

async function readProvider(fixture: TasksFixture): Promise<{
  lists: Array<{ id: string; title: string }>;
  requests: Array<{
    body?: unknown;
    credential: string;
    method: string;
    scopes: string[];
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
