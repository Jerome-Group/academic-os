import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  createSeedOperation,
  optionalLstat,
} from "../mounted/seed-target-state.js";
import type { SeedOperation } from "../seed/types.js";

interface DirectoryIdentity {
  device: number;
  inode: number;
}

export async function publishCheatsheetPackage(
  staging: string,
  destination: string,
  checkpoint?: () => Promise<void>,
): Promise<void> {
  const requested = resolve(destination);
  const root = join(await realpath(dirname(requested)), basename(requested));
  await mkdir(root);
  const identities = new Map<string, DirectoryIdentity>();
  try {
    const claim = await recordDirectoryIdentity(root, identities);
    await verifyDirectories(identities);
    await createSeedOperation(root, {
      kind: "file",
      path: ".package-publication.json",
      contents: `${JSON.stringify({
        schemaVersion: 1,
        ...claim,
        state:
          "claimed; completion requires package checksums and verification",
      })}\n`,
    });
    await checkpoint?.();
    await copyTree(staging, root, "", identities);
    await verifyDirectories(identities);
  } catch (error) {
    throw new Error(
      `Package publication incomplete; destination retained for reconciliation at ${root}. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function copyTree(
  staging: string,
  destination: string,
  path: string,
  identities: Map<string, DirectoryIdentity>,
): Promise<void> {
  for (const entry of (
    await readdir(join(staging, path), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path === "" ? entry.name : `${path}/${entry.name}`;
    await verifyDirectories(identities);
    let operation: SeedOperation;
    if (entry.isDirectory()) operation = { kind: "directory", path: child };
    else if (entry.isFile())
      operation = {
        kind: "file",
        path: child,
        contentsBase64: (await readFile(join(staging, child))).toString(
          "base64",
        ),
      };
    else
      throw new Error(`Staged package contains a nonordinary entry: ${child}.`);
    await verifyDirectories(identities);
    await createSeedOperation(destination, operation);
    if (operation.kind === "directory") {
      await recordDirectoryIdentity(join(destination, child), identities);
      await copyTree(staging, destination, child, identities);
    }
    await verifyDirectories(identities);
  }
}

async function recordDirectoryIdentity(
  path: string,
  identities: Map<string, DirectoryIdentity>,
): Promise<DirectoryIdentity> {
  const metadata = await optionalLstat(path);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(path)) !== path
  )
    throw new Error(
      "Package directory identity is unavailable or traverses a symbolic link.",
    );
  const identity = { device: metadata.dev, inode: metadata.ino };
  identities.set(path, identity);
  return identity;
}

async function verifyDirectories(
  identities: Map<string, DirectoryIdentity>,
): Promise<void> {
  for (const [path, expected] of identities) {
    const metadata = await optionalLstat(path);
    if (
      metadata === undefined ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.dev !== expected.device ||
      metadata.ino !== expected.inode ||
      (await realpath(path)) !== path
    )
      throw new Error(
        "Package directory identity changed; publication refused.",
      );
  }
}
