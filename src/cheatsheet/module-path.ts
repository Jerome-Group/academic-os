import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function isOutside(root: string, target: string): boolean {
  const child = relative(root, target);
  return (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  );
}

export async function resolveModuleFile(
  moduleRoot: string,
  path: string,
): Promise<string> {
  const root = resolve(moduleRoot);
  const target = resolve(root, path);
  if (isOutside(root, target)) {
    throw new Error(`${path} does not name a file inside the module folder.`);
  }

  const canonicalRoot = await realpath(root);
  const segments = relative(root, target).split(sep);
  let candidate = canonicalRoot;
  for (const [index, segment] of segments.entries()) {
    candidate = join(candidate, segment);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${path} traverses a symbolic link.`);
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      throw new Error(`${path} does not name an ordinary file.`);
    }
  }
  const canonicalTarget = await realpath(candidate);
  if (isOutside(canonicalRoot, canonicalTarget)) {
    throw new Error(`${path} resolves outside the module folder.`);
  }
  return canonicalTarget;
}

export async function resolveNewModuleDirectory(
  moduleRoot: string,
  path: string,
): Promise<string> {
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(
      "Evidence directory must be a normalized module-relative path.",
    );
  let candidate = await realpath(moduleRoot);
  const segments = path.split("/");
  for (const segment of segments.slice(0, -1)) {
    candidate = join(candidate, segment);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw new Error(
        "Evidence directory traverses a symbolic link or non-directory.",
      );
  }
  return join(candidate, segments.at(-1) ?? "");
}
