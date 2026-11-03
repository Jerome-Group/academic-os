import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const cheatsheetExecutables = [
  "latexmk",
  "kpsewhich",
  "pdfinfo",
  "pdffonts",
  "pdftotext",
  "pdftoppm",
  "pdftohtml",
] as const;

export function cheatsheetExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.ACADEMIC_OS_TOOL_PATH !== undefined) return env.ACADEMIC_OS_TOOL_PATH;
  const dependencies = join(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies",
  );
  return [
    ...new Set(
      [
        ...(env.PATH ?? "").split(delimiter),
        ...(process.platform === "darwin"
          ? ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin"]
          : []),
        join(dependencies, "bin/override"),
        join(dependencies, "bin/fallback"),
        join(dependencies, "native/poppler/poppler/bin"),
        join(homedir(), "Library/TinyTeX/bin/universal-darwin"),
        join(homedir(), ".TinyTeX/bin/universal-darwin"),
      ].filter(Boolean),
    ),
  ].join(delimiter);
}

export function findCheatsheetExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const directory of cheatsheetExecutablePath(env)
    .split(delimiter)
    .filter(Boolean)) {
    const path = join(directory, executable);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  return undefined;
}

export function requireCheatsheetExecutable(executable: string): string {
  const path = findCheatsheetExecutable(executable);
  if (path === undefined)
    throw new Error(
      `Missing cheatsheet executable: ${executable}. Set PATH or ACADEMIC_OS_TOOL_PATH to the complete TeX/Poppler toolchain.`,
    );
  return path;
}
