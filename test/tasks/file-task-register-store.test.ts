import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { researchTaskProvenanceKeys } from "../../src/contract/task-register.js";
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
