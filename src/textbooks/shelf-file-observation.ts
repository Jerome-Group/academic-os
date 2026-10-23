import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import { checksumFile } from "../checksum-file.js";

export interface ShelfIdentity {
  dev: string;
  ino: string;
}

export interface ShelfFileObservation extends ShelfIdentity {
  sha256: string;
  size: string;
}

export function shelfName(name: string): string {
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    basename(name) !== name ||
    name.includes("\0") ||
    name.includes("\\") ||
    Buffer.byteLength(name) > 255
  )
    throw new Error(`Not a direct Shelf filename: ${name}.`);
  return name;
}

export function identity(
  stat: Pick<BigIntStats, "dev" | "ino">,
): ShelfIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

export function sameIdentity(a: ShelfIdentity, b: ShelfIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

export function sameFile(
  a: ShelfFileObservation,
  b: ShelfFileObservation,
): boolean {
  return sameIdentity(a, b) && a.sha256 === b.sha256 && a.size === b.size;
}

export async function requireShelfRoot(
  root: string,
  expected: ShelfIdentity,
): Promise<void> {
  const stat = await lstat(root, { bigint: true });
  if (
    !stat.isDirectory() ||
    !sameIdentity(identity(stat), expected) ||
    (await realpath(root)) !== root
  )
    throw new Error(`Shelf root identity changed: ${root}.`);
}

export async function observeShelfFile(
  root: string,
  name: string,
): Promise<ShelfFileObservation | null> {
  const path = join(root, shelfName(name));
  let stat: BigIntStats;
  try {
    stat = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  if (!stat.isFile()) throw new Error(`Shelf file is not ordinary: ${path}.`);
  await ensureMaterialized(path);
  const checked = await checksumFile(path, stat);
  if (checked.size !== stat.size)
    throw new Error(`Incomplete Shelf read: ${path}.`);
  return {
    ...identity(stat),
    size: String(checked.size),
    sha256: checked.sha256,
  };
}

export async function readShelfFile(
  root: string,
  name: string,
): Promise<{
  observation: ShelfFileObservation;
  bytes: Buffer;
} | null> {
  const path = join(root, shelfName(name));
  let before: BigIntStats;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  if (!before.isFile()) throw new Error(`Shelf file is not ordinary: ${path}.`);
  await ensureMaterialized(path);
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    requireStable(before, await file.stat({ bigint: true }), path);
    const bytes = await file.readFile();
    requireStable(before, await file.stat({ bigint: true }), path);
    requireStable(before, await lstat(path, { bigint: true }), path);
    if (BigInt(bytes.byteLength) !== before.size)
      throw new Error(`Incomplete Shelf read: ${path}.`);
    return {
      bytes,
      observation: {
        ...identity(before),
        size: String(before.size),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  } finally {
    await file.close();
  }
}

function requireStable(
  before: BigIntStats,
  after: BigIntStats,
  path: string,
): void {
  if (
    !after.isFile() ||
    !sameIdentity(identity(before), identity(after)) ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new Error(`Shelf file changed while reading: ${path}.`);
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
