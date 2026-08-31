import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AcademicConfig,
  resolveConfiguredResearchProject,
} from "../../src/config/index.js";

const config: AcademicConfig = {
  driveMount: "/Volumes/Drive",
  stateRoot: "/private/state",
  activeSemester: "Y2S1",
  semesters: {
    Y2S1: { root: "Modules/Y2S1", status: "active", modules: ["MH2100"] },
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
};

describe("resolveConfiguredResearchProject", () => {
  it("resolves one exact stable key without treating the project as a module", () => {
    assert.deepEqual(resolveConfiguredResearchProject(config, "ureca-y2"), {
      key: "ureca-y2",
      root: "Modules/Research",
      folder: "URECA Y2",
      status: "active",
      profile: "ureca",
      taskListTitle: "URECA Y2",
    });
  });

  it("rejects a research root outside the relative Drive namespace", () => {
    const unsafe = structuredClone(config);
    if (unsafe.research === undefined) assert.fail("fixture lacks research");
    unsafe.research.root = "/tmp/research";

    assert.throws(
      () => resolveConfiguredResearchProject(unsafe, "ureca-y2"),
      /Research root must be a relative path inside the Drive mount/u,
    );
  });

  it("rejects a display name in place of a stable project key", () => {
    const malformed = structuredClone(config);
    if (malformed.research === undefined) assert.fail("fixture lacks research");
    malformed.research.projects = {
      "URECA Y2": { folder: "URECA Y2", status: "active" },
    };

    assert.throws(
      () => resolveConfiguredResearchProject(malformed, "URECA Y2"),
      /Research project keys must be lowercase stable slugs/u,
    );
  });

  it("rejects case-folded folder collisions", () => {
    const malformed = structuredClone(config);
    if (malformed.research === undefined) assert.fail("fixture lacks research");
    malformed.research.projects["second-project"] = {
      folder: "ureca y2",
      status: "active",
      taskListTitle: "Second Project",
    };

    assert.throws(
      () => resolveConfiguredResearchProject(malformed, "ureca-y2"),
      /case-insensitively unique/u,
    );
  });

  it("rejects duplicate effective Task-list titles", () => {
    const malformed = structuredClone(config);
    if (malformed.research === undefined) assert.fail("fixture lacks research");
    malformed.research.projects["second-project"] = {
      folder: "Second Project",
      status: "active",
      taskListTitle: "URECA Y2",
    };

    assert.throws(
      () => resolveConfiguredResearchProject(malformed, "ureca-y2"),
      /unique effective Task-list titles/u,
    );
  });

  it("rejects a Research Task-list title that collides with a Module", () => {
    const malformed = structuredClone(config);
    if (malformed.research === undefined) assert.fail("fixture lacks research");
    const project = malformed.research.projects["ureca-y2"];
    if (project === undefined) assert.fail("fixture lacks project");
    project.taskListTitle = "MH2100";

    assert.throws(
      () => resolveConfiguredResearchProject(malformed, "ureca-y2"),
      /collides with a configured Module list/u,
    );
  });
});
