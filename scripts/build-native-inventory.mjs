import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sources = new URL(
  "../src/migration/native-inventory/native/",
  import.meta.url,
);
const output = new URL(
  "../dist/src/migration/native-inventory/native/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceFiles = await Promise.all(
  ["scan.c", "scan-core.c", "scan-core.h"].map(async (path) => ({
    path,
    sha256: sha256(await readFile(new URL(path, sources))),
  })),
);
let binding = {
  encoding: "academic-os-native-inventory-helper/2",
  platform: process.platform,
  sourceSha256: sourceFiles[0].sha256,
  sourceFiles,
  available: false,
};
if (process.platform === "darwin") {
  const executable = new URL("scan.native", output);
  execFileSync("/usr/bin/xcrun", [
    "clang",
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wno-deprecated-declarations",
    fileURLToPath(new URL("scan.c", sources)),
    fileURLToPath(new URL("scan-core.c", sources)),
    "-o",
    fileURLToPath(executable),
  ]);
  for (const source of sourceFiles)
    await writeFile(
      new URL(source.path, output),
      await readFile(new URL(source.path, sources)),
    );
  binding = {
    ...binding,
    available: true,
    architecture: process.arch,
    executableSha256: sha256(await readFile(executable)),
    compiler: execFileSync("/usr/bin/xcrun", ["clang", "--version"], {
      encoding: "utf8",
    }).split("\n")[0],
  };
}
await writeFile(
  new URL("helper-binding.js", output),
  `export const helperBinding = ${JSON.stringify(binding)};\n`,
);
