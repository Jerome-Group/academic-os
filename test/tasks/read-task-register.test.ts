import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createFileTaskRefreshReceiptStore } from "../../src/tasks/file-task-refresh-receipt-store.js";
import { createFileTaskRegisterStore } from "../../src/tasks/file-task-register-store.js";
import {
  readTaskRegister,
  readTaskTargetRegister,
} from "../../src/tasks/read-task-register.js";
import { refreshTaskTargets } from "../../src/tasks/refresh-task-registers.js";
import { taskExecutionSnapshot } from "../../src/tasks/task-execution-plan.js";
import { taskRegisterGeneration } from "../../src/tasks/task-refresh-receipt.js";
import type {
  LiveTask,
  TaskRegisterStore,
  TaskTargetIdentity,
} from "../../src/tasks/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const identity: TaskTargetIdentity = {
  kind: "module",
  key: "semester/module",
  title: "module",
};
const live: LiveTask[] = [
  { id: "task-1", title: "Provider task", status: "completed" },
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-refresh-receipt-"));
  roots.push(root);
  const driveMount = join(root, "drive");
  const stateRoot = join(root, "private");
  const targetRoot = join(driveMount, "module");
  await mkdir(targetRoot, { recursive: true });
  await mkdir(stateRoot);
  const path = join(targetRoot, "tasks.yaml");
  await writeFile(
    path,
    [
      "# owner annotation",
      "list_id: list-1",
      "local_policy: keep",
      "tasks:",
      "  - task_id: task-1",
      "    title: Old task",
      "    status: open",
      "    dismissed: true",
      "  - title: Manual draft",
      "    status: open",
      "    manual_evidence: keep",
      "",
    ].join("\n"),
  );
  const registerStore = createFileTaskRegisterStore(
    targetRoot,
    "tasks.yaml",
    undefined,
    { stateRoot },
  );
  const receiptStore = createFileTaskRefreshReceiptStore({
    stateRoot,
    driveMount,
    target: identity,
  });
  const target = {
    identity,
    registerStore,
    receiptStore,
    configBinding: "fixture-config",
  };
  return {
    root,
    stateRoot,
    driveMount,
    path,
    registerStore,
    receiptStore,
    target,
  };
}

