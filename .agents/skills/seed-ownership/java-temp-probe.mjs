import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  repositoryFixtureRoot,
  repositorySandboxArguments,
} from "../../../src/routine/repository-repair-process.ts";
import { preparePinnedTlc, tlcJavaEnvironment } from "./tlc-toolchain.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const evidence = await repositoryFixtureRoot(
  root,
  await mkdtemp(join(dirname(root), "fixture-java-temp-")),
);
const outside = await realpath(
  await mkdtemp(join(tmpdir(), "seed-java-outside-")),
);
const java = process.env.JAVA ?? "java";
const results = { evidence, outside, outcome: "running", runs: [], pids: [] };
process.stdout.write(`Evidence ${evidence}\n`);

try {
  const tlc = await preparePinnedTlc({
    evidence,
    overrideJar: process.env.TLA2TOOLS_JAR,
  });
  results.toolchain = tlc;
  const jar = tlc.jar;
  const version = await sandbox("java-version", [
    java,
    `-Djava.io.tmpdir=${evidence}`,
    "-version",
  ]);
  assert.equal(version.code, 0);
  assert.match(version.output, /version "21\./u, "Java 21 required");
  const help = await sandbox("tlc-version", [
    java,
    `-Djava.io.tmpdir=${evidence}`,
    "-cp",
    jar,
    "tlc2.TLC",
    "-help",
  ]);
  assert.equal(help.code, 1, "pinned TLC help exit");
  assert.ok(
    help.output.split(/\r?\n/u).includes(tlc.identity.helpBanner),
    "pinned TLC version banner",
  );
  await copyFile(
    join(directory, "JavaBoundaryProbe.java"),
    join(evidence, "JavaBoundaryProbe.java"),
  );
  const boundary = await sandbox("java-boundary", [
    java,
    `-Djava.io.tmpdir=${evidence}`,
    join(evidence, "JavaBoundaryProbe.java"),
    evidence,
    outside,
  ]);
  assert.equal(boundary.code, 0, "native Java boundary controls");
  for (const marker of [
    "OWNED_WRITE_PASSED",
    "OUTSIDE_WRITE_EPERM",
    "LISTENER_EPERM",
    "OUTBOUND_EPERM 1.1.1.1",
    "OUTBOUND_EPERM 192.0.2.1",
    "BOUNDARY_CONTROLS_PASSED",
  ])
    assert.ok(boundary.output.includes(marker), marker);
  assert.equal(await readFile(join(evidence, "owned-write"), "utf8"), "owned");
  results.boundaryControls = "passed";
  await writeFile(
    join(evidence, "JavaTemp.tla"),
    "---- MODULE JavaTemp ----\nEXTENDS Integers\nVARIABLE value\nInit == value = 0\nNext == value' = 1\nRange == value \\in {0, 1}\n====\n",
  );
  await writeFile(
    join(evidence, "JavaTemp.cfg"),
    "INIT Init\nNEXT Next\nINVARIANT Range\n",
  );
  for (const [name, temporary] of [
    ["environment-only", undefined],
    ["owned-temp", evidence],
    ["outside-temp", outside],
  ]) {
    const run = await sandbox(name, [
      java,
      ...(temporary === undefined ? [] : [`-Djava.io.tmpdir=${temporary}`]),
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
      join(evidence, "JavaTemp.cfg"),
      join(evidence, "JavaTemp.tla"),
    ]);
    if (name === "owned-temp") {
      results.ownedIntegers = ownedIntegers(run.output, evidence);
      assert.equal(run.code, 0, "owned Java temp must run native TLC");
      assert.ok(run.output.split(/\r?\n/u).includes(tlc.identity.banner));
      assert.match(
        run.output,
        /^Model checking completed\. No error has been found\.$/mu,
      );
      assert.match(
        run.output,
        /^\d+ states generated, 2 distinct states found, 0 states left on queue\.$/mu,
      );
      results.modelChecking = "passed";
    } else {
      assert.equal(
        run.code,
        150,
        `${name} must refuse standard-module extraction`,
      );
      assert.match(
        run.output,
        /^java\.nio\.file\.FileSystemException: .+\/tlc-\d+: Operation not permitted$/mu,
      );
      assert.ok(
        run.output.includes(`${temporary ?? tmpdir()}/tlc-`),
        `${name} refuses extraction into the selected unowned temp`,
      );
      assert.match(
        run.output,
        /^Error: Parsing or semantic analysis failed\.$/mu,
      );
      assert.doesNotMatch(run.output, /^Model checking completed\./mu);
    }
  }
  assert.deepEqual(await readdir(outside), [], "outside temp stays empty");
  const runner = await sandbox("runner", [
    process.execPath,
    join(root, ".agents/skills/seed-ownership/run.mjs"),
    "--model-only",
  ]);
  const runnerEvidence = runner.output.match(/^Evidence (.+)$/mu)?.[1];
  assert.ok(runnerEvidence, "runner evidence path required");
  results.runnerEvidence = runnerEvidence;
  const formal = JSON.parse(
    await readFile(join(runnerEvidence, "results.json"), "utf8"),
  );
  const logs =
    formal.models.length > 0
      ? formal.models.map((model) => model.log)
      : [join(runnerEvidence, "absent.log")];
  for (const path of logs) {
    const log = await readFile(path, "utf8");
    results.pids.push(
      ...[...log.matchAll(/\[pid: (\d+)\]/gu)].map((m) => +m[1]),
    );
  }
  const firstLog = await readFile(join(runnerEvidence, "absent.log"), "utf8");
  results.runnerIntegers = ownedIntegers(firstLog, runnerEvidence);
  assert.doesNotMatch(firstLog, /Cannot find source file for module/u);
  results.runnerTemp = "passed";
  assert.equal(runner.code, 0, "formal runner must complete in its owned temp");
  assert.equal(formal.outcome, "model-only");
  assert.equal(formal.models.length, 19, "every pinned model outcome required");
  assert.deepEqual(formal.toolchain.identity, tlc.identity);
  assert.equal(
    formal.models.filter(({ outcome }) => outcome === "passed").length,
    6,
  );
  assert.equal(
    formal.models.filter(({ outcome }) => outcome === "expected-counterexample")
      .length,
    13,
  );
  results.runnerOutcome = "model-only";
  results.outcome = "passed";
} catch (error) {
  results.outcome = "failed";
  results.error = error.stack;
  process.exitCode = 1;
} finally {
  results.pids = [...new Set(results.pids)];
  results.survivingPids = results.pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  });
  if (results.survivingPids.length > 0) {
    results.outcome = "failed";
    process.exitCode = 1;
  }
  await writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  process.stdout.write(`${results.outcome}\n`);
}

