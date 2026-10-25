import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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
const { values } = parseArgs({
  options: {
    "product-root": { type: "string" },
    "evidence-parent": { type: "string" },
    "candidate-revision": { type: "string" },
    "model-only": { type: "boolean", default: false },
  },
});
const root = resolve(values["product-root"] ?? skillRoot);
const modelOnly = values["model-only"];
const candidate = values["candidate-revision"];
assert.ok(
  candidate === undefined || !modelOnly,
  "candidate requires a full run",
);
const parent = values["evidence-parent"] ?? tmpdir();
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
const started = performance.now();
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
    const revision = candidate ?? coverage.syncRevision;
    assert.equal(
      typeof revision,
      "string",
      "draft verification has no checked product revision; complete source mapping and maintenance first",
    );
    assert.match(revision, /^[a-f0-9]{40}$/u, "full product commit required");
    if (candidate !== undefined) {
      assert.equal(
        candidate,
        results.sourceRevision,
        "candidate must be product HEAD",
      );
      results.candidateRevision = candidate;
    }
    results.sourceHashes = await sourceHashes(coverage.files);
    if (candidate === undefined) {
      assert.deepEqual(
        results.sourceHashes,
        coverage.sourceHashes,
        "covered source binding changed; follow skill maintenance before advancing coverage.json",
      );
    }
    const dirty = await command(
      "git",
      ["status", "--porcelain"],
      root,
      "covered-dirty",
      evidence,
    );
    assert.equal(
      dirty.output,
      "",
      "commit or isolate changes before checking an exact revision",
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
      durationMs: run.durationMs,
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
  for (const binding of ["same", "independent"])
    await model(
      `journal-owner-${binding}`,
      await readFile(
        join(verification, `journal-owner-${binding}.cfg`),
        "utf8",
      ),
      "JournalMutationOwnership.tla",
    );
  for (const [broken, invariant] of [
    ["bypass", "UniqueSequence"],
    ["early-release", "ExclusiveCallbacks"],
  ])
    await model(
      `broken-owner-${broken}`,
      `SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\nCONSTANTS Binding = "same" Broken = "${broken}"\nINVARIANT ${invariant}\n`,
      "JournalMutationOwnership.tla",
      invariant,
    );
  const curationInvariants = [
    "CurationAppendPreserved",
    "CurationNoStaleReplacement",
  ];
  for (const binding of ["same", "independent"])
    await model(
      `curation-${binding}`,
      `SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\nCONSTANTS Binding = "${binding}" Broken = "none"\n${curationInvariants.map((name) => `INVARIANT ${name}\n`).join("")}`,
      "CurationRegisterOwnership.tla",
    );
  for (const broken of ["bypass", "early-release"])
    for (const invariant of curationInvariants)
      await model(
        `broken-curation-${broken}-${invariant}`,
        `SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\nCONSTANTS Binding = "same" Broken = "${broken}"\nINVARIANT ${invariant}\n`,
        "CurationRegisterOwnership.tla",
        invariant,
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
    const prerequisites = await command(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        "--test-name-pattern=rejects coerced|resumes interrupted exact cleanup|inode exceeds numeric precision",
        "dist/test/mounted/seed-mounted-module.test.js",
        "dist/test/mounted/seed-mounted-research-project.test.js",
      ],
      root,
      "protocol-prerequisites",
      evidence,
    );
    assert.match(
      prerequisites.output,
      /# tests 4\n/u,
      "all four protocol prerequisite regressions ran",
    );
    results.protocolPrerequisites = {
      outcome: "passed",
      tests: 4,
      durationMs: prerequisites.durationMs,
      log: join(evidence, "protocol-prerequisites.log"),
    };
    results.journalOwnership = await ownershipProtocols(
      root,
      "journal-ownership",
    );
    results.repairOwnership = await repairOwnership(root, "repair-ownership");
    results.curationOwnership = await curationProbe(root, "curation-ownership");
    results.product = await schedules(root, "baseline");
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
      results.product.length === 34 &&
        results.product.every(({ outcome }) => outcome === "passed"),
      "compiled product schedules failed; inspect baseline/results.json",
    );
    const scratch = join(evidence, "mutation-source");
    await mkdir(scratch);
    for (const name of [
      "src",
      "test",
      "scripts",
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
    const mutation = await schedules(
      scratch,
      "mutation",
      "cleanup-foreign-child",
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
    results.restored = await schedules(
      scratch,
      "restored",
      "cleanup-foreign-child",
    );
    assert.equal(results.restored.length, 2);
    assert.ok(
      results.restored.every(({ outcome }) => outcome === "passed"),
      "restored product must preserve both sentinels",
    );
    const ownerTarget = join(scratch, "src/journal-mutation-owner.ts");
    const originalOwner = await readFile(ownerTarget, "utf8");
    await writeFile(
      join(evidence, "original-journal-mutation-owner.ts"),
      originalOwner,
    );
    results.ownerMutations = [];
    results.ownerRestored = [];
    for (const mutation of ["bypass", "early-release"]) {
      let changed;
      if (mutation === "bypass") {
        const start = originalOwner.indexOf("  let database: DatabaseSync;");
        const end = originalOwner.indexOf(
          "\nasync function requireCanonicalAncestry(",
          start,
        );
        assert.ok(
          start >= 0 && end > start,
          "review owner bypass after a function move",
        );
        changed =
          originalOwner.slice(0, start) +
          '  return { kind: "owned", value: await run(resolve(input.journalPath)) };\n}\n' +
          originalOwner.slice(end);
      } else {
        const old =
          '    return { kind: "owned", value: await run(journalPath) };\n  } finally {\n    try {\n      database.exec("ROLLBACK");\n    } finally {\n      database.close();\n    }\n  }';
        const replacement =
          '    database.exec("ROLLBACK");\n    database.close();\n    return { kind: "owned", value: await run(journalPath) };\n  } finally {\n  }';
        assert.equal(
          originalOwner.split(old).length,
          2,
          "one exact callback lifetime guard",
        );
        changed = originalOwner.replace(old, replacement);
      }
      await writeFile(ownerTarget, changed);
      await command(
        "git",
        [
          "diff",
          "--no-index",
          "--",
          join(evidence, "original-journal-mutation-owner.ts"),
          ownerTarget,
        ],
        root,
        `owner-${mutation}-diff`,
        evidence,
        true,
      );
      await command(
        "npm",
        ["run", "build"],
        scratch,
        `owner-${mutation}-build`,
        evidence,
      );
      const cases = await ownershipMutation(scratch, mutation);
      const repair = await repairOwnership(scratch, `repair-${mutation}`, true);
      const curation = await curationProbe(
        scratch,
        `curation-${mutation}`,
        true,
      );
      results.ownerMutations.push({ mutation, cases, repair, curation });
      await save();
      await writeFile(ownerTarget, originalOwner);
      await command(
        "npm",
        ["run", "build"],
        scratch,
        `owner-${mutation}-restored-build`,
        evidence,
      );
      const restored = await ownershipProtocols(
        scratch,
        `owner-${mutation}-restored`,
        mutation === "bypass"
          ? "owns continuation through read"
          : "owns continuation through (cleanup|outcome-sync)",
        mutation === "bypass" ? 2 : 4,
      );
      const restoredRepair = await repairOwnership(
        scratch,
        `repair-${mutation}-restored`,
      );
      const restoredCuration = await curationProbe(
        scratch,
        `curation-${mutation}-restored`,
      );
      results.ownerRestored.push({
        mutation,
        cases: restored,
        repair: restoredRepair,
        curation: restoredCuration,
      });
      await save();
    }
    await command(
      "git",
      ["diff", "--exit-code", "HEAD", "--", ...coverage.files],
      root,
      "final-covered-clean",
      evidence,
    );
    results.finalSourceRevision = (
      await command("git", ["rev-parse", "HEAD"], root, "final-head", evidence)
    ).output.trim();
    assert.equal(
      results.finalSourceRevision,
      results.sourceRevision,
      "product HEAD changed during mutation controls",
    );
    results.finalSourceHashes = await sourceHashes(coverage.files);
    assert.deepEqual(
      results.finalSourceHashes,
      results.sourceHashes,
      "covered source changed during verification",
    );
    assert.equal(
      (
        await command(
          "git",
          ["status", "--porcelain"],
          root,
          "final-product-clean",
          evidence,
        )
      ).output,
      "",
      "product changed during verification",
    );
    results.outcome = "passed";
  }
} catch (error) {
  results.outcome = "failed";
  results.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  results.durationMs = Math.round(performance.now() - started);
  await save();
  process.stdout.write(
    `${results.outcome} ${join(evidence, "results.json")}\n`,
  );
}

function within(parentPath, candidate) {
  const path = relative(parentPath, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}
function save() {
  return writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

async function sourceHashes(files) {
  assert.ok(Array.isArray(files) && files.length > 0, "covered files required");
  assert.ok(files.every((path) => typeof path === "string"));
  assert.equal(new Set(files).size, files.length, "covered files are unique");
  return Object.fromEntries(
    await Promise.all(
      files.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(join(root, path)))
          .digest("hex"),
      ]),
    ),
  );
}

