import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { AcademicConfig } from "../../src/config/index.js";
import {
  OperationalError,
  resolveConfiguredResearchProjectRoots,
} from "../../src/mounted/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("resolveConfiguredResearchProjectRoots", () => {
  it("resolves one exact configured child and safely describes an absent seed target", async () => {
    const fixture = await rootsFixture();
    await mkdir(fixture.projectRoot);

    const present = await resolveConfiguredResearchProjectRoots(
      fixture.config,
      "example-project",
      { requireProject: true },
    );
    assert.equal(present.researchRoot, await realpath(fixture.researchRoot));
    assert.equal(present.projectRoot, await realpath(fixture.projectRoot));
    assert.equal(present.project.key, "example-project");

    await rm(fixture.projectRoot, { recursive: true });
    const absent = await resolveConfiguredResearchProjectRoots(
      fixture.config,
      "example-project",
    );
    assert.equal(
      absent.projectRoot,
      join(absent.researchRoot, "Example Project"),
    );
    await assert.rejects(
      resolveConfiguredResearchProjectRoots(fixture.config, "example-project", {
        requireProject: true,
      }),
      (error: unknown) => hasCode(error, "missing-target"),
    );
  });

  it("rejects an unsafe state root, case variant, symlink target, and escaped research root", async () => {
    const unsafe = await rootsFixture();
    unsafe.config.stateRoot = join(unsafe.driveMount, "State");
    await mkdir(unsafe.config.stateRoot);
    await assert.rejects(
      resolveConfiguredResearchProjectRoots(unsafe.config, "example-project"),
      (error: unknown) => hasCode(error, "unsafe-state-root"),
    );

    const caseVariant = await rootsFixture();
    await mkdir(join(caseVariant.researchRoot, "example project"));
    await assert.rejects(
      resolveConfiguredResearchProjectRoots(
        caseVariant.config,
        "example-project",
      ),
      (error: unknown) => hasCode(error, "case-variant-target"),
    );

    const linked = await rootsFixture();
    const outside = join(linked.root, "Outside Project");
    await mkdir(outside);
    await symlink(outside, linked.projectRoot);
    await assert.rejects(
      resolveConfiguredResearchProjectRoots(linked.config, "example-project"),
      (error: unknown) => hasCode(error, "symlink-target"),
    );

    const escaped = await rootsFixture({ createResearchRoot: false });
    const outsideResearch = join(escaped.root, "Outside Research");
    await mkdir(outsideResearch);
    await mkdir(join(escaped.driveMount, "Modules"));
    await symlink(outsideResearch, escaped.researchRoot);
    await assert.rejects(
      resolveConfiguredResearchProjectRoots(escaped.config, "example-project"),
      (error: unknown) => hasCode(error, "out-of-root"),
    );
  });
});

async function rootsFixture(options: { createResearchRoot?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-research-roots-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research");
  const projectRoot = join(researchRoot, "Example Project");
  await mkdir(driveMount);
  await mkdir(stateRoot);
  if (options.createResearchRoot !== false) {
    await mkdir(researchRoot, { recursive: true });
  }
  const config: AcademicConfig = {
    driveMount,
    stateRoot,
    activeSemester: "Y2S1",
    semesters: {
      Y2S1: { root: "Modules/Y2S1", status: "active", modules: [] },
    },
    research: {
      root: "Modules/Research",
      projects: {
        "example-project": {
          folder: "Example Project",
          status: "active",
          profile: "ureca",
        },
      },
    },
  };
  return {
    root,
    driveMount,
    researchRoot,
    projectRoot,
    config,
  };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof OperationalError && error.code === code;
}
