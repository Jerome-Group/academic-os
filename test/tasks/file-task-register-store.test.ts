import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { researchTaskProvenanceKeys } from "../../src/contract/task-register.js";
import { createDeferredPathTaskRegisterStore } from "../../src/tasks/deferred-task-register-store.js";
import { refreshTaskTargets } from "../../src/tasks/refresh-task-registers.js";
import { createFileTaskRegisterStore } from "../../src/tasks/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("the file Task-register store", () => {
  it("persists a register at a target-specific relative path", async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-os-task-store-"));
    temporaryRoots.push(root);
    const registerPath = "00 Project Admin/30 Task Register.yaml";
    await mkdir(join(root, "00 Project Admin"));
    const store = createFileTaskRegisterStore(root, registerPath);

    await store.write({ listId: "ureca-list", tasks: [] });

    assert.equal(
      await readFile(join(root, registerPath), "utf8"),
      "list_id: ureca-list\ntasks: []\n",
    );
    assert.deepEqual(await store.read(), {
      listId: "ureca-list",
      tasks: [],
    });
  });

  it("refuses a register path outside the target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-os-task-store-"));
    temporaryRoots.push(root);

    assert.throws(
      () => createFileTaskRegisterStore(root, "../Task Register.yaml"),
      /relative path inside its target root/u,
    );
    assert.throws(
      () => createFileTaskRegisterStore(root, "/tmp/Task Register.yaml"),
      /relative path inside its target root/u,
    );
  });

  it("rejects rich provenance from a module store and retains it in a research store", async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-os-task-store-"));
    temporaryRoots.push(root);
    const modulePath = "module.yaml";
    const researchPath = "research.yaml";
    const register = {
      listId: "list-1",
      tasks: [
        {
          taskId: "task-1",
          title: "Check a claim",
          status: "open" as const,
          provenance: {
            source: "source-1",
            claim: "claim-1",
            meeting: "20 Supervisor Meetings/2026-09-01 Scope.md",
            deliverable: "paper",
          },
        },
      ],
    };
    const moduleStore = createFileTaskRegisterStore(root, modulePath);
    const researchStore = createFileTaskRegisterStore(
      root,
      researchPath,
      researchTaskProvenanceKeys,
    );

    await assert.rejects(
      moduleStore.write(register),
      /does not support provenance fields claim, meeting, deliverable/u,
    );
    await researchStore.write(register);

    const researchContents = await readFile(join(root, researchPath), "utf8");
    assert.match(researchContents, /claim: claim-1/u);
    assert.match(researchContents, /meeting: 20 Supervisor Meetings/u);
    assert.match(researchContents, /deliverable: paper/u);
    assert.deepEqual(await researchStore.read(), register);
  });
});

async function seededRegister(contents: string) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-task-preservation-"));
  temporaryRoots.push(root);
  const targetRoot = join(root, "module");
  const backupRoot = join(root, "task-register-backups");
  await mkdir(targetRoot);
  const path = join(targetRoot, "tasks.yaml");
  await writeFile(path, contents);
  const store = createFileTaskRegisterStore(
    targetRoot,
    "tasks.yaml",
    undefined,
    { stateRoot: root },
  );
  return { root, targetRoot, backupRoot, path, store };
}

const original = `# local register annotation
list_id: list-1
local_policy: preserve me
tasks:
  # local row annotation
  - task_id: task-1
    title: Read the chapter
    status: open # honest status
    local_detail: { reading: optional }
    provenance:
      source: chapter-1 # local provenance annotation
  - title: Local draft
    status: open
    draft_detail: retained
`;

