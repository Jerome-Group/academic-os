import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function compilePortableSource(
  root: string,
  filename: string,
): Promise<number> {
  const workspace = dirname(root);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: workspace,
    TMPDIR: workspace,
    TEXMFHOME: join(workspace, "texmf-home"),
    TEXMFCONFIG: join(workspace, "texmf-config"),
    TEXMFVAR: join(workspace, "texmf-var"),
    openin_any: "p",
    openout_any: "p",
    shell_escape: "f",
  };
  const command = async (executable: string, args: string[]) =>
    (
      await run(executable, args, {
        cwd: root,
        env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      })
    ).stdout;
  const distributionRoots: string[] = [];
  for (const variable of [
    "TEXMFDIST",
    "TEXMFMAIN",
    "TEXMFDEBIAN",
    "TEXMFSYSVAR",
    "TEXMFSYSCONFIG",
  ]) {
    let path: string;
    try {
      path = (await command("kpsewhich", [`-var-value=${variable}`])).trim();
    } catch (error) {
      if (
        variable !== "TEXMFDIST" &&
        error instanceof Error &&
        "code" in error &&
        error.code === 1 &&
        "stdout" in error &&
        typeof error.stdout === "string" &&
        error.stdout.trim() === "" &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.trim() === ""
      )
        continue;
      throw error;
    }
    if (path === "" && variable !== "TEXMFDIST") continue;
    if (!isAbsolute(path))
      throw new Error(`TeX distribution path ${variable} is not absolute.`);
    try {
      distributionRoots.push(await realpath(path));
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
  }
  if (distributionRoots.length === 0)
    throw new Error("TeX distribution resources are unavailable.");
  const configurations = await Promise.all(
    (await command("kpsewhich", ["-all", "texmf.cnf"]))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((path) => realpath(path)),
  );
  await command("latexmk", [
    "-norc",
    "-pdf",
    "-bibtex-",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-no-shell-escape",
    "-recorder",
    "-auxdir=aux",
    `./${filename}`,
  ]);
  const recorder = await readFile(
    join(root, "aux", filename.replace(/\.tex$/u, ".fls")),
    "utf8",
  );
  const buildRoot = await realpath(root);
  const source = await realpath(join(root, filename));
  const inputs = new Set<string>();
  for (const line of recorder.split(/\r?\n/u)) {
    if (!line.startsWith("INPUT ")) continue;
    const input = await realpath(resolve(root, line.slice(6)));
    inputs.add(input);
    if (
      !within(buildRoot, input) &&
      !distributionRoots.some((directory) => within(directory, input)) &&
      !configurations.includes(input)
    )
      throw new Error(
        `Portable release depends on an external input: ${input}`,
      );
  }
  if (!inputs.has(source))
    throw new Error("TeX recorder did not observe the release source.");
  return inputs.size;
}

function within(directory: string, path: string): boolean {
  const suffix = relative(directory, path);
  return (
    suffix === "" ||
    (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
  );
}
