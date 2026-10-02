import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export function codexSearchDirectories(codexPath: string): string[] {
  const binaryDirectory = dirname(codexPath);
  const packageRoot = codexPackageRoot(codexPath);
  const helperDirectory =
    packageRoot === undefined
      ? undefined
      : declaredSearchDirectory(packageRoot, codexPath);
  return helperDirectory === undefined
    ? [binaryDirectory]
    : [helperDirectory, binaryDirectory];
}

function codexPackageRoot(codexPath: string): string | undefined {
  if (basename(codexPath) !== "codex") return undefined;
  const directory = dirname(codexPath);
  if (basename(directory) === "bin") return dirname(directory);
  if (
    basename(directory) === "MacOS" &&
    basename(dirname(directory)) === "Contents" &&
    basename(resolve(directory, "../..")) === "CodexCLI.app"
  ) {
    return resolve(directory, "../../..");
  }
  return undefined;
}

function declaredSearchDirectory(
  packageRoot: string,
  codexPath: string,
): string | undefined {
  try {
    if (!lstatSync(packageRoot).isDirectory()) return undefined;
    let binaryAncestor = packageRoot;
    for (const part of relative(packageRoot, dirname(codexPath)).split(sep)) {
      binaryAncestor = join(binaryAncestor, part);
      if (!lstatSync(binaryAncestor).isDirectory()) return undefined;
    }
    if (!lstatSync(codexPath).isFile()) return undefined;
    accessSync(codexPath, constants.X_OK);
    const manifestPath = join(packageRoot, "codex-package.json");
    const manifestFile = lstatSync(manifestPath);
    if (!manifestFile.isFile() || manifestFile.size > 64 * 1024)
      return undefined;
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest !== "object" || manifest === null) return undefined;
    const value = manifest as Record<string, unknown>;
    const pathDir = value.pathDir;
    if (
      value.layoutVersion !== 1 ||
      value.variant !== "codex" ||
      value.entrypoint !== "bin/codex" ||
      typeof pathDir !== "string" ||
      pathDir.length === 0 ||
      isAbsolute(pathDir) ||
      pathDir.includes("\\") ||
      pathDir.includes(delimiter) ||
      pathDir.split("/").some((part) => ["", ".", ".."].includes(part))
    ) {
      return undefined;
    }
    const canonicalRoot = realpathSync(packageRoot);
    const directory = join(packageRoot, pathDir);
    let ancestor = packageRoot;
    for (const part of pathDir.split("/")) {
      ancestor = join(ancestor, part);
      if (!lstatSync(ancestor).isDirectory()) return undefined;
    }
    const within = relative(canonicalRoot, realpathSync(directory));
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
      return undefined;
    const helper = join(directory, "rg");
    if (!lstatSync(helper).isFile()) return undefined;
    accessSync(helper, constants.X_OK);
    return directory;
  } catch {
    return undefined;
  }
}