describe("recoverable selective Task-register writes", () => {
  it("keeps no-op bytes and mtime, including comments and unrecognised local fields", async () => {
    const fixture = await seededRegister(original);
    const before = await stat(fixture.path);
    const register = await fixture.store.read();
    assert.ok(register);
    await fixture.store.write(register);
    assert.equal(await readFile(fixture.path, "utf8"), original);
    assert.equal((await stat(fixture.path)).mtimeMs, before.mtimeMs);
  });

  it("refreshes mirrored fields by identity while retaining unrelated YAML and verified originals", async () => {
    const fixture = await seededRegister(original);
    const reports = await refreshTaskTargets({
      targets: [
        {
          identity: { kind: "module", key: "AB1234", title: "AB1234" },
          registerStore: fixture.store,
        },
      ],
      reader: {
        listTasks: async () => [
          {
            id: "task-1",
            title: "Read the revised chapter",
            status: "completed",
          },
          { id: "task-2", title: "New live task" },
        ],
      },
    });
    assert.equal(reports[0]?.freshness, "fresh");
    const contents = await readFile(fixture.path, "utf8");
    for (const text of [
      "# local register annotation",
      "# local row annotation",
      "# honest status",
      "# local provenance annotation",
      "local_policy: preserve me",
      "local_detail: { reading: optional }",
      "draft_detail: retained",
      "source: chapter-1",
    ])
      assert.ok(contents.includes(text), text);
    assert.match(contents, /title: Read the revised chapter/u);
    assert.match(contents, /status: completed/u);
    const backups = await readdir(fixture.backupRoot);
    const backup = backups.find((name) => name.endsWith(".original"));
    assert.ok(backup);
    assert.equal(
      await readFile(join(fixture.backupRoot, backup), "utf8"),
      original,
    );
    assert.ok(backups.some((name) => name.endsWith(".verified.json")));
    assert.equal(
      backups.some((name) => name.endsWith(".lock")),
      false,
    );
  });

  it("refuses an intervening edit through the deferred adapter", async () => {
    const fixture = await seededRegister(original);
    const store = createDeferredPathTaskRegisterStore({
      resolveRoot: async () => fixture.targetRoot,
      registerPath: "tasks.yaml",
      stateRoot: fixture.root,
    });
    const register = await store.read();
    assert.ok(register);
    await writeFile(fixture.path, `${original}# edited during pull\n`);
    const first = register.tasks[0];
    assert.ok(first);
    first.status = "completed";
    await assert.rejects(store.write(register), /changed after it was read/u);
    assert.equal(
      await readFile(fixture.path, "utf8"),
      `${original}# edited during pull\n`,
    );
  });

  it("rejects duplicate task identities and malformed YAML before any write", async () => {
    for (const contents of [
      original.replace(
        "- title: Local draft",
        "- task_id: task-1\n    title: Local draft",
      ),
      "tasks: [\n",
      "tasks: []\ntasks: []\n",
    ]) {
      const fixture = await seededRegister(contents);
      await assert.rejects(
        fixture.store.read(),
        /not a readable Task register/u,
      );
      await assert.rejects(
        fixture.store.write({ tasks: [] }),
        /not a readable Task register/u,
      );
      assert.equal(await readFile(fixture.path, "utf8"), contents);
    }
  });

  it("rejects invalid UTF-8 without changing or mis-backing-up original bytes", async () => {
    const fixture = await seededRegister(original);
    const invalid = Buffer.concat([Buffer.from(original), Buffer.from([0xff])]);
    await writeFile(fixture.path, invalid);
    await assert.rejects(fixture.store.read(), /not valid UTF-8/u);
    await assert.rejects(
      fixture.store.write({ tasks: [] }),
      /not valid UTF-8/u,
    );
    assert.deepEqual(await readFile(fixture.path), invalid);
    await assert.rejects(readdir(fixture.backupRoot), { code: "ENOENT" });
  });

  it("refuses nested symlink paths and preserves the external file", async () => {
    const fixture = await seededRegister(original);
    await symlink(fixture.root, join(fixture.targetRoot, "link"));
    const store = createFileTaskRegisterStore(
      fixture.targetRoot,
      "link/module/tasks.yaml",
    );
    await assert.rejects(store.read(), /ordinary directories/u);
    assert.equal(await readFile(fixture.path, "utf8"), original);
  });

  it("refuses dropping an existing row with local data", async () => {
    const fixture = await seededRegister(original);
    const register = await fixture.store.read();
    assert.ok(register);
    register.tasks.pop();
    await assert.rejects(
      fixture.store.write(register),
      /unmatched existing rows/u,
    );
    assert.equal(await readFile(fixture.path, "utf8"), original);
  });
});
