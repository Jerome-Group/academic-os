import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const artifact = join(directory, "vendor/tla2tools.jar");
const expectedHash =
  "d15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f";

test("default TLC is the exact offline standalone artifact", async () => {
  const bytes = await readFile(artifact);
  assert.equal(bytes.length, 4502259);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  const { preparePinnedTlc, tlcIdentity } = await import("./tlc-toolchain.mjs");
  const evidence = await mkdtemp(join(tmpdir(), "tlc-default-"));
  process.stdout.write(`Default evidence ${evidence}\n`);
  const prepared = await preparePinnedTlc({ evidence });
  assert.deepEqual(await readFile(prepared.jar), bytes);
  assert.deepEqual(prepared.identity, tlcIdentity);
  assert.equal(tlcIdentity.sha256, expectedHash);
  assert.equal(
    tlcIdentity.revision,
    "2ef2af8c767b76e5db5cba2878f027ac07aad36c",
  );
  assert.equal(
    tlcIdentity.banner,
    "TLC2 Version 2026.10.24.013619 (rev: 2ef2af8)",
  );
  assert.deepEqual(await readdir(dirname(prepared.jar)), ["tla2tools.jar"]);
  assert.equal((await stat(prepared.jar)).mode & 0o777, 0o400);
  assert.equal((await stat(dirname(prepared.jar))).mode & 0o777, 0o500);
});

