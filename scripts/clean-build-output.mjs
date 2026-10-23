import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist");
const config = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"));
if (config.compilerOptions?.outDir !== "dist")
  throw new Error(
    "Refusing to clean build output. tsconfig.json must target dist.",
  );

const existing = await lstat(output).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (existing !== undefined) {
  if (!existing.isDirectory()) refuse(output);
  for (const entry of await readdir(output, { withFileTypes: true })) {
    const path = join(output, entry.name);
    if (!["src", "test"].includes(entry.name) || !entry.isDirectory())
      refuse(path);
    await inspectArtifacts(path);
  }
  await rm(output, { recursive: true });
}

async function inspectArtifacts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspectArtifacts(path);
    else if (!entry.isFile() || !/\.(js|d\.ts)$/u.test(entry.name))
      refuse(path);
  }
}

function refuse(path) {
  throw new Error(`Refusing to clean build output. Unsupported entry ${path}.`);
}
