import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readSourceMap } from "../conformance/source-map.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import { readSafeFile } from "../mounted/read-safe-file.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

export async function runLearningExerciseCommand(
  args: string[],
  json: boolean,
): Promise<void> {
  const usage =
    "Usage: academic-os learning exercise --root <module-root> --target <exercise-set block> [--json]";
  const { values } = parseArgumentTokens({
    arguments: args,
    command: "exercise",
    valueFlags: ["--root", "--target"],
    booleanFlags: ["--json"],
    usage,
  });
  const suppliedRoot = values.get("--root");
  const target = values.get("--target");
  if (!suppliedRoot || !target)
    throw new OperationalError("invalid-arguments", usage);
  const root = resolve(suppliedRoot);
  if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory())
    throw new OperationalError(
      "invalid-target",
      "Exercise selection requires an ordinary module root.",
    );
  const mapPath = ["00 Module Admin", "40 Source Map.yaml"];
  await ensureMaterialized(join(root, ...mapPath));
  const source = await readSafeFile(root, mapPath, "Source Map");
  const map = readSourceMap(source);
  if (map.kind !== "valid")
    throw new OperationalError("invalid-target", map.finding.evidence);
  const set = map.exerciseSets.find((entry) => entry.block === target);
  if (!set)
    throw new OperationalError(
      "missing-target",
      "No exact module-level exercise set matches the target.",
    );
  const sources = [];
  for (const entry of set.sources) {
    let path = root;
    const components = entry.file.split("/");
    for (const [index, component] of components.entries()) {
      path = join(path, component);
      const stat = await lstat(path);
      if (
        stat.isSymbolicLink() ||
        (index === components.length - 1
          ? !stat.isFile()
          : !stat.isDirectory()) ||
        (await realpath(path)) !== path
      )
        throw new OperationalError(
          "invalid-target",
          `Source is not an ordinary contained file: ${entry.file}.`,
        );
    }
    await ensureMaterialized(path);
    const before = await lstat(path);
    if (before.size === 0)
      throw new OperationalError(
        "invalid-target",
        `Source has no materialized bytes: ${entry.file}.`,
      );
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(path, { flags: "r" })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const after = await lstat(path);
    if (
      before.ino !== after.ino ||
      before.size !== bytes ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw new OperationalError(
        "invalid-target",
        `Source changed during selection: ${entry.file}.`,
      );
    sources.push({ ...entry, byteLength: bytes, sha256: hash.digest("hex") });
  }
  if ((await readSafeFile(root, mapPath, "Source Map")) !== source)
    throw new OperationalError(
      "invalid-target",
      "Source Map changed during selection.",
    );
  const report = {
    outcome: "selected",
    activity: "exercise",
    pattern: "tutorial",
    target: set.block,
    units: set.units,
    exercises: set.exercises,
    workspace: `70 Learning/20 Tutorials/${set.block}`,
    sourceMapSha256: createHash("sha256").update(source).digest("hex"),
    sources,
    writes: [],
  };
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${set.block}: tutorial pattern; units ${set.units.join(", ")}\n`,
  );
}
