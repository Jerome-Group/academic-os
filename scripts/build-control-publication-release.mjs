import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { encodePublication } from "../dist/src/controls-publication/codec.js";
import { writeRuntimeIntegrity } from "./build-control-publication-integrity.mjs";

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported release source ${path}.`);
  }
  return result;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = [
  ...(await files("src")),
  "package-lock.json",
  "scripts/build-control-publication-native.mjs",
  "scripts/build-control-publication-release.mjs",
  "scripts/check-control-publication-imports.mjs",
  "scripts/build-control-publication-standalone.mjs",
  "scripts/build-control-publication-integrity.mjs",
  "scripts/build-native-inventory.mjs",
  "scripts/deploy-native-source-policy.mjs",
].sort();
const sourceBindings = [];
for (const path of sources)
  sourceBindings.push({
    path: relative(process.cwd(), path),
    sha256: sha256(await readFile(path)),
  });
let nativeDigest = null;
try {
  nativeDigest = sha256(
    await readFile(
      "dist/src/controls-publication/native/publication-native.node",
    ),
  );
} catch (error) {
  if (process.platform === "darwin" || error?.code !== "ENOENT") throw error;
}
const manifest = {
  encoding: "academic-os-publication-release/1",
  sourceDigest: sha256(encodePublication(sourceBindings)),
  nativeDigest,
  sourceBindings,
};
await mkdir("dist/src/controls-publication", { recursive: true });
await writeFile(
  "dist/src/controls-publication/release.json",
  encodePublication(manifest),
);

await mkdir("dist/src/module-activity", { recursive: true });
await writeFile(
  "dist/src/module-activity/release.json",
  encodePublication(manifest),
);
await writeRuntimeIntegrity(
  process.cwd(),
  join(process.cwd(), "dist/src/controls-publication"),
);
