import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const adapters = new Map([
  [
    "scripts/deploy-native-source-policy.mjs",
    "src/controls-publication/host-deployment",
  ],
  ["src/cli.ts", "src/controls-publication/command"],
  ["src/operations/run-operations-server.ts", "src/controls-publication/tools"],
  ["src/capabilities/catalog.ts", "src/controls-publication/tools"],
  [
    "scripts/build-control-publication-release.mjs",
    "src/controls-publication/codec",
  ],
]);

function violations(importer, imports) {
  if (
    importer.startsWith("src/controls-publication/") ||
    importer.startsWith("test/controls-publication/")
  )
    return [];
  return imports.flatMap(({ path: specifier }) => {
    if (
      !specifier.startsWith(".") &&
      !specifier.startsWith("file:") &&
      !isAbsolute(specifier)
    )
      return [];
    const target = relative(
      root,
      specifier.startsWith("file:")
        ? fileURLToPath(specifier)
        : resolve(root, dirname(importer), specifier),
    )
      .toLowerCase()
      .replace(/^dist\//u, "")
      .replace(/\.(?:[cm]?js|tsx?)$/u, "");
    if (
      !target.startsWith("src/controls-publication/") ||
      target === "src/controls-publication/index" ||
      adapters.get(importer) === target
    )
      return [];
    return [
      `${importer} imports private publication module ${specifier}. Use src/controls-publication/index.ts.`,
    ];
  });
}

async function sources(directory) {
  const files = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (
      entry.isFile() &&
      /\.(?:[cm]?js|tsx?)$/u.test(path) &&
      !path.endsWith(".d.ts")
    )
      files.push(path);
  }
  return files;
}

const args = process.argv.slice(2);
const compiler = {
  absWorkingDir: root,
  bundle: false,
  write: false,
  metafile: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  treeShaking: false,
  tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
};
let failures = [];
if (args.length === 2 && args[0] === "--stdin-file-path") {
  const importer = relative(root, resolve(root, args[1]));
  if (importer.startsWith("../") || !/\.(?:[cm]?js|tsx?)$/u.test(importer))
    throw new Error("Supply a repository-relative source filename.");
  const contents = readFileSync(0, "utf8");
  const result = await build({
    ...compiler,
    stdin: {
      contents,
      sourcefile: importer,
      loader:
        importer.endsWith(".ts") || importer.endsWith(".tsx") ? "ts" : "js",
      resolveDir: resolve(root, dirname(importer)),
    },
  });
  for (const output of Object.values(result.metafile.outputs))
    failures.push(...violations(importer, output.imports));
} else if (args.length === 0) {
  const entries = (await Promise.all(["src", "scripts", "test"].map(sources)))
    .flat()
    .sort();
  const result = await build({
    ...compiler,
    entryPoints: entries,
    outbase: root,
    outdir: ".publication-import-check",
  });
  for (const output of Object.values(result.metafile.outputs)) {
    const inputs = Object.keys(output.inputs);
    if (inputs.length !== 1)
      throw new Error(
        "Publication import check requires one unbundled source per output.",
      );
    failures.push(...violations(inputs[0], output.imports));
  }
} else
  throw new Error(
    "Use no arguments or --stdin-file-path <repository-relative-source>.",
  );

failures = [...new Set(failures)].sort();
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Publication runtime import boundary passed.\n");
