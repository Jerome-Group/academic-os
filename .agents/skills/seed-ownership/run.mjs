import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSchedules } from "./probes.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(directory, "../../..");
const sha256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const url =
  "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar";
const invariants = [
  "ClaimBeforeStageEffect",
  "NoForeignDeletion",
  "NoEscapedWriteAtGuardedBoundary",
  "NoAdoptionFromPathOrBytes",
  "CompletionRequiresVerifiedPublicationAndCleanup",
];
const arguments_ = process.argv.slice(2);
const productIndex = arguments_.indexOf("--product-root");
const root =
  productIndex === -1 ? skillRoot : resolve(arguments_[productIndex + 1]);
const modelOnly = arguments_.includes("--model-only");
const parentIndex = arguments_.indexOf("--evidence-parent");
const parent = parentIndex === -1 ? tmpdir() : arguments_[parentIndex + 1];
assert.ok(
  parent && isAbsolute(parent),
  "evidence parent must be an existing absolute OS temporary path",
);
const canonicalParent = await realpath(parent);
const canonicalTemp = await realpath(tmpdir());
const unixTemp = await realpath("/tmp");
assert.ok(
  within(canonicalTemp, canonicalParent) || within(unixTemp, canonicalParent),
  "evidence stays in an OS temporary directory",
);
const evidence = await mkdtemp(join(canonicalParent, "seed-ownership-"));
const verification = join(evidence, "verification");
await cp(directory, verification, { recursive: true });
const results = {
  evidence,
  outcome: "running",
  models: [],
  product: [],
  mutation: undefined,
};
process.stdout.write(`Evidence ${evidence}\n`);

