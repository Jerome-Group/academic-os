import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  inventoryMountedModule,
  type LocalConfig,
  OperationalError,
} from "../../src/mounted/index.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function configuredTree(module = "MH2100"): Promise<{
  config: LocalConfig;
  driveMount: string;
  moduleRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-mounted-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const semesterRoot = join(driveMount, "Modules", "Y2S1");
  const moduleRoot = join(semesterRoot, module);
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(stateRoot);
  return {
    config: {
      driveMount,
      stateRoot,
      semester: "Y2S1",
      module,
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    },
    driveMount,
    moduleRoot,
  };
}

async function expectOperationalError(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof OperationalError);
    assert.equal(error.code, code);
    return true;
  });
}

async function metadataSnapshot(
  root: string,
  relativeRoot = "",
): Promise<Array<Record<string, string | number>>> {
  const directory = relativeRoot === "" ? root : join(root, relativeRoot);
  const children = (await readdir(directory)).sort();
  const snapshot: Array<Record<string, string | number>> = [];
  for (const child of children) {
    const relativePath =
      relativeRoot === "" ? child : `${relativeRoot}/${child}`;
    const metadata = await lstat(join(root, relativePath));
    snapshot.push({
      path: relativePath,
      mode: metadata.mode,
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    });
    if (metadata.isDirectory()) {
      snapshot.push(...(await metadataSnapshot(root, relativePath)));
    }
  }
  return snapshot;
}

describe("inventoryMountedModule", () => {
  it("inventories metadata without reading or mutating file contents", async () => {
    const { config, moduleRoot } = await configuredTree();
    const notes = join(
      moduleRoot,
      "10 Learning Materials",
      "30 Personal Notes",
    );
    await mkdir(notes, { recursive: true });
    const protectedFile = join(notes, "MH2100_Example.txt");
    await writeFile(protectedFile, "private synthetic contents");
    await writeFile(join(moduleRoot, "Icon\r"), "");
    await writeFile(join(notes, "Icon\r"), "academic contents");
    await chmod(protectedFile, 0o000);
    const metadataBefore = await metadataSnapshot(moduleRoot);

    const { inventory, target } = await inventoryMountedModule(config);

    assert.equal(target.moduleRoot, await realpath(moduleRoot));
    assert.equal(target.stateRoot, await realpath(config.stateRoot));
    assert.deepEqual(
      inventory.entries.map(({ path, kind, size }) => ({ path, kind, size })),
      [
        {
          path: "10 Learning Materials",
          kind: "directory",
          size: undefined,
        },
        {
          path: "10 Learning Materials/30 Personal Notes",
          kind: "directory",
          size: undefined,
        },
        {
          path: "10 Learning Materials/30 Personal Notes/Icon\r",
          kind: "file",
          size: 17,
        },
        {
          path: "10 Learning Materials/30 Personal Notes/MH2100_Example.txt",
          kind: "file",
          size: 26,
        },
      ],
    );
    assert.deepEqual(await metadataSnapshot(moduleRoot), metadataBefore);
    await chmod(protectedFile, 0o600);
    assert.equal(
      await readFile(protectedFile, "utf8"),
      "private synthetic contents",
    );
  });

  it("rejects a missing target and a case-variant target", async () => {
    const { config, moduleRoot } = await configuredTree();
    await rm(moduleRoot, { recursive: true });
    await expectOperationalError(
      () => inventoryMountedModule(config),
      "missing-target",
    );

    await mkdir(join(moduleRoot, "..", "mh2100"));
    await expectOperationalError(
      () => inventoryMountedModule(config),
      "case-variant-target",
    );
  });

  it("rejects duplicate-case targets where the filesystem supports them", async (context) => {
    const { config, moduleRoot } = await configuredTree();
    const duplicate = join(moduleRoot, "..", "mh2100");
    try {
      await mkdir(duplicate);
    } catch {
      context.skip("filesystem is case-insensitive");
      return;
    }

    await expectOperationalError(
      () => inventoryMountedModule(config),
      "ambiguous-target",
    );
  });

  it("rejects symlink targets that escape the configured semester root [MF-ROOT-001]", async () => {
    const { config, moduleRoot } = await configuredTree();
    const outside = join(moduleRoot, "..", "..", "..", "Outside");
    await mkdir(outside);
    await rm(moduleRoot, { recursive: true });
    await symlink(outside, moduleRoot, "dir");

    await expectOperationalError(
      () => inventoryMountedModule(config),
      "symlink-target",
    );
    recordBehaviorEvidence("MF-ROOT-001", () => {
      assert.notEqual(moduleRoot, outside);
    });
  });

  it("rejects semester roots outside the configured Drive mount", async () => {
    const { config, driveMount } = await configuredTree();
    await mkdir(join(driveMount, "..", "Outside", "MH2100"), {
      recursive: true,
    });
    config.semesterRoots.Y2S1 = "../Outside";

    await expectOperationalError(
      () => inventoryMountedModule(config),
      "out-of-root",
    );
  });

  it("rejects private state inside the Drive mount or tracked repository", async () => {
    const { config, moduleRoot } = await configuredTree();
    config.stateRoot = moduleRoot;
    await expectOperationalError(
      () => inventoryMountedModule(config),
      "unsafe-state-root",
    );

    config.stateRoot = await realpath(".");
    await expectOperationalError(
      () => inventoryMountedModule(config),
      "unsafe-state-root",
    );
  });
});
