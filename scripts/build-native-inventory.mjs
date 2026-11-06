import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL(
  "../src/migration/native-inventory/native/scan.c",
  import.meta.url,
);
const output = new URL(
  "../dist/src/migration/native-inventory/native/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const bytes = await readFile(source);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let binding = {
  platform: process.platform,
  sourceSha256: sha256(bytes),
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
    fileURLToPath(source),
    "-o",
    fileURLToPath(executable),
  ]);
  await writeFile(new URL("scan.c", output), bytes);
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
