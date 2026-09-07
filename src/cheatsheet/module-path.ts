import { isAbsolute, relative, resolve } from "node:path";

export function resolveModuleFile(moduleRoot: string, path: string): string {
  const root = resolve(moduleRoot);
  const target = resolve(root, path);
  const child = relative(root, target);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith("../") ||
    isAbsolute(child)
  ) {
    throw new Error(`${path} does not name a file inside the module folder.`);
  }
  return target;
}
