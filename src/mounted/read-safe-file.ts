import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../operational-error.js";
import { isContainedBy } from "./is-contained-by.js";

export async function readSafeFile(
  root: string,
  components: readonly string[],
  label: string,
): Promise<string> {
  let current = root;
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(current);
    } catch {
      throw new OperationalError(
        "invalid-target",
        `${label} component cannot be read: ${component}.`,
      );
    }
    if (metadata.isSymbolicLink()) {
      throw new OperationalError(
        "symlink-target",
        `${label} component is a symbolic link: ${component}.`,
      );
    }
    const final = index === components.length - 1;
    if (final ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new OperationalError(
        "invalid-target",
        `${label} component has the wrong type: ${component}.`,
      );
    }
    const resolved = await realpath(current);
    if (!isContainedBy(root, resolved)) {
      throw new OperationalError(
        "out-of-root",
        `${label} resolves outside the module root.`,
      );
    }
  }
  try {
    return await readNoFollow(current);
  } catch {
    throw new OperationalError("invalid-target", `${label} cannot be read.`);
  }
}

export async function readNoFollow(
  path: string,
  maximumBytes?: number,
): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Path is not a regular file.");
    if (maximumBytes !== undefined && metadata.size > maximumBytes) {
      throw new Error("File exceeds the permitted size.");
    }
    const bytes = await handle.readFile();
    if (maximumBytes !== undefined && bytes.byteLength > maximumBytes) {
      throw new Error("File exceeds the permitted size.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}
