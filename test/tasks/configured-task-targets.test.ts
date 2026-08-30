import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { AcademicConfig } from "../../src/config/index.js";
import {
  activeResearchProjectTaskTargets,
  activeTaskRegisterTargets,
} from "../../src/tasks/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("configured Task targets", () => {
  it("selects active research projects and reads their contract register path", async () => {
    const driveMount = await mkdtemp(
      join(tmpdir(), "academic-os-research-task-target-"),
    );
    const stateRoot = await mkdtemp(
      join(tmpdir(), "academic-os-research-task-state-"),
    );
    temporaryRoots.push(driveMount, stateRoot);
    const projectRoot = join(driveMount, "Modules", "Research", "URECA Y2");
    await mkdir(join(projectRoot, "00 Project Admin"), { recursive: true });
    await writeFile(
      join(projectRoot, "00 Project Admin", "30 Task Register.yaml"),
      "list_id: ureca-list\ntasks: []\n",
    );
    const config: AcademicConfig = {
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
          archive: { folder: "Archive", status: "inactive" },
        },
      },
    };

    const targets = activeResearchProjectTaskTargets(config);

    assert.deepEqual(
      targets.map(({ identity }) => identity),
      [
        {
          kind: "research-project",
          key: "ureca-y2",
          title: "URECA Y2",
        },
      ],
    );
    assert.deepEqual(await targets[0]?.registerStore.read(), {
      listId: "ureca-list",
      tasks: [],
    });
  });

  it("combines active modules and research projects for unattended pulls", () => {
    const config: AcademicConfig = {
      driveMount: "/Drive",
      stateRoot: "/State",
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: {
          root: "Semesters/Y2S1",
          status: "active",
          modules: ["MH2100"],
        },
        Y1S2: {
          root: "Semesters/Y1S2",
          status: "past",
          modules: ["MH1100"],
        },
      },
      research: {
        root: "Modules/Research",
        projects: {
          "ureca-y2": {
            folder: "URECA Y2",
            status: "active",
            taskListTitle: "URECA Y2",
          },
          archive: { folder: "Archive", status: "inactive" },
        },
      },
    };

    assert.deepEqual(
      activeTaskRegisterTargets(config).map(({ identity }) => identity),
      [
        {
          kind: "module",
          key: "Y2S1/MH2100",
          title: "MH2100",
        },
        {
          kind: "research-project",
          key: "ureca-y2",
          title: "URECA Y2",
        },
      ],
    );
  });
});