async function schedules(productRoot, name, selected) {
  const destination = join(evidence, name);
  const run = await command(
    process.execPath,
    [
      join(verification, "probes.mjs"),
      productRoot,
      destination,
      ...(selected === undefined ? [] : [selected]),
    ],
    productRoot,
    `${name}-schedules`,
    evidence,
    true,
  );
  const cases = JSON.parse(
    await readFile(join(destination, "results.json"), "utf8"),
  );
  assert.equal(
    run.code,
    cases.some(({ outcome }) => outcome !== "passed") ? 1 : 0,
    `${name} schedule process must finish normally`,
  );
  return cases;
}

async function ownershipProtocols(productRoot, name, pattern, count = 33) {
  const destination = join(evidence, name);
  await mkdir(destination);
  const run = await command(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
      ...(pattern ? [] : ["dist/test/mounted/journal-mutation-owner.test.js"]),
      "dist/test/cli/journal-ownership-cli.test.js",
      ...(pattern ? [] : ["dist/test/repair/repair-journal-ownership.test.js"]),
    ],
    productRoot,
    name,
    evidence,
    false,
    { AOS_JOURNAL_EVIDENCE_ROOT: destination },
  );
  assert.match(run.output, new RegExp(`# tests ${count}\\n`, "u"));
  assert.match(run.output, new RegExp(`# pass ${count}\\n`, "u"));
  assert.match(run.output, /# fail 0\n/u);
  return {
    outcome: "passed",
    tests: count,
    fixtures: destination,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function ownershipMutation(productRoot, mutation) {
  const points = mutation === "bypass" ? ["read"] : ["cleanup", "outcome-sync"];
  const name = `owner-${mutation}`;
  const destination = join(evidence, name);
  await mkdir(destination);
  const run = await command(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      `--test-name-pattern=owns continuation through (${points.join("|")})`,
      "dist/test/cli/journal-ownership-cli.test.js",
    ],
    productRoot,
    name,
    evidence,
    true,
    { AOS_JOURNAL_EVIDENCE_ROOT: destination },
  );
  assert.equal(
    run.code,
    1,
    "broken owner must fail an actual compiled assertion",
  );
  assert.match(run.output, /ERR_ASSERTION/u);
  assert.match(run.output, new RegExp(`# fail ${points.length * 2}\\n`, "u"));
  const directories = await readdir(destination);
  const cases = [];
  for (const adapter of ["module", "research"])
    for (const point of points) {
      const matches = directories.filter((entry) =>
        entry.startsWith(`journal-${adapter}-${point}-`),
      );
      assert.equal(matches.length, 1, "one retained mutant process fixture");
      const fixture = join(destination, matches[0]);
      const loser = JSON.parse(
        await readFile(join(fixture, "loser.json"), "utf8"),
      );
      assert.equal(loser.code, 0, "mutation must admit the competing CLI");
      assert.equal(
        JSON.parse(loser.stdout).outcome,
        "completed",
        "competing CLI actually completes instead of refusing",
      );
      const trace = await readFile(join(fixture, "loser.trace"), "utf8");
      assert.match(
        trace,
        /journal-read/u,
        "mutant contender reaches continuation read",
      );
      cases.push({
        adapter,
        point,
        outcome: "expected-assertion-failure",
        loserExit: loser.code,
        loserOutcome: "completed",
        fixture,
      });
    }
  return {
    outcome: "expected-assertion-failure",
    cases,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function repairOwnership(productRoot, name, broken = false) {
  const destination = join(evidence, name);
  const run = await command(
    process.execPath,
    [join(verification, "repair-owner-probe.mjs"), productRoot, destination],
    productRoot,
    name,
    evidence,
    true,
  );
  const result = JSON.parse(
    await readFile(join(destination, "results.json"), "utf8"),
  );
  assert.equal(run.code, broken ? 1 : 0);
  assert.equal(result.outcome, broken ? "failed" : "passed");
  if (broken) {
    assert.match(result.error, /competing repair performed provider effects/u);
    assert.ok(
      result.loserCalls.includes("create-admin"),
      "broken owner repeats a fake provider operation",
    );
    assert.equal(
      result.calls.filter((call) => call === "create-admin").length,
      2,
    );
  }
  return {
    outcome: broken ? "expected-assertion-failure" : "passed",
    loserProviderCalls: result.loserCalls.length,
    createAdminCalls: result.calls.filter((call) => call === "create-admin")
      .length,
    fixture: destination,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function curationProbe(productRoot, name, broken = false) {
  const destination = join(evidence, `owner-${name}`);
  const run = await command(
    process.execPath,
    [
      join(verification, "curation-owner-probe.mjs"),
      productRoot,
      destination,
      ...(broken ? ["broken"] : []),
    ],
    productRoot,
    name,
    evidence,
  );
  const result = JSON.parse(
    await readFile(join(destination, "results.json"), "utf8"),
  );
  assert.equal(
    result.outcome,
    broken ? "expected-assertion-failure" : "passed",
  );
  return {
    ...result,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function command(
  program,
  args,
  cwd,
  name,
  logs = cwd,
  permitFailure = false,
  environment = {},
) {
  const started = performance.now();
  const result = await new Promise((done, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, ...environment },
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
    child.on("close", (code, signal) =>
      done({
        code,
        signal,
        output,
        durationMs: Math.round(performance.now() - started),
      }),
    );
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