try {
  const java = process.env.JAVA ?? "java";
  const version = await command(java, ["-version"], evidence, "java-version");
  assert.match(version.output, /version "21\./u, "Java 21 required");
  let jar = process.env.TLA2TOOLS_JAR;
  if (jar === undefined) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, `TLC download failed, HTTP ${response.status}`);
    jar = join(evidence, "tla2tools-1.7.4.jar");
    await writeFile(jar, new Uint8Array(await response.arrayBuffer()));
  }
  jar = resolve(jar);
  assert.equal(
    createHash("sha256")
      .update(await readFile(jar))
      .digest("hex"),
    sha256,
    "TLC 1.7.4 jar checksum",
  );
  const help = await command(
    java,
    ["-cp", jar, "tlc2.TLC", "-help"],
    evidence,
    "tlc-version",
    evidence,
    true,
  );
  assert.match(
    help.output,
    /Version 2\.19 of 08 August 2024/u,
    "pinned TLC version banner",
  );
  const coverage = JSON.parse(
    await readFile(join(verification, "coverage.json"), "utf8"),
  );
  results.sourceRevision = (
    await command("git", ["rev-parse", "HEAD"], root, "head", evidence)
  ).output.trim();
  results.syncRevision = coverage.syncRevision;
  if (!modelOnly) {
    assert.equal(
      typeof coverage.syncRevision,
      "string",
      "draft verification has no checked product revision; complete source mapping and maintenance first",
    );
    const drift = await command(
      "git",
      ["diff", coverage.syncRevision, "--", ...coverage.files],
      root,
      "covered-diff",
      evidence,
    );
    assert.equal(
      drift.output,
      "",
      "covered source changed since sync revision; follow skill maintenance before advancing coverage.json",
    );
    const dirty = await command(
      "git",
      ["status", "--porcelain", "--", ...coverage.files],
      root,
      "covered-dirty",
      evidence,
    );
    assert.equal(
      dirty.output,
      "",
      "commit or isolate covered source before checking an exact revision",
    );
  }
  async function model(name, config, module, expected) {
    const path = join(evidence, `${name}.cfg`);
    await writeFile(path, config);
    const run = await command(
      java,
      [
        "-XX:+UseParallelGC",
        "-Xmx1g",
        "-cp",
        jar,
        "tlc2.TLC",
        "-workers",
        "1",
        "-metadir",
        join(evidence, `${name}-states`),
        "-config",
        path,
        module,
      ],
      verification,
      name,
      evidence,
      true,
    );
    if (expected === undefined) {
      assert.equal(run.code, 0, `${name} TLC execution failed`);
      assert.match(
        run.output,
        /Model checking completed\. No error has been found\./u,
      );
    } else {
      assert.equal(
        run.code,
        12,
        `${name} requires a TLC invariant counterexample`,
      );
      assert.ok(
        run.output.includes(`Invariant ${expected} is violated`),
        `${name} must fail the predicted invariant ${expected}`,
      );
    }
    const states = run.output.match(
      /([\d,]+) states generated, ([\d,]+) distinct states found/u,
    );
    results.models.push({
      name,
      outcome: expected ? "expected-counterexample" : "passed",
      expected,
      generated: states?.[1],
      distinct: states?.[2],
      log: join(evidence, `${name}.log`),
    });
    await save();
    process.stdout.write(
      `${name} ${expected ? "expected counterexample" : "passed"}\n`,
    );
  }
  const base = await readFile(join(verification, "absent.cfg"), "utf8");
  await model("absent", base, "SeedOwnership.tla");
  await model(
    "partial",
    await readFile(join(verification, "partial.cfg"), "utf8"),
    "SeedOwnership.tla",
  );
  for (const [broken, invariant] of [
    ["claim", invariants[0]],
    ["delete", invariants[1]],
    ["escape", invariants[2]],
    ["adopt", invariants[3]],
    ["complete", invariants[4]],
  ]) {
    const config = `SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\nCONSTANTS PartialTarget = FALSE Environment = "boundary" Broken = "${broken}" MaxFaults = 1\nINVARIANT ${invariant}\n`;
    await model(`broken-${broken}`, config, "SeedOwnership.tla", invariant);
  }
  await model(
    "syscall-swaps",
    `SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\nCONSTANTS PartialTarget = FALSE Environment = "syscall" Broken = "none" MaxFaults = 1\nINVARIANT ${invariants[2]}\n`,
    "SeedOwnership.tla",
    invariants[2],
  );
  await model(
    "concurrent-writers",
    await readFile(join(verification, "concurrent.cfg"), "utf8"),
    "ConcurrentSeedJournal.tla",
    "UniqueSequence",
  );
  if (modelOnly) results.outcome = "model-only";
  else {
    assert.equal(
      (
        await command(
          "git",
          ["rev-parse", "HEAD"],
          root,
          "pre-build-head",
          evidence,
        )
      ).output.trim(),
      results.sourceRevision,
      "product head changed during the model run",
    );
    await command("npm", ["run", "build"], root, "build", evidence);
    results.product = await runSchedules(root, join(evidence, "baseline"));
    await save();
    assert.equal(
      (
        await command(
          "git",
          ["rev-parse", "HEAD"],
          root,
          "post-probe-head",
          evidence,
        )
      ).output.trim(),
      results.sourceRevision,
      "product head changed during compiled schedules",
    );
    assert.ok(
      results.product.length > 0 &&
        results.product.every(({ outcome }) => outcome === "passed"),
      "compiled product schedules failed; inspect baseline/results.json",
    );
    const scratch = join(evidence, "mutation-source");
    await mkdir(scratch);
    for (const name of [
      "src",
      "test",
      "seed-templates",
      "skills",
      "package.json",
      "tsconfig.json",
    ])
      await cp(join(root, name), join(scratch, name), { recursive: true });
    await symlink(
      join(root, "node_modules"),
      join(scratch, "node_modules"),
      "dir",
    );
    const target = join(scratch, "src/mounted/seed-ownership.ts");
    const original = await readFile(target, "utf8");
    const beginning = "export async function removeOwnedSeedStage(\n";
    const following = "\nasync function verifyStage(";
    const start = original.indexOf(beginning);
    const end = original.indexOf(following, start);
    assert.ok(
      start >= 0 &&
        end > start &&
        original.indexOf(beginning, start + beginning.length) === -1,
      "one exact cleanup guard bounded by verifyStage; review mutation after a rename",
    );
    const replacement =
      'export async function removeOwnedSeedStage(journal: SeedJournal): Promise<string | undefined> { await (await import("node:fs/promises")).rm(seedStage(journal).root, { recursive: true, force: true }); return undefined; }\n';
    await writeFile(join(evidence, "original-seed-ownership.ts"), original);
    await writeFile(
      target,
      original.slice(0, start) + replacement + original.slice(end),
    );
    await command(
      "git",
      [
        "diff",
        "--no-index",
        "--",
        join(evidence, "original-seed-ownership.ts"),
        target,
      ],
      root,
      "mutation-diff",
      evidence,
      true,
    );
    await command("npm", ["run", "build"], scratch, "mutation-build", evidence);
    const mutation = await runSchedules(
      scratch,
      join(evidence, "mutation"),
      (id) => id.endsWith("/cleanup-foreign-child"),
    );
    results.mutation = mutation;
    await save();
    assert.equal(mutation.length, 2);
    assert.ok(
      mutation.every(
        ({ outcome, error }) =>
          outcome === "failed" &&
          error.includes("protected artifact manifest changed"),
      ),
      "real cleanup mutation must delete protected bytes, rather than fail compilation or throw an unrelated error",
    );
    await writeFile(target, original);
    await command("npm", ["run", "build"], scratch, "restored-build", evidence);
    results.restored = await runSchedules(
      scratch,
      join(evidence, "restored"),
      (id) => id.endsWith("/cleanup-foreign-child"),
    );
    assert.ok(
      results.restored.every(({ outcome }) => outcome === "passed"),
      "restored product must preserve both sentinels",
    );
    results.outcome = "passed";
  }
} catch (error) {
  results.outcome = "failed";
  results.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await save();
  process.stdout.write(
    `${results.outcome} ${join(evidence, "results.json")}\n`,
  );
}

function within(parentPath, candidate) {
  const path = relative(parentPath, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
function save() {
  return writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

async function command(
  program,
  args,
  cwd,
  name,
  logs = cwd,
  permitFailure = false,
) {
  const result = await new Promise((done, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => done({ code, signal, output }));
  });
  await writeFile(join(logs, `${name}.log`), result.output);
  if (!permitFailure)
    assert.equal(
      result.code,
      0,
      `${name} failed; inspect ${join(logs, `${name}.log`)}`,
    );
  return result;
}
