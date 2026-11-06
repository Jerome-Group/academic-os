import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { isRecord } from "../conformance/value-shape.js";

async function manifest(directory: string): Promise<Record<string, unknown>> {
  const handle = await open(
    join(directory, "package.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let value: unknown;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 67108864)
      throw new Error(
        "Runtime package metadata kind, sharing or length differs.",
      );
    value = JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
  if (!isRecord(value))
    throw new Error("Runtime package metadata is not an object.");
  return value;
}

function dependencies(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !isRecord(value) ||
    Object.values(value).some((version) => typeof version !== "string")
  )
    throw new Error("Runtime package dependencies are invalid.");
  return Object.keys(value);
}

async function ordinaryDirectory(path: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Runtime dependency resolution requires ordinary directories.",
    );
  return true;
}

export async function installedRuntimeDependencyFiles(
  root: string,
): Promise<string[]> {
  const files: string[] = [];
  const packages = new Set<string>();
  const resolvePackage = async (
    from: string,
    name: string,
  ): Promise<string | undefined> => {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name))
      throw new Error("Runtime dependency package name is invalid.");
    let directory = from;
    while (true) {
      if (basename(directory) !== "node_modules") {
        const modules = join(directory, "node_modules");
        if (await ordinaryDirectory(modules)) {
          const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
          if (!scope || (await ordinaryDirectory(join(modules, scope)))) {
            const candidate = join(modules, name);
            if (await ordinaryDirectory(candidate)) return candidate;
          }
        }
      }
      if (directory === root) return undefined;
      directory = dirname(directory);
    }
  };
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") {
        if (!entry.isDirectory())
          throw new Error(
            "Nested runtime dependency container must be an ordinary directory.",
          );
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relative(root, path));
      else
        throw new Error(
          "Runtime dependency input must be an ordinary file or directory.",
        );
    }
  };
  const visit = async (directory: string, direct = false): Promise<void> => {
    if (packages.has(directory)) return;
    packages.add(directory);
    const value = await manifest(directory);
    if (!direct) await walk(directory);
    const optional = new Set(dependencies(value.optionalDependencies));
    const peerMetadata = isRecord(value.peerDependenciesMeta)
      ? value.peerDependenciesMeta
      : {};
    const peers = direct
      ? []
      : [...dependencies(value.peerDependencies), ...Object.keys(peerMetadata)];
    const names = new Set([
      ...dependencies(value.dependencies),
      ...optional,
      ...peers,
    ]);
    for (const name of names) {
      const dependency = await resolvePackage(directory, name);
      const resolved = (() => {
        try {
          return createRequire(join(directory, "package.json")).resolve(name);
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            (error.code === "MODULE_NOT_FOUND" ||
              error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
          )
            return undefined;
          throw error;
        }
      })();
      if (
        resolved &&
        (!dependency ||
          isAbsolute(relative(dependency, resolved)) ||
          relative(dependency, resolved).startsWith("../"))
      )
        throw new Error(
          "Runtime dependency resolves outside its bound installed package.",
        );
      const peer = peerMetadata[name];
      if (dependency) await visit(dependency);
      else if (
        !optional.has(name) &&
        !(isRecord(peer) && peer.optional === true)
      )
        throw new Error(`Installed runtime dependency is missing: ${name}.`);
    }
  };
  await visit(root, true);
  return files.sort();
}
