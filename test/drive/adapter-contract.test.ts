import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { auditModule } from "../../src/conformance/index.js";
import {
  inventoryDriveModule,
  type DriveFile,
  type DriveFilePage,
  type DriveFilesClient,
  type DriveListRequest,
} from "../../src/drive/index.js";
import {
  inventoryMountedModule,
  type LocalConfig,
} from "../../src/mounted/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { universalPaths } from "../fixtures/universal-structure.js";
import { testModuleContract } from "../fixtures/module-contract.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

class TreeDriveClient implements DriveFilesClient {
  constructor(private readonly children: Map<string, DriveFile[]>) {}

  async listFiles(request: DriveListRequest): Promise<DriveFilePage> {
    return { files: this.children.get(request.parentId) ?? [] };
  }
}

describe("inventory adapter contract", () => {
  it("mounted and Drive inventories yield equivalent conformance", async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-os-contract-"));
    temporaryRoots.push(root);
    const moduleRoot = join(root, "Drive", "Modules", "Y2S1", "MH2100");
    const stateRoot = join(root, "State");
    await mkdir(moduleRoot, { recursive: true });
    await mkdir(stateRoot);
    for (const [path, kind] of [...universalPaths, ...learningWorkspacePaths]) {
      const target = join(moduleRoot, path);
      if (kind === "directory") await mkdir(target, { recursive: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, "synthetic\n");
      }
    }
    await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
    const config: LocalConfig = {
      driveMount: join(root, "Drive"),
      stateRoot,
      semester: "Y2S1",
      module: "MH2100",
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    };
    const mounted = await inventoryMountedModule(config);
    const drive = await inventoryDriveModule(
      { moduleCode: "MH2100", moduleFolderId: "root-id" },
      new TreeDriveClient(toDriveTree(mounted.inventory.entries)),
    );
    const controls = validModuleControls();

    const mountedResult = auditModule(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
        inventory: mounted.inventory,
      },
      testModuleContract,
    );
    const driveResult = auditModule(
      {
        moduleCode: "MH2100",
        semester: "Y2S1",
        controls,
        inventory: drive,
      },
      testModuleContract,
    );

    assert.deepEqual(driveResult, mountedResult);
    assert.deepEqual(mounted.inventory.provenance, {
      source: "mounted",
      target: mounted.target.moduleRoot,
      completeness: "complete",
      diagnostics: [],
      excludedTrashedItems: 0,
    });
    assert.ok(
      mounted.inventory.entries.every(
        ({ providerMetadata }) => providerMetadata !== undefined,
      ),
    );
  });
});

function toDriveTree(
  entries: Awaited<
    ReturnType<typeof inventoryMountedModule>
  >["inventory"]["entries"],
): Map<string, DriveFile[]> {
  const children = new Map<string, DriveFile[]>();
  for (const entry of entries) {
    const segments = entry.path.split("/");
    const name = segments.pop() ?? "";
    const parentPath = segments.join("/");
    const parentId = parentPath === "" ? "root-id" : `id:${parentPath}`;
    const list = children.get(parentId) ?? [];
    list.push({
      id: `id:${entry.path}`,
      name,
      mimeType:
        entry.kind === "directory"
          ? "application/vnd.google-apps.folder"
          : "application/octet-stream",
      parents: [parentId],
      modifiedTime: "2026-08-12T00:00:00.000Z",
      ...(entry.kind === "file" ? { size: String(entry.size ?? 0) } : {}),
      trashed: false,
    });
    children.set(parentId, list);
  }
  return children;
}
