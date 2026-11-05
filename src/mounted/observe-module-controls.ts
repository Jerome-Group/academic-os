import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { moduleControlPaths } from "../conformance/control-paths.js";
import type { Inventory } from "../conformance/types.js";
import { moduleHeadPath, type ControlObservation } from "../controls/index.js";
import { safeRelativePath } from "../controls/read-controls.js";
import { isContainedBy } from "./is-contained-by.js";

export async function observeModuleControls(
  root: string,
  inventory: Inventory,
): Promise<ControlObservation[]> {
  const known = new Set<string>(Object.values(moduleControlPaths));
  const paths = inventory.entries
    .filter(
      (entry) =>
        entry.path === moduleHeadPath ||
        known.has(entry.path) ||
        /^\.academic-os\/control-generations\/.+\.json$/u.test(entry.path) ||
        /^70 Learning\/[^/]+\/records\/[^/]+\.md$/u.test(entry.path) ||
        /^70 Learning\/(?:templates\/preferences|MISSION|NOTES|REVISIT|GLOSSARY|RESOURCES)\.md$/u.test(
          entry.path,
        ) ||
        /^docs\/(?:adr\/)?[^/]+\.md$/u.test(entry.path),
    )
    .map((entry) => entry.path);
  const present = new Set(inventory.entries.map((entry) => entry.path));
  const observed = await Promise.all(
    [...new Set([...known, ...paths])].map((path) =>
      observe(root, path, present.has(path)),
    ),
  );
  return observed.filter(
    (file): file is ControlObservation => file !== undefined,
  );
}

async function observe(
  root: string,
  path: string,
  observedInInventory: boolean,
): Promise<ControlObservation | undefined> {
  try {
    if (!safeRelativePath(path)) throw new Error("Unsafe relative path.");
    let current = root;
    for (const [index, component] of path.split("/").entries()) {
      current = join(current, component);
      const metadata = await lstat(current);
      if (
        metadata.isSymbolicLink() ||
        (index === path.split("/").length - 1
          ? !metadata.isFile()
          : !metadata.isDirectory()) ||
        !isContainedBy(root, await realpath(current))
      )
        throw new Error(
          "Control is not a contained regular file without symbolic links.",
        );
    }
    const handle = await open(
      current,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024)
        throw new Error("Control is not a regular file of at most 8 MiB.");
      const bytes = await handle.readFile();
      if (bytes.byteLength > 8 * 1024 * 1024)
        throw new Error("Control exceeds 8 MiB.");
      return { kind: "file", path, bytes };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      !observedInInventory
    )
      return undefined;
    return {
      kind: "unreadable",
      failure: error instanceof Error && "code" in error ? "io" : "unsafe",
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
