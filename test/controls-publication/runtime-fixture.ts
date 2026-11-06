import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function bindFixtureRuntime(
  root: string,
  moduleDirectory: string,
): Promise<void> {
  await copyFile("package-lock.json", join(root, "package-lock.json"));
  if (root === moduleDirectory) {
    for (const [source, target] of [
      ["scan.native", "inventory-scan.native"],
      ["scan.c", "inventory-scan.c"],
    ]) {
      assert.ok(source && target);
      await copyFile(
        join("dist/src/migration/native-inventory/native", source),
        join(root, "native", target),
      );
    }
  }
  const result = spawnSync(
    process.execPath,
    [
      "scripts/build-control-publication-integrity.mjs",
      resolve(root),
      resolve(moduleDirectory),
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  await writeFile(
    join(moduleDirectory, "runtime-binding-build.json"),
    JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        pid: result.pid,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    ),
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
