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

describe("academic-os Tasks for research projects", () => {
  it("provisions a configured research project's dedicated list and register", async () => {
    const fixture = await setupFixture();

    const result = await runTasks(
      fixture,
      "provision",
      "--research-project",
      "ureca-y2",
      "--apply",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      command: "tasks provision",
      outcome: "provisioned",
      researchProject: { key: "ureca-y2" },
      list: {
        title: "URECA Y2",
        action: "created",
        listId: "created-1",
      },
      register: "written",
    });
    assert.equal(
      await readFile(fixture.researchRegister, "utf8"),
      "list_id: created-1\ntasks: []\n",
    );
  });

  it("includes active research projects in a no-target refresh", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.researchRegister,
      "list_id: ureca-list\ntasks: []\n",
    );
    await writeFile(
      fixture.providerPath,
      `${JSON.stringify({
        lists: [{ id: "ureca-list", title: "URECA Y2" }],
        tasks: {
          "ureca-list": [
            {
              id: "read-source",
              title: "Read the first source",
              status: "needsAction",
            },
          ],
        },
      })}\n`,
    );

    const result = await runTasks(fixture, "refresh", "--json");

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.outcome, "refreshed");
    assert.deepEqual(report.modules, []);
    assert.deepEqual(report.researchProjects, [
      {
        researchProject: "ureca-y2",
        freshness: "fresh",
        listId: "ureca-list",
        counts: {
          tasks: 1,
          open: 1,
          completed: 0,
          cancelled: 0,
          unpushed: 0,
        },
        changes: { added: 1, updated: 0, cancelled: 0 },
      },
    ]);
    assert.match(
      await readFile(fixture.researchRegister, "utf8"),
      /read-source/u,
    );
    const provider = JSON.parse(await readFile(fixture.providerPath, "utf8"));
    assert.ok(
      provider.requests.every(
        ({ method }: { method: string }) => method === "GET",
      ),
    );
  });

  it("refreshes one explicitly named research project", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.researchRegister,
      "list_id: ureca-list\ntasks: []\n",
    );
    await writeFile(
      fixture.providerPath,
      `${JSON.stringify({
        lists: [{ id: "ureca-list", title: "URECA Y2" }],
        tasks: { "ureca-list": [] },
      })}\n`,
    );

    const result = await runTasks(
      fixture,
      "refresh",
      "--research-project",
      "ureca-y2",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.modules, []);
    assert.equal(report.researchProjects.length, 1);
    assert.equal(report.researchProjects[0].researchProject, "ureca-y2");
  });

  it("creates a task against an explicit research project and retains research provenance", async () => {
    const fixture = await setupFixture();
    await writeFile(
      fixture.researchRegister,
      "list_id: ureca-list\ntasks: []\n",
    );
    await writeFile(
      fixture.providerPath,
      `${JSON.stringify({
        lists: [{ id: "ureca-list", title: "URECA Y2" }],
        tasks: { "ureca-list": [] },
      })}\n`,
    );

    const result = await runTasks(
      fixture,
      "create",
      "--research-project",
      "ureca-y2",
      "--title",
      "Verify the first source",
      "--source",
      "SRC-001",
      "--claim",
      "CLAIM-001",
      "--json",
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.target, {
      kind: "research-project",
      key: "ureca-y2",
      title: "URECA Y2",
    });
    assert.equal(report.outcome, "applied");
    const register = await readFile(fixture.researchRegister, "utf8");
    assert.match(register, /source: SRC-001/u);
    assert.match(register, /claim: CLAIM-001/u);
  });

  it("keeps inactive research projects read-only", async () => {
    const fixture = await setupFixture();
    const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
    config.research.projects["ureca-y2"].status = "inactive";
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`);

    const preview = await runTasks(
      fixture,
      "provision",
      "--research-project",
      "ureca-y2",
      "--json",
    );
    assert.equal(preview.exitCode, 0, JSON.stringify(preview));
    assert.equal(JSON.parse(preview.stdout).outcome, "preview");

    for (const arguments_ of [
      ["provision", "--research-project", "ureca-y2", "--apply", "--json"],
      [
        "create",
        "--research-project",
        "ureca-y2",
        "--title",
        "Must not be created",
        "--json",
      ],
      ["refresh", "--research-project", "ureca-y2", "--json"],
    ]) {
      const [command, ...commandArguments] = arguments_;
      assert.ok(command);
      const result = await runTasks(fixture, command, ...commandArguments);
      assert.equal(result.exitCode, 2, JSON.stringify(result));
      assert.equal(JSON.parse(result.stdout).error.code, "invalid-target");
      assert.match(
        JSON.parse(result.stdout).error.message,
        /inactive and read-only/u,
      );
    }
  });
});

interface Fixture {
  configPath: string;
  providerPath: string;
  researchRegister: string;
}

async function setupFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-research-tasks-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research", "URECA Y2");
  await Promise.all([
    mkdir(join(researchRoot, "00 Project Admin"), { recursive: true }),
    mkdir(stateRoot),
  ]);
  const configPath = join(root, "academic-os.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Semesters/Y2S1", status: "active", modules: [] },
      },
      research: {
        root: "Modules/Research",
        projects: {
          "ureca-y2": {
            folder: "URECA Y2",
            status: "active",
            profile: "ureca",
            taskListTitle: "URECA Y2",
          },
        },
      },
      tasks: {
        credentials: {
          scheduledRead: join(root, "tasks-read.credentials.json"),
          interactiveWrite: join(root, "tasks-write.credentials.json"),
        },
      },
    })}\n`,
  );
  const providerPath = join(root, "provider.json");
  await writeFile(providerPath, `${JSON.stringify({ lists: [] })}\n`);
  return {
    configPath,
    providerPath,
    researchRegister: join(
      researchRoot,
      "00 Project Admin",
      "30 Task Register.yaml",
    ),
  };
}

async function runTasks(
  fixture: Fixture,
  command: string,
  ...arguments_: string[]
) {
  return await runCliWithEnvironment(
    {
      ACADEMIC_OS_FAKE_TASKS_STATE: fixture.providerPath,
      NODE_OPTIONS: `--import=${fakeTasksPreload}`,
    },
    "tasks",
    command,
    "--config",
    fixture.configPath,
    ...arguments_,
  );
}
