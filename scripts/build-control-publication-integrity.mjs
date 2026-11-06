import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodePublication } from "../dist/src/controls-publication/codec.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function files(root, directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else if (!entry.isFile())
      throw new Error("Runtime artifact must be an ordinary file.");
    else {
      const name = relative(root, path);
      let role;
      if (/\.(?:m?js)$/u.test(name))
        role = /\/generated\/schemas?\.js$/u.test(name)
          ? "schema-javascript"
          : "javascript";
      else if (name.endsWith("/publication-native.node")) role = "native";
      else if (
        name.endsWith("/scan.native") ||
        name.endsWith("/inventory-scan.native")
      )
        role = "scanner";
      else if (name.endsWith("/scan.c") || name.endsWith("/inventory-scan.c"))
        role = "scanner-source";
      else if (
        name.endsWith("/release.json") &&
        path !== join(root, "release.json")
      )
        role = "release-metadata";
      else if (name.endsWith("/package.json")) role = "package-metadata";
      if (role) {
        const stat = await lstat(path),
          bytes = await readFile(path);
        if (stat.nlink !== 1 || bytes.byteLength > 67108864)
          throw new Error("Runtime artifact sharing or length is unsupported.");
        result.push({
          path: name,
          role,
          byteLength: bytes.byteLength,
          sha256: hash(bytes),
        });
      }
    }
  }
  return result;
}
export async function writeRuntimeIntegrity(root, moduleDirectory) {
  root = resolve(root);
  moduleDirectory = resolve(moduleDirectory);
  if (
    (await realpath(root)) !== root ||
    (await realpath(moduleDirectory)) !== moduleDirectory
  )
    throw new Error("Runtime roots must be canonical.");
  const rootFromModule = relative(moduleDirectory, root) || ".";
  if (!["../../..", "../..", "."].includes(rootFromModule))
    throw new Error("Unsupported runtime artifact layout.");
  let artifacts = [];
  if (rootFromModule === ".") {
    for (const name of (await readdir(root)).filter((name) =>
      name.endsWith(".mjs"),
    )) {
      const bytes = await readFile(join(root, name));
      artifacts.push({
        path: name,
        role: "javascript",
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
      });
    }
    artifacts.push(...(await files(root, join(root, "native"))));
  } else
    artifacts = await files(
      root,
      join(root, rootFromModule === "../../.." ? "dist/src" : "src"),
    );
  const lock = await readFile(join(root, "package-lock.json"));
  artifacts.push({
    path: "package-lock.json",
    role: "package-lock",
    byteLength: lock.byteLength,
    sha256: hash(lock),
  });
  const packagePath = join(root, "package.json");
  if (
    await lstat(packagePath).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    )
  ) {
    const bytes = await readFile(packagePath);
    artifacts.push({
      path: "package.json",
      role: "package-metadata",
      byteLength: bytes.byteLength,
      sha256: hash(bytes),
    });
  }
  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  const release = await readFile(join(moduleDirectory, "release.json"));
  const bytes = encodePublication({
    encoding: "academic-os-runtime-consistency/1",
    releaseByteSha256: hash(release),
    rootFromModule,
    artifacts,
  });
  if (bytes.byteLength > 1048576 || artifacts.length > 8192)
    throw new Error("Runtime consistency metadata exceeds its bounds.");
  await writeFile(join(moduleDirectory, "runtime-integrity.json"), bytes, {
    mode: 0o600,
  });
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [root, moduleDirectory, ...extra] = process.argv.slice(2);
  if (
    !root ||
    !moduleDirectory ||
    !isAbsolute(root) ||
    !isAbsolute(moduleDirectory) ||
    extra.length
  )
    throw new Error(
      "Supply canonical absolute installation and publication module directories.",
    );
  await writeRuntimeIntegrity(root, moduleDirectory);
}
