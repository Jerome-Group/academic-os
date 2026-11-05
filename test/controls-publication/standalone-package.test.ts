import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";

it("packages a production loader with the same release inside a CommonJS installation", async (context) => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "publication-package-"),
  );
  await writeFile(join(root, "package.json"), '{"type":"commonjs"}\n');
  const output = join(root, "standalone");
  const built = spawnSync(
    process.execPath,
    ["scripts/build-control-publication-standalone.mjs", output],
    { encoding: "utf8", timeout: 30_000 },
  );
  await writeFile(join(root, "build.log"), built.stdout + built.stderr);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.deepEqual(
    await readFile(join(output, "release.json")),
    await readFile("dist/src/controls-publication/release.json"),
  );
  const loaded = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {loadPublicationNative} from ${JSON.stringify(pathToFileURL(join(output, "native/index.js")).href)}; process.stdout.write(JSON.stringify(loadPublicationNative().kind));`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  await writeFile(join(root, "loader.log"), loaded.stdout + loaded.stderr);
  assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
  assert.equal(
    JSON.parse(loaded.stdout),
    process.platform === "darwin" ? "ok" : "native-failure",
  );
  if (process.platform === "darwin")
    assert.deepEqual(
      await readFile(join(output, "native/publication-native.node")),
      await readFile(
        "dist/src/controls-publication/native/publication-native.node",
      ),
    );
  context.diagnostic(`Retained production package ${root}`);
});
