import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

const checked = process.argv.includes("--check");
const target = "skills/cheatsheet/scripts/cheatsheet-tool.mjs";
const temporary = checked
  ? await mkdtemp(join(tmpdir(), "cheatsheet-runtime-"))
  : undefined;
const output =
  temporary === undefined ? target : join(temporary, "runtime.mjs");

try {
  await build({
    entryPoints: ["src/cheatsheet/cli.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    legalComments: "inline",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  if (checked) {
    const [expected, actual] = await Promise.all([
      readFile(target),
      readFile(output),
    ]);
    if (!expected.equals(actual)) {
      throw new Error(
        "The installed cheatsheet runtime is stale; run npm run cheatsheet-runtime:build.",
      );
    }
  } else {
    await chmod(target, 0o755);
  }
} finally {
  if (temporary !== undefined) {
    await rm(temporary, { recursive: true, force: true });
  }
}
