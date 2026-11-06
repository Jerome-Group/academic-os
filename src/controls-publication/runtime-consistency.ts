import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./codec.js";
import type { RuntimeArtifact } from "./generated/runtime-consistency-1.js";
import { installedRuntimeDependencyFiles } from "./runtime-dependencies.js";
import { parseBytes, validateRuntimeConsistency } from "./schema.js";

function matchesRole(artifact: RuntimeArtifact): boolean {
  switch (artifact.role) {
    case "javascript":
      return /\.(?:m?js)$/u.test(artifact.path);
    case "schema-javascript":
      return /\/generated\/schemas?\.js$/u.test(artifact.path);
    case "native":
      return artifact.path.endsWith("/publication-native.node");
    case "scanner":
      return (
        artifact.path.endsWith("/scan.native") ||
        artifact.path.endsWith("/inventory-scan.native")
      );
    case "scanner-source":
      return /\/(?:inventory-)?scan(?:-core\.[ch]|\.c)$/u.test(artifact.path);
    case "dependency-input":
      return artifact.path.startsWith("node_modules/");
    case "package-lock":
      return artifact.path === "package-lock.json";
    case "release-metadata":
      return artifact.path.endsWith("/release.json");
    case "package-metadata":
      return (
        artifact.path === "package.json" ||
        artifact.path.endsWith("/package.json")
      );
    default: {
      const exhaustive: never = artifact.role;
      return exhaustive;
    }
  }
}

export async function readRuntimeMetadata(path: string): Promise<Uint8Array> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 1048576)
      throw new Error("Runtime metadata kind, sharing or length differs.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function installedArtifactPaths(
  root: string,
  rootFromModule: string,
): Promise<Set<string>> {
  const paths = new Set<string>(["package-lock.json"]);
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === "node_modules")
        throw new Error("Product-local dependency resolution is unsupported.");
      if (entry.isDirectory()) await walk(path);
      else if (!entry.isFile())
        throw new Error(
          "Runtime artifact inventory contains a non-file entry.",
        );
      else if (
        /\.(?:m?js)$/u.test(entry.name) ||
        [
          "publication-native.node",
          "scan.native",
          "scan.c",
          "scan-core.c",
          "scan-core.h",
          "inventory-scan.native",
          "inventory-scan.c",
          "inventory-scan-core.c",
          "inventory-scan-core.h",
          "release.json",
          "package.json",
        ].includes(entry.name)
      )
        paths.add(relative(root, path));
    }
  };
  if (rootFromModule === ".") {
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith(".mjs")) paths.add(entry.name);
    await walk(join(root, "native"));
  } else {
    if (rootFromModule === "../../..")
      for (const name of ["dist/node_modules", "dist/package.json"])
        if (
          await lstat(join(root, name)).then(
            () => true,
            (error: unknown) => {
              if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
                return false;
              throw error;
            },
          )
        )
          throw new Error(
            "Intermediate runtime package resolution metadata is unsupported.",
          );
    await walk(join(root, rootFromModule === "../../.." ? "dist/src" : "src"));
    for (const path of await installedRuntimeDependencyFiles(root))
      paths.add(path);
  }
  if (
    await lstat(join(root, "package.json")).then(
      () => true,
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return false;
        throw error;
      },
    )
  )
    paths.add("package.json");
  return paths;
}

export async function requireRuntimeConsistency(
  moduleUrl: string,
  releaseBytes: Uint8Array,
  nativeDigest: string,
): Promise<void> {
  const modulePath = fileURLToPath(moduleUrl),
    moduleDirectory = dirname(modulePath);
  const encoded = await readRuntimeMetadata(
    join(moduleDirectory, "runtime-integrity.json"),
  );
  if (encoded.byteLength > 1048576)
    throw new Error("Runtime consistency metadata exceeds 1 MiB.");
  const metadata = parseBytes(encoded, validateRuntimeConsistency);
  if (metadata.releaseByteSha256 !== sha256(releaseBytes))
    throw new Error("Runtime consistency metadata belongs to another release.");
  const root = resolve(moduleDirectory, metadata.rootFromModule);
  if ((await realpath(root)) !== root)
    throw new Error("Runtime installation root is not canonical.");
  const executing = relative(root, modulePath);
  if (
    isAbsolute(executing) ||
    executing.startsWith("../") ||
    !metadata.artifacts.some((artifact) => artifact.path === executing)
  )
    throw new Error(
      "Executing publication JavaScript is absent from runtime consistency metadata.",
    );
  const roles = new Set(metadata.artifacts.map((artifact) => artifact.role));
  if (
    !roles.has("javascript") ||
    !roles.has("native") ||
    !roles.has("scanner") ||
    !roles.has("scanner-source") ||
    !roles.has("package-lock")
  )
    throw new Error(
      "Runtime consistency metadata omits a required artifact family.",
    );
  const paths = new Set<string>();
  const installed = await installedArtifactPaths(root, metadata.rootFromModule);
  if (
    installed.size !== metadata.artifacts.length ||
    metadata.artifacts.some((artifact) => !installed.has(artifact.path))
  )
    throw new Error(
      "Installed runtime artifact set differs from its complete binding set.",
    );
  if (
    !metadata.artifacts.some(
      (artifact) =>
        artifact.role === "native" && artifact.sha256 === nativeDigest,
    )
  )
    throw new Error(
      "Native runtime binding differs from the release manifest.",
    );
  for (const artifact of metadata.artifacts) {
    if (
      paths.has(artifact.path) ||
      !matchesRole(artifact) ||
      artifact.path
        .split("/")
        .some((name) => name.toLowerCase() === "journal-ownership")
    )
      throw new Error("Runtime artifact path, role or uniqueness differs.");
    paths.add(artifact.path);
    const path = join(root, artifact.path);
    const parts = artifact.path.split("/");
    parts.pop();
    let parent = root;
    for (const part of parts) {
      parent = join(parent, part);
      const observation = await lstat(parent);
      if (!observation.isDirectory() || observation.isSymbolicLink())
        throw new Error(
          "Runtime artifact ancestry is not an ordinary directory.",
        );
    }
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size !== artifact.byteLength
      )
        throw new Error("Runtime artifact kind, length or sharing differs.");
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        sha256(bytes) !== artifact.sha256
      )
        throw new Error(
          "Installed runtime artifact differs from this release.",
        );
    } finally {
      await handle.close();
    }
  }
}
