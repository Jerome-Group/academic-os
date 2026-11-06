import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stop, version as esbuildVersion } from "esbuild";
import {
  preparePinnedTlc,
  tlcJavaEnvironment,
} from "../seed-ownership/tlc-toolchain.mjs";
import { alive, hash } from "./fixture.mjs";
import { nativeModels } from "./native-models.mjs";
import { nativeMutations } from "./native-runtime.mjs";
import {
  barrierRetries,
  bootstrap,
  mutations,
  orphanBoundaries,
  runtime,
  streamAndLifetime,
} from "./runtime.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    "product-root": { type: "string" },
    "evidence-parent": { type: "string" },
    "candidate-revision": { type: "string" },
    "model-only": { type: "boolean", default: false },
  },
});
const root = resolve(values["product-root"] ?? resolve(directory, "../../.."));
const parent = await realpath(values["evidence-parent"] ?? tmpdir());
const evidenceRelative = relative(root, parent);
assert.ok(
  isAbsolute(parent) &&
    (isAbsolute(evidenceRelative) ||
      evidenceRelative === ".." ||
      evidenceRelative.startsWith(`..${sep}`)),
  "Evidence remains outside repository",
);
assert.ok(
  Number(process.versions.node.split(".")[0]) >= 24,
  "Node 24 or later required",
);
const evidence = await mkdtemp(join(parent, "control-publication-"));
await chmod(evidence, 0o700);
const result = {
  evidence,
  outcome: "running",
  product: {},
  models: [],
  commands: [],
  limitations: [
    "Bounded abstract model, not implementation equivalence or power-loss durability",
    "Native kernel/account/syscall guarantees remain runtime premises",
    "One representative file and intermediate directory; repeated files are runtime schedules",
    "Pending predecessor model chooses the permitted refusal; runtime exercises actual settlement",
    "One crash/restart and one physical replacement; no hostile/distributed writer theorem",
    "Synchronous native calls have no asynchronous worker to survive expiry; drain-before-release sensitivity uses a real delayed-cleanup mutant",
  ],
};
function command(executable, args, cwd, label, env = process.env) {
  const execution = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = join(evidence, `${label}.stdout`),
    stderr = join(evidence, `${label}.stderr`);
  const item = {
    executable,
    args,
    cwd,
    pid: execution.pid,
    status: execution.status,
    signal: execution.signal,
    error: execution.error?.message,
    stdout,
    stderr,
    aliveAfter: alive(execution.pid),
  };
  result.commands.push(item);
  return {
    ...item,
    output: execution.stdout + execution.stderr,
    persist: async () => {
      await writeFile(stdout, execution.stdout ?? "");
      await writeFile(stderr, execution.stderr ?? "");
    },
  };
}
async function checked(executable, args, cwd, label, env) {
  const value = command(executable, args, cwd, label, env);
  await value.persist();
  assert.equal(value.status, 0, value.output);
  return value;
}
process.stdout.write(`Evidence ${evidence}\n`);
try {
  const git = await checked("git", ["rev-parse", "HEAD"], root, "revision");
  const revision = git.output.trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const status = await checked(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    root,
    "working-tree",
  );
  assert.equal(
    status.output,
    "",
    "Verification requires a clean committed checkout",
  );
  const coverage = JSON.parse(
    await readFile(join(directory, "coverage.json"), "utf8"),
  );
  const sourceHashes = {};
  for (const file of Object.keys(coverage.sourceHashes))
    sourceHashes[file] = hash(await readFile(join(root, file)));
  if (values["candidate-revision"])
    assert.equal(
      revision,
      values["candidate-revision"],
      "Exact candidate HEAD",
    );
  else
    assert.deepEqual(
      sourceHashes,
      coverage.sourceHashes,
      "Covered product source drift requires formal maintenance",
    );
  const seed = JSON.parse(
    await readFile(
      join(root, ".agents/skills/seed-ownership/coverage.json"),
      "utf8",
    ),
  );
  const seedHashes = {};
  for (const file of seed.files)
    seedHashes[file] = hash(await readFile(join(root, file)));
  assert.deepEqual(
    seedHashes,
    seed.sourceHashes,
    "Preserved seed source binding",
  );
  result.product = {
    revision,
    syncRevision: coverage.syncRevision,
    sourceHashes,
    seed: {
      files: seed.files.length,
      syncRevision: seed.syncRevision,
      sourceHashes: seedHashes,
      outcome: "unchanged-applicability-only-not-publisher-proof",
    },
  };
  const verificationFiles = [
    "ControlPublication.tla",
    "normal.cfg",
    "run.mjs",
    "runtime.mjs",
    "fixture.mjs",
    "SKILL.md",
    "coverage.json",
    "coverage.md",
    "MixedAdmission.tla",
    "NativeSelectorMove.tla",
    "native-models.mjs",
    "native-runtime.mjs",
    "native-fixture.mjs",
    "native-capacity.mjs",
    "native-package.mjs",
    "code-model-map.json",
  ];
  result.verificationHashes = {};
  for (const file of verificationFiles)
    result.verificationHashes[file] = hash(
      await readFile(join(directory, file)),
    );
  const tool = await preparePinnedTlc({
    evidence,
    overrideJar: process.env.TLA2TOOLS_JAR,
  });
  result.tool = tool;
  const java = process.env.JAVA ?? "/opt/homebrew/opt/openjdk@21/bin/java";
  const environment = tlcJavaEnvironment(process.env.TMPDIR ?? tmpdir());
  const javaVersion = await checked(
    java,
    ["-version"],
    evidence,
    "java-version",
    environment,
  );
  assert.match(javaVersion.output, /version "21\./);
  const properties =
    "OneOwner SelectedComplete SuccessAfterReadback PredecessorSettled ExpectedHead SameOldHead OutstandingOwned NoUnclaimedUse OrphanRetention";
  for (const [name, alias, broken, invariants, expectedFailure] of [
    [
      "all-source-properties",
      false,
      "none",
      `${properties} ParentBarrierBeforeUse`,
      null,
    ],
    ["remaining-safety", false, "none", properties, null],
    ["alias-conflicting-aggregate", true, "none", properties, null],
    ["broken-namespace", true, "namespace", "OneOwner", "OneOwner"],
    [
      "broken-complete",
      false,
      "complete",
      "SelectedComplete",
      "SelectedComplete",
    ],
    [
      "broken-predecessor",
      true,
      "predecessor",
      "PredecessorSettled",
      "PredecessorSettled",
    ],
    [
      "broken-expected-head",
      true,
      "expected",
      "ExpectedHead SameOldHead",
      "ExpectedHead",
    ],
    [
      "broken-parent-barrier",
      false,
      "parent-barrier",
      "ParentBarrierBeforeUse",
      "ParentBarrierBeforeUse",
    ],
    [
      "broken-unclaimed-adoption",
      false,
      "orphan",
      "NoUnclaimedUse",
      "NoUnclaimedUse",
    ],
    ["broken-same-old-head", true, "expected", "SameOldHead", "SameOldHead"],
  ]) {
    const model = join(evidence, name);
    await mkdir(model, { mode: 0o700 });
    await cp(
      join(directory, "ControlPublication.tla"),
      join(model, "ControlPublication.tla"),
    );
    await writeFile(
      join(model, "model.cfg"),
      `SPECIFICATION Spec\nCONSTANTS Alias = ${alias ? "TRUE" : "FALSE"}\nBroken = "${broken}"\nINVARIANTS ${invariants}\nCHECK_DEADLOCK FALSE\n`,
    );
    const run = command(
      java,
      [
        "-XX:+UseParallelGC",
        `-Djava.io.tmpdir=${process.env.TMPDIR ?? tmpdir()}`,
        "-cp",
        tool.jar,
        "tlc2.TLC",
        "-workers",
        "1",
        "-config",
        "model.cfg",
        "-metadir",
        join(model, "states"),
        "ControlPublication.tla",
      ],
      model,
      name,
      environment,
    );
    await run.persist();
    if (name === "broken-same-old-head")
      assert.doesNotMatch(
        run.output,
        /<Crash\(/,
        "Fresh competing-call counterexample requires no crash",
      );
    if (expectedFailure) {
      assert.match(
        run.output,
        new RegExp(`Invariant ${expectedFailure} is violated`),
        run.output,
      );
      assert.notEqual(run.status, 0);
    } else {
      assert.equal(run.status, 0, run.output);
      assert.match(
        run.output,
        /Model checking completed\. No error has been found/,
      );
    }
    result.models.push({
      name,
      alias,
      broken,
      invariants: invariants.split(" "),
      expectedFailure,
      outcome: expectedFailure
        ? name === "all-source-properties"
          ? "bug"
          : "required-counterexample"
        : "passed",
      evidence: model,
      stdout: run.stdout,
      shortestTrace: run.output.match(/State \d+: <[^>]+>/g) ?? [],
      counts: run.output.match(
        /\d+ states generated, \d+ distinct states found[^\n]*/,
      )?.[0],
    });
  }
  result.nativeModels = await nativeModels({
    directory,
    evidence,
    java,
    tool,
    environment,
    command,
  });
  if (!values["model-only"]) {
    assert.equal(
      process.platform,
      "darwin",
      "Fixed-anchor native proof requires Darwin",
    );
    const clang = await checked(
      "xcrun",
      ["clang++", "--version"],
      root,
      "clang-version",
    );
    const header = resolve(
      dirname(await realpath(process.execPath)),
      "../include/node/node_api.h",
    );
    result.nativeToolchain = {
      node: process.version,
      executable: process.execPath,
      platform: process.platform,
      arch: process.arch,
      napi: 8,
      esbuildVersion,
      header,
      headerSha256: hash(await readFile(header)),
      packageLockSha256: hash(await readFile(join(root, "package-lock.json"))),
      clang: clang.stdout,
    };
    await checked("npm", ["run", "build"], root, "build");
    await checked(
      process.execPath,
      [
        "dist/src/cli.js",
        "capabilities",
        "health",
        "--json",
        "--log",
        join(evidence, "health.json"),
      ],
      root,
      "health",
    );
    const health = JSON.parse(
      await readFile(join(evidence, "health.json"), "utf8"),
    );
    for (const action of ["node", "npm"])
      assert.equal(
        health.tools.find((tool) => tool.action === action)?.outcome,
        "passed",
        `Required ${action} health`,
      );
    result.health = health;
    await checked(
      process.execPath,
      ["--test", "dist/test/controls-publication/capacity.test.js"],
      root,
      "numeric-event-limits",
    );
    await checked(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        ...[
          "bootstrap-request",
          "generated-pending-host",
          "native-policy",
          "native-policy-admission",
          "native-policy-boundary",
          "runtime-consistency",
          "policy-roots",
          "host-results",
          "packaged-policy",
        ].map((name) => `dist/test/controls-publication/${name}.test.js`),
      ],
      root,
      "native-public-contract",
    );
    await checked(
      process.execPath,
      [
        "--test",
        "--test-name-pattern=replays the original near",
        "dist/test/controls-publication/replay-capacity.test.js",
      ],
      root,
      "native-repeated-history",
    );
    result.nativeMutations = await nativeMutations(root, evidence);
    result.runtime = await runtime(root, evidence);
    result.bootstrap = await bootstrap(root, evidence);
    result.orphanBoundaries = await orphanBoundaries(root, evidence);
    result.barrierRetries = await barrierRetries(root, evidence);
    result.snapshotLifetime = await streamAndLifetime(root, evidence);
    result.mutations = await mutations(root, evidence);
    const journey = await checked(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runPublicationJourney} from './dist/test/controls-publication/journey.js';console.log(await runPublicationJourney(${JSON.stringify(process.env.TMPDIR ?? tmpdir())}));`,
      ],
      root,
      "public-cli-mcp-extracted",
    );
    const journeyEvidence = journey.output.trim().split("\n").at(-1);
    result.publicJourney = {
      evidence: journeyEvidence,
      result: JSON.parse(
        await readFile(join(journeyEvidence, "result.json"), "utf8"),
      ),
      processes: JSON.parse(
        await readFile(join(journeyEvidence, "processes.json"), "utf8"),
      ),
    };
    assert.equal(result.publicJourney.result.complete, true);
    assert.ok(
      result.publicJourney.processes.every((process) => !alive(process.pid)),
      "Public journey owned children ended",
    );
    assert.ok(
      result.runtime.schedules.every(
        (schedule) => schedule.outcome === "passed",
      ),
      "All mapped publication boundaries reached",
    );
    assert.ok(
      result.runtime.coverage.every((edge) =>
        result.runtime.schedules.some(
          (schedule) =>
            schedule.key === edge.key && schedule.outcome === "passed",
        ),
      ),
      "Every observed boundary has a passing interrupted/restored schedule",
    );
    const finalStatus = await checked(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      root,
      "final-working-tree",
    );
    assert.equal(
      finalStatus.output,
      "",
      "Verification checkout remained clean",
    );
    const finalRevision = await checked(
      "git",
      ["rev-parse", "HEAD"],
      root,
      "final-revision",
    );
    assert.equal(
      finalRevision.output.trim(),
      revision,
      "Verification HEAD remained unchanged",
    );
    for (const [file, expected] of Object.entries(result.verificationHashes))
      assert.equal(
        hash(await readFile(join(directory, file))),
        expected,
        `Verification file remained unchanged ${file}`,
      );
    result.outcome =
      result.models.some((model) => model.outcome === "bug") ||
      result.barrierRetries.some((check) => check.outcome === "bug")
        ? "bug"
        : "passed";
  } else result.outcome = "model-only";
} catch (error) {
  result.outcome = "failed";
  result.error = error.stack;
} finally {
  stop();
  result.teardown = {
    directPids: result.commands.map((command) => ({
      pid: command.pid,
      alive: alive(command.pid),
    })),
    listenerCreated: false,
    ordinarySqliteSidecarContentAccess: false,
    retainedAtOriginalPaths: true,
  };
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(
    `Outcome ${result.outcome}\nResult ${join(evidence, "results.json")}\n`,
  );
  if (result.outcome !== "passed") process.exitCode = 1;
}
