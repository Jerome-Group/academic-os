import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

const [productPath, destinationPath, mode] = process.argv.slice(2);
assert.ok(
  productPath && destinationPath,
  "product and evidence destination required",
);
assert.ok(
  mode === undefined || mode === "broken",
  "only the explicit broken mode is accepted",
);
const productRoot = resolve(productPath);
const destination = resolve(destinationPath);
const evidence = dirname(destination);
const name = basename(destination);
let result;
try {
  result = await (mode === "broken" ? negative() : positive());
} catch (error) {
  result = {
    outcome: "failed",
    error: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
} finally {
  await writeFile(
    join(destination, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function within(parentPath, candidate) {
  const path = relative(parentPath, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function positive() {
  await mkdir(destination);
  const run = await command(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "dist/test/cli/curation-register-ownership-cli.test.js",
    ],
    productRoot,
    name,
    evidence,
    false,
    { AOS_JOURNAL_EVIDENCE_ROOT: destination },
  );
  for (const line of ["# tests 9", "# pass 9", "# fail 0", "# skipped 0"])
    assert.ok(run.output.includes(`${line}\n`), `${name} requires ${line}`);
  const fixture = await curationPrefixFixture(destination);
  const readback = await readCurationPrefixReadback(productRoot, fixture);
  assert.equal(readback.firstReport.appended, 1);
  assert.equal(readback.secondReport.appended, 0);
  assert.match(
    readback.secondReport.refusals.join(" "),
    /another invocation owns/u,
  );
  assert.ok(
    readback.contents
      .trimEnd()
      .split("\n")
      .map(JSON.parse)
      .some(({ supersedes }) => supersedes === "legacy-id"),
  );
  const processes = await requireStoppedCurationProcesses(destination);
  return {
    outcome: "passed",
    tests: 9,
    fixtures: destination,
    processes,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function negative() {
  await mkdir(destination);
  const run = await command(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-name-pattern=two curation processes retain every append they report successful",
      "dist/test/cli/curation-register-ownership-cli.test.js",
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
    "broken curation owner must fail the CLI assertion",
  );
  assert.match(
    run.output,
    /the successful migration must survive the competing rederivation/u,
  );
  assert.match(run.output, /# fail 1\n/u);
  const fixture = await curationPrefixFixture(destination);
  const readback = await readCurationPrefixReadback(productRoot, fixture);
  for (const actor of ["owner", "contender"]) {
    const child = JSON.parse(
      await readFile(join(fixture, `${actor}.json`), "utf8"),
    );
    assert.equal(child.code, 0, "mutant curation CLI must actually succeed");
    assert.equal(JSON.parse(child.stdout).appended, 1);
  }
  assert.equal(readback.firstReport.appended, 1);
  assert.equal(readback.secondReport.appended, 1);
  const lines = readback.contents.trimEnd().split("\n").map(JSON.parse);
  assert.ok(lines.some(({ decision }) => decision === "rederived"));
  assert.ok(
    !lines.some(({ supersedes }) => supersedes === "legacy-id"),
    "mutant must discard the confirmed migration decision",
  );
  assert.deepEqual(
    readback.journals.map(({ events }) => events.map(({ type }) => type)),
    [
      ["intent", "result"],
      ["intent", "result"],
    ],
    "both lost-decision writers persisted successful run journals",
  );
  const finalDigests = [];
  for (const actor of ["owner", "contender"]) {
    const trace = (
      await readFile(join(fixture, `${actor}.trace.jsonl`), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    const rename = trace.findIndex(({ step }) => step === "renamed");
    assert.ok(rename > 0);
    const reads = trace.slice(0, rename).filter(({ step }) => step === "read");
    finalDigests.push(reads.at(-1).sha256);
  }
  assert.equal(
    finalDigests[0],
    finalDigests[1],
    "both final reads admitted the same stale prefix",
  );
  const processes = await requireStoppedCurationProcesses(destination);
  return {
    outcome: "expected-assertion-failure",
    successfulAppends: 2,
    retainedAppends: 1,
    finalDigests,
    fixture,
    processes,
    log: join(evidence, `${name}.log`),
    durationMs: run.durationMs,
  };
}

async function curationPrefixFixture(destination) {
  const names = (await readdir(destination)).filter((name) =>
    name.startsWith("journal-curation-concurrent-prefix-"),
  );
  assert.equal(names.length, 1, "one retained curation prefix schedule");
  return join(destination, names[0]);
}

async function readCurationPrefixReadback(productRoot, fixture) {
  const readback = JSON.parse(
    await readFile(join(fixture, "readback.json"), "utf8"),
  );
  const { writtenControlPaths } = await import(
    pathToFileURL(join(productRoot, "dist/src/conformance/control-paths.js"))
      .href
  );
  const config = JSON.parse(
    await readFile(join(fixture, "AA9999.json"), "utf8"),
  );
  const target = join(
    config.driveMount,
    config.semesters[config.activeSemester].root,
    "AA9999",
    writtenControlPaths.curationRegister,
  );
  assert.ok(
    within(fixture, target),
    "register readback stays in its synthetic fixture",
  );
  assert.equal(
    await readFile(target, "utf8"),
    readback.contents,
    "saved curation readback agrees with actual register bytes",
  );
  for (const journal of readback.journals) {
    const path = join(fixture, "State", "journals", journal.path);
    assert.ok(within(fixture, path));
    const actual = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      actual,
      journal.events,
      "saved curation journal readback agrees with actual JSONL bytes",
    );
  }
  return readback;
}

async function requireStoppedCurationProcesses(destination) {
  const pids = new Set();
  for (const name of await readdir(destination)) {
    const fixture = join(destination, name);
    for (const file of await readdir(fixture)) {
      if (!file.endsWith(".json")) continue;
      const value = JSON.parse(await readFile(join(fixture, file), "utf8"));
      for (const message of value.messages ?? [])
        if (message.kind === "started") pids.add(message.pid);
    }
  }
  assert.ok(pids.size > 0, "retain actual curation child PIDs");
  for (const pid of pids) {
    assert.throws(
      () => process.kill(pid, 0),
      { code: "ESRCH" },
      `owned curation child ${pid} must be absent`,
    );
  }
  return { observed: [...pids], live: 0 };
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