describe("verified Task-register reads and private receipts", () => {
  it("returns rows, counts and receipt from one readback while retaining owner YAML", async () => {
    const f = await fixture();
    let reads = 0;
    const store: TaskRegisterStore = {
      read: async () => {
        reads += 1;
        assert.ok(
          reads <= 2,
          "read-register must not make an unguarded third read",
        );
        return await f.registerStore.read();
      },
      write: async (register) => await f.registerStore.write(register),
    };
    const result = await readTaskRegister({
      target: {
        semester: "semester",
        module: "module",
        registerStore: store,
        receiptStore: f.receiptStore,
        configBinding: "fixture-config",
      },
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "read");
    assert.equal(reads, 2);
    assert.equal(result.register.counts.tasks, result.tasks.length);
    assert.deepEqual(
      result.tasks.map((task) => task.status),
      ["completed", "open"],
    );
    assert.equal(result.register.providerSnapshot, taskExecutionSnapshot(live));
    assert.equal(
      result.register.generation,
      taskRegisterGeneration({ listId: "list-1", tasks: result.tasks }),
    );
    const receipt = await f.receiptStore.read();
    assert.deepEqual(receipt, result.register.receipt);
    assert.equal(receipt?.configBinding, "fixture-config");
    assert.equal(receipt?.lastSuccess?.generation, result.register.generation);
    const bytes = await readFile(f.path, "utf8");
    assert.match(bytes, /# owner annotation/u);
    assert.match(bytes, /dismissed: true/u);
    assert.match(bytes, /manual_evidence: keep/u);
    const before = await stat(f.path);
    const repeat = await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    assert.equal(repeat.outcome, "read");
    assert.equal((await stat(f.path)).mtimeMs, before.mtimeMs);
    assert.equal(repeat.register.generation, result.register.generation);
  });

  it("reports a failed final read as stale with earlier rows and matching counts", async () => {
    const f = await fixture();
    let reads = 0;
    const result = await readTaskTargetRegister({
      target: {
        ...f.target,
        registerStore: {
          read: async () => {
            if (++reads === 2) throw new Error("readback unavailable");
            return await f.registerStore.read();
          },
          write: async (register) => await f.registerStore.write(register),
        },
      },
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.equal(result.register.freshness, "stale");
    assert.equal(result.tasks[0]?.title, "Old task");
    assert.equal(result.register.counts.tasks, result.tasks.length);
    assert.equal(result.register.providerSnapshot, undefined);
    assert.equal(result.register.generation, undefined);
    assert.ok(result.register.failure);
    assert.equal((await f.receiptStore.read())?.lastSuccess, null);
  });

  it("refuses fresh-empty when the final register disappears", async () => {
    const f = await fixture();
    const result = await readTaskTargetRegister({
      target: {
        ...f.target,
        registerStore: {
          read: async () => await f.registerStore.read(),
          write: async (register) => {
            await f.registerStore.write(register);
            await rm(f.path);
          },
        },
      },
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.equal(result.tasks.length, 2);
    assert.equal(result.register.counts.tasks, 2);
    assert.match(result.register.failure?.message ?? "", /disappeared/u);
    assert.equal(result.register.providerSnapshot, undefined);
  });

  it("reports changed readback rows as stale and preserves the preceding success receipt", async () => {
    const f = await fixture();
    const first = await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    const result = await readTaskTargetRegister({
      target: {
        ...f.target,
        registerStore: {
          read: async () => await f.registerStore.read(),
          write: async (register) => {
            await f.registerStore.write(register);
            await writeFile(
              f.path,
              "list_id: list-1\ntasks:\n  - title: Owner replacement\n    status: open\n",
            );
          },
        },
      },
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.deepEqual(result.tasks, [
      { title: "Owner replacement", status: "open" },
    ]);
    assert.equal(result.register.counts.tasks, 1);
    assert.equal(result.register.providerSnapshot, undefined);
    assert.equal(result.register.receipt?.freshness, "stale");
    assert.deepEqual(
      result.register.receipt?.lastSuccess,
      first.register.receipt?.lastSuccess,
    );
  });

  it("retains last-success generation when the provider fails and isolates the next target", async () => {
    const f = await fixture();
    const first = await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    const second = await fixture();
    const reports = await refreshTaskTargets({
      targets: [f.target, second.target],
      reader: {
        listTasks: async () => {
          if ((await f.receiptStore.read())?.freshness === "fresh")
            throw new Error("provider unavailable");
          return live;
        },
      },
    });
    assert.equal(reports[0]?.freshness, "stale");
    assert.equal(reports[1]?.freshness, "fresh");
    assert.deepEqual(
      (await f.receiptStore.read())?.lastSuccess,
      first.register.receipt?.lastSuccess,
    );
    assert.equal(reports[0]?.providerSnapshot, undefined);
  });

  it("marks successful register IO stale when receipt publication cannot persist", async () => {
    const f = await fixture();
    await writeFile(join(f.stateRoot, "task-refresh-receipts"), "occupied");
    const result = await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.equal(result.tasks[0]?.status, "completed");
    assert.equal(result.register.counts.tasks, result.tasks.length);
    assert.equal(result.register.providerSnapshot, undefined);
    assert.match(result.register.failure?.message ?? "", /receipt/u);
  });

  it("reads absent receipts without creating directories and refuses corrupt prior receipts", async () => {
    const f = await fixture();
    const before = await readdir(f.stateRoot);
    assert.equal(await f.receiptStore.read(), undefined);
    assert.deepEqual(await readdir(f.stateRoot), before);
    await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    const directory = join(f.stateRoot, "task-refresh-receipts");
    const filename = (await readdir(directory)).find((name) =>
      name.endsWith(".json"),
    );
    assert.ok(filename);
    const receiptPath = join(directory, filename);
    await writeFile(receiptPath, "{broken");
    await assert.rejects(f.receiptStore.read(), /receipt is invalid/u);
    const result = await readTaskTargetRegister({
      target: f.target,
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.equal(await readFile(receiptPath, "utf8"), "{broken");
  });

  it("persists separate target receipts in one private state root", async () => {
    const f = await fixture();
    const otherIdentity: TaskTargetIdentity = {
      kind: "research-project",
      key: "research",
      title: "Research",
    };
    const targetRoot = join(f.driveMount, "research");
    await mkdir(targetRoot);
    await writeFile(
      join(targetRoot, "tasks.yaml"),
      "list_id: research-list\ntasks: []\n",
    );
    const receiptStore = createFileTaskRefreshReceiptStore({
      stateRoot: f.stateRoot,
      driveMount: f.driveMount,
      target: otherIdentity,
    });
    const other = {
      identity: otherIdentity,
      registerStore: createFileTaskRegisterStore(
        targetRoot,
        "tasks.yaml",
        undefined,
        { stateRoot: f.stateRoot },
      ),
      receiptStore,
    };
    const reports = await refreshTaskTargets({
      targets: [f.target, other],
      reader: {
        listTasks: async ({ listId }) => (listId === "list-1" ? live : []),
      },
    });
    assert.deepEqual(
      reports.map((report) => report.freshness),
      ["fresh", "fresh"],
    );
    assert.equal((await f.receiptStore.read())?.listId, "list-1");
    assert.equal((await receiptStore.read())?.listId, "research-list");
    assert.notEqual(reports[0]?.generation, reports[1]?.generation);
    assert.equal(
      (await readdir(join(f.stateRoot, "task-refresh-receipts"))).filter(
        (name) => name.endsWith(".json"),
      ).length,
      2,
    );
  });

  it("refuses receipt storage inside the Drive mount without creating receipt files", async () => {
    const f = await fixture();
    const receiptStore = createFileTaskRefreshReceiptStore({
      stateRoot: f.driveMount,
      driveMount: f.driveMount,
      target: identity,
    });
    await assert.rejects(receiptStore.read(), /outside the Drive mount/u);
    const result = await readTaskTargetRegister({
      target: { ...f.target, receiptStore },
      reader: { listTasks: async () => live },
    });
    assert.equal(result.outcome, "stale");
    assert.deepEqual(await readdir(f.driveMount), ["module"]);
  });
});