function ownedIntegers(output, parent) {
  const extracted = output.match(
    /^Parsing file (.+\/Integers\.tla) \(jar:file:.+!\/tla2sany\/StandardModules\/Integers\.tla\)$/mu,
  )?.[1];
  assert.ok(extracted, "native standard-module extraction path required");
  assert.match(
    relative(parent, extracted),
    /^tlc-\d+\/Integers\.tla$/u,
    "standard module must be parsed inside owned Java temp",
  );
  return extracted;
}

async function sandbox(name, command) {
  const args = repositorySandboxArguments(root, command, evidence);
  const run = spawnSync(process.env.CODEX ?? "codex", args, {
    cwd: root,
    env: {
      ...tlcJavaEnvironment(evidence),
      ...(process.env.TLA2TOOLS_JAR === undefined
        ? {}
        : { TLA2TOOLS_JAR: process.env.TLA2TOOLS_JAR }),
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
    detached: true,
    killSignal: "SIGKILL",
  });
  if (run.pid) {
    results.pids.push(run.pid);
    try {
      process.kill(-run.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  results.pids.push(
    ...[...output.matchAll(/\[pid: (\d+)\]/gu)].map((m) => +m[1]),
  );
  const log = join(evidence, `${name}.log`);
  const result = { name, args, code: run.status, signal: run.signal, log };
  results.runs.push(result);
  await writeFile(log, output);
  if (run.error)
    await writeFile(join(evidence, `${name}-error.log`), run.error.stack);
  return { ...result, output };
}
