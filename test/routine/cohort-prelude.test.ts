import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createCohortPrelude } from "../../src/routine/index.js";
import type { AcademicConfig } from "../../src/config/index.js";

it("modules-only excludes Research providers and shared shelf writes before target construction", async () => {
  const root = await mkdtemp(join(tmpdir(), "academic-os-scoped-prelude-"));
  try {
    const driveMount = join(root, "drive");
    const stateRoot = join(root, "state");
    await mkdir(stateRoot);
    const modules = Array.from({ length: 6 }, (_, index) => `AB100${index}`);
    for (const module of modules) {
      const admin = join(driveMount, "Semester", module, "00 Module Admin");
      await mkdir(admin, { recursive: true });
      await writeFile(
        join(admin, "30 Task Register.yaml"),
        `list_id: list-${module}\ntasks: []\n`,
      );
    }
    const config: AcademicConfig = {
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: { Y2S1: { root: "Semester", status: "active", modules } },
      research: {
        root: "../unauthorized",
        projects: { unauthorized: { folder: "Excluded", status: "active" } },
      },
      // No shelf or credentials: skipped/unselected dependencies must never resolve.
    };
    const requests: string[] = [];
    const prelude = createCohortPrelude(config, {
      modulesOnly: true,
      taskReader: {
        listTasks: async ({ listId }) => {
          requests.push(listId);
          assert.ok(modules.some((module) => listId === `list-${module}`));
          if (listId === `list-${modules[0]}`)
            throw new Error("synthetic selected-provider failure");
          return [];
        },
      },
    });
    assert.equal((await prelude.catchUpShelf()).outcome, "skipped");
    const before = await readFile(
      join(
        driveMount,
        "Semester",
        modules[0] ?? "",
        "00 Module Admin/30 Task Register.yaml",
      ),
      "utf8",
    );
    const report = await prelude.pullTaskRegisters();
    assert.equal(report.outcome, "partially-refreshed");
    assert.deepEqual(
      requests.sort(),
      modules.map((module) => `list-${module}`).sort(),
    );
    assert.equal(
      await readFile(
        join(
          driveMount,
          "Semester",
          modules[0] ?? "",
          "00 Module Admin/30 Task Register.yaml",
        ),
        "utf8",
      ),
      before,
    );
    assert.equal(report.detail.length, 6);
    await assert.rejects(
      createCohortPrelude(config, {
        taskReader: {
          listTasks: async () => {
            throw new Error("unselected provider must not run");
          },
        },
      }).pullTaskRegisters(),
      /Research|root|configured/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