test("exact override stages bytes without manifest neighbors", async () => {
  const { preparePinnedTlc, tlcJavaEnvironment } = await import(
    "./tlc-toolchain.mjs"
  );
  const evidence = await mkdtemp(join(tmpdir(), "tlc-neighbors-"));
  process.stdout.write(`Neighbor evidence ${evidence}\n`);
  const source = join(evidence, "override.jar");
  await writeFile(source, await readFile(artifact));
  const marker = "TlcNeighborMustNotLoad";
  const java = process.env.JAVA ?? "java";
  const javac = java === "java" ? "javac" : join(dirname(java), "javac");
  const jar = java === "java" ? "jar" : join(dirname(java), "jar");
  await writeFile(
    join(evidence, `${marker}.java`),
    `public class ${marker} { public static void main(String[] args) { System.out.println("NEIGHBOR_LOADED"); } }\n`,
  );
  const env = tlcJavaEnvironment(evidence, {
    ...process.env,
    CLASSPATH: evidence,
    TLA_LIBRARY: evidence,
    JAVA_TOOL_OPTIONS: "-javaagent:missing-agent.jar",
    JDK_JAVA_OPTIONS: "-agentlib:missing-agent",
    _JAVA_OPTIONS: "-agentpath:/missing-agent",
    LD_PRELOAD: "/missing-agent",
    DYLD_INSERT_LIBRARIES: "/missing-agent",
  });
  function command(program, args) {
    const run = spawnSync(program, args, {
      cwd: evidence,
      env,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `${program}: ${run.stdout}${run.stderr}`);
    return run;
  }
  command(javac, [
    `-J-Djava.io.tmpdir=${evidence}`,
    "-d",
    evidence,
    join(evidence, `${marker}.java`),
  ]);
  const linked = join(evidence, "linked.jar");
  await symlink(source, linked);
  const controls = [];
  for (const name of ["CommunityModules-deps.jar", "CommunityModules.jar"]) {
    const neighbor = join(evidence, name);
    command(jar, [
      `-J-Djava.io.tmpdir=${evidence}`,
      "--create",
      "--file",
      neighbor,
      "-C",
      evidence,
      `${marker}.class`,
    ]);
    const ambient = command(java, [
      `-Djava.io.tmpdir=${evidence}`,
      "-cp",
      source,
      marker,
    ]);
    assert.match(
      ambient.stdout,
      /NEIGHBOR_LOADED/u,
      `${name} control must load beside source`,
    );
    const prepared = await preparePinnedTlc({ evidence, overrideJar: linked });
    const isolated = spawnSync(
      java,
      [`-Djava.io.tmpdir=${evidence}`, "-cp", prepared.jar, marker],
      {
        cwd: evidence,
        env,
        encoding: "utf8",
      },
    );
    assert.equal(isolated.status, 1);
    assert.match(
      isolated.stderr,
      /ClassNotFoundException: TlcNeighborMustNotLoad/u,
    );
    assert.doesNotMatch(isolated.stdout, /NEIGHBOR_LOADED/u);
    assert.deepEqual(await readdir(dirname(prepared.jar)), ["tla2tools.jar"]);
    await writeFile(
      join(evidence, `${name}-source.log`),
      `${ambient.stdout}${ambient.stderr}`,
    );
    await writeFile(
      join(evidence, `${name}-staged.log`),
      `${isolated.stdout}${isolated.stderr}`,
    );
    controls.push({
      source,
      linked,
      neighbor,
      prepared,
      sourcePid: ambient.pid,
      stagedPid: isolated.pid,
      sourceCode: ambient.status,
      stagedCode: isolated.status,
    });
    await unlink(neighbor);
  }
  await writeFile(
    join(evidence, "results.json"),
    `${JSON.stringify({ java, controls }, null, 2)}\n`,
  );
});

test("changed bytes and the historical tool refuse admission", async () => {
  const { preparePinnedTlc } = await import("./tlc-toolchain.mjs");
  const evidence = await mkdtemp(join(tmpdir(), "tlc-refusal-"));
  process.stdout.write(`Refusal source ${evidence}\n`);
  const changed = Buffer.from(await readFile(artifact));
  changed[changed.length - 1] ^= 1;
  const source = join(evidence, "changed.jar");
  await writeFile(source, changed);
  await assert.rejects(
    preparePinnedTlc({ evidence, overrideJar: source }),
    /pinned TLC jar checksum/u,
  );
  assert.deepEqual(await readdir(evidence), ["changed.jar"]);
  const old = process.env.TLC_OLD_JAR;
  if (old !== undefined) {
    await assert.rejects(
      preparePinnedTlc({ evidence, overrideJar: old }),
      /pinned TLC jar (checksum|size)/u,
    );
    assert.deepEqual(await readdir(evidence), ["changed.jar"]);
  }
  for (const override of [source, ...(old === undefined ? [] : [old])]) {
    const run = spawnSync(
      process.execPath,
      [join(directory, "run.mjs"), "--model-only"],
      { env: { ...process.env, TLA2TOOLS_JAR: override }, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    const destination = run.stdout.match(/^Evidence (.+)$/mu)?.[1];
    assert.ok(destination, run.stderr);
    process.stdout.write(`Refusal evidence ${destination}\n`);
    const result = JSON.parse(
      await readFile(join(destination, "results.json"), "utf8"),
    );
    assert.equal(result.outcome, "failed");
    assert.match(result.error, /pinned TLC jar checksum/u);
    assert.deepEqual(result.models, []);
    assert.deepEqual(
      result.commands,
      [],
      "wrong tool refuses before any Java/model execution",
    );
  }
});

test("Java environment admits selected executable and no implicit injection", async () => {
  const { tlcJavaEnvironment } = await import("./tlc-toolchain.mjs");
  const hostile = {
    PATH: "/trusted/bin",
    HOME: "/owned/home",
    JAVA: "/trusted/bin/java",
    JAVA_HOME: "/trusted/jdk",
    CLASSPATH: "marker.jar",
    TLA_LIBRARY: "/marker",
    JAVA_TOOL_OPTIONS: "-javaagent:marker.jar",
    JDK_JAVA_OPTIONS: "-agentlib:marker",
    _JAVA_OPTIONS: "-agentpath:/marker",
    LD_PRELOAD: "/marker",
    LD_LIBRARY_PATH: "/marker",
    DYLD_INSERT_LIBRARIES: "/marker",
    DYLD_LIBRARY_PATH: "/marker",
    NODE_OPTIONS: "--import marker.mjs",
  };
  const env = tlcJavaEnvironment("/owned/temp", hostile);
  assert.equal(env.PATH, hostile.PATH);
  assert.equal(env.JAVA, hostile.JAVA);
  assert.equal(env.TMPDIR, "/owned/temp");
  for (const key of Object.keys(hostile).filter(
    (key) => !["PATH", "HOME", "JAVA", "JAVA_HOME"].includes(key),
  ))
    assert.equal(env[key], undefined, key);
});
