import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  repositoryFixtureRoot,
  repositorySandboxArguments,
} from "../../../src/routine/repository-repair-process.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidence = await repositoryFixtureRoot(
  root,
  await mkdtemp(join(dirname(root), "fixture-java-temp-")),
);
const outside = await realpath(
  await mkdtemp(join(tmpdir(), "seed-java-outside-")),
);
const java = process.env.JAVA ?? "java";
const jar = process.env.TLA2TOOLS_JAR;
const results = { evidence, outside, outcome: "running", runs: [], pids: [] };
process.stdout.write(`Evidence ${evidence}\n`);

try {
  assert.ok(jar, "TLA2TOOLS_JAR must name the pinned local TLC jar");
  assert.equal(
    createHash("sha256")
      .update(await readFile(jar))
      .digest("hex"),
    "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88",
    "TLC 1.7.4 jar checksum",
  );
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
      assert.ok(
        run.output.includes(`Parsing file ${join(evidence, "Integers.tla")}`),
        "owned-temp control must extract and parse Integers in its owned fixture",
      );
      if (
        run.code === 255 &&
        run.output.includes("java.rmi.server.ExportException")
      ) {
        assert.match(
          run.output,
          /java.net.SocketException: Operation not permitted/u,
        );
        results.modelChecking = "blocked-local-listener";
      } else {
        assert.equal(run.code, 0, "owned Java temp must run TLC");
        assert.match(
          run.output,
          /Model checking completed\. No error has been found\./u,
        );
        assert.match(run.output, /2 distinct states found/u);
        results.modelChecking = "passed";
      }
      assert.equal(
        results.modelChecking,
        "passed",
        "native TLC must complete inside the unchanged repository sandbox",
      );
    } else {
      assert.equal(
        run.code,
        150,
        `${name} must refuse standard-module extraction`,
      );
      assert.match(run.output, /Operation not permitted|Permission denied/u);
      assert.match(run.output, /Cannot find source file for module Integers/u);
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
  assert.ok(
    firstLog.includes(`Parsing file ${join(runnerEvidence, "Integers.tla")}`),
    "runner must extract and parse Integers inside its owned evidence",
  );
  assert.doesNotMatch(firstLog, /Cannot find source file for module/u);
  results.runnerTemp = "passed";
  if (results.modelChecking === "blocked-local-listener") {
    assert.equal(runner.code, 1);
    assert.equal(formal.outcome, "failed");
    assert.match(firstLog, /java.rmi.server.ExportException/u);
    results.outcome = "blocked";
    process.exitCode = 1;
  } else {
    assert.equal(
      runner.code,
      0,
      "formal runner must complete in its owned temp",
    );
    assert.equal(formal.outcome, "model-only");
    assert.equal(
      formal.models.length,
      19,
      "every pinned model outcome required",
    );
    results.outcome = "passed";
  }
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

async function sandbox(name, command) {
  const args = repositorySandboxArguments(root, command, evidence);
  const run = spawnSync(process.env.CODEX ?? "codex", args, {
    cwd: root,
    env: {
      ...process.env,
      TMPDIR: evidence,
      TMP: evidence,
      TEMP: evidence,
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
