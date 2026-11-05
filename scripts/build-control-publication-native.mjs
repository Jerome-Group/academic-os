import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i],
    value = args[i + 1];
  if (
    !["--fixture-anchor", "--output", "--headers"].includes(key) ||
    value === undefined ||
    options.has(key)
  ) {
    throw new Error(
      "Expected --fixture-anchor, --output or --headers with an absolute path.",
    );
  }
  if (!isAbsolute(value)) throw new Error(`${key} requires an absolute path.`);
  options.set(key, value);
}
if (process.platform !== "darwin") {
  process.stdout.write(
    "Native publication unavailable on this platform. TypeScript checks remain supported.\n",
  );
  process.exit(0);
}
const fixture = options.get("--fixture-anchor");
if (fixture !== undefined) {
  const stat = lstatSync(fixture);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(fixture) !== fixture ||
    !options.has("--output")
  ) {
    throw new Error(
      "Fixture compilation requires a canonical owned 0700 directory and explicit --output.",
    );
  }
}
const headers =
  options.get("--headers") ??
  resolve(dirname(realpathSync(process.execPath)), "../include/node");
if (!lstatSync(join(headers, "node_api.h")).isFile())
  throw new Error("Stable Node N-API headers unavailable.");
const output =
  options.get("--output") ??
  join(root, "dist/src/controls-publication/native/publication-native.node");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const source = join(root, "src/controls-publication/native");
const flags = [
  "clang++",
  "-std=c++17",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-shared",
  "-undefined",
  "dynamic_lookup",
  "-DNAPI_VERSION=8",
  `-I${headers}`,
  "-framework",
  "CoreFoundation",
];
if (fixture !== undefined) {
  flags.push(`-DAOS_PUBLICATION_FIXTURE_ANCHOR=${JSON.stringify(fixture)}`);
  flags.push(
    `-DAOS_PUBLICATION_FIXTURE_SYNC_HOME=${JSON.stringify(join(dirname(fixture), "account"))}`,
  );
}
flags.push(
  ...["filesystem.cc", "exclusions.cc", "binding.cc"].map((name) =>
    join(source, name),
  ),
  "-o",
  output,
);
const result = spawnSync("xcrun", flags, {
  cwd: root,
  encoding: "utf8",
  timeout: 120000,
});
if (result.status !== 0)
  throw new Error(
    result.error?.message ?? result.stderr ?? "Native build failed.",
  );
process.stdout.write(`${output}\n`);
