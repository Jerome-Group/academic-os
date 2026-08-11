import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { inspectMountedModule } from "../../src/mounted/index.js";
import type { LocalConfig } from "../../src/mounted/types.js";
import { validModuleControls } from "../fixtures/module-controls.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("inspectMountedModule", () => {
  it("reads files, reports missing and wrong-kind controls as absent", async () => {
    const { config, moduleRoot } = await mountedModule();
    const controls = validModuleControls();
    await writeControl(moduleRoot, "AGENTS.md", controls.agents ?? "");
    await mkdir(join(moduleRoot, "CLAUDE.md"));

    const result = await inspectMountedModule(config);

    assert.equal(result.controls.agents, controls.agents);
    assert.equal(result.controls.profile, undefined);
    assert.equal(result.controls.claude, undefined);
  });

  it("turns an unreadable control into an operational failure", async () => {
    const { config, moduleRoot } = await mountedModule();
    const agentsPath = join(moduleRoot, "AGENTS.md");
    await writeControl(moduleRoot, "AGENTS.md", "instructions\n");
    await chmod(agentsPath, 0);

    try {
      await assert.rejects(
        inspectMountedModule(config),
        /Control cannot be read: AGENTS\.md/u,
      );
    } finally {
      await chmod(agentsPath, 0o600);
    }
  });
});

async function mountedModule(): Promise<{
  config: LocalConfig;
  moduleRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-controls-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", "MH2100");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  return {
    moduleRoot,
    config: {
      driveMount,
      stateRoot,
      semester: "Y2S1",
      module: "MH2100",
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    },
  };
}

async function writeControl(
  moduleRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const path = join(moduleRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
