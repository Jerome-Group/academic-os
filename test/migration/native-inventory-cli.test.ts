import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import type { NativeInventory } from "../../src/migration/native-inventory/index.js";
import { validateNativeInventory } from "../../src/migration/native-inventory/schema.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const run = promisify(execFile);
async function fixture() {
  const proof = await mkdtemp(join(await realpath(tmpdir()), "aos-native-"));
  await chmod(proof, 0o700);
  const root = join(proof, "source");
  await mkdir(root);
  return { proof, root };
}
async function inventory(
  root: string,
  extra: string[] = [],
  command = cli,
): Promise<{ report: NativeInventory; exit: number }> {
  let stdout: string;
  let exit = 0;
  try {
    stdout = (
      await run(
        process.execPath,
        [command, "migration", "inventory", "--root", root, "--json", ...extra],
        { maxBuffer: 32 * 1024 * 1024 },
      )
    ).stdout;
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "stdout" in error &&
        typeof error.stdout === "string" &&
        "code" in error &&
        typeof error.code === "number"
      )
    )
      throw error;
    stdout = error.stdout;
    exit = error.code;
  }
  const value: unknown = JSON.parse(stdout);
  assert(
    validateNativeInventory(value),
    JSON.stringify(validateNativeInventory.errors),
  );
  return { report: value as NativeInventory, exit };
}
const hex = (text: string) => Buffer.from(text).toString("hex");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("native CLI reports unsupported platforms explicitly", {
  skip: process.platform === "darwin",
}, async () => {
  const { root } = await fixture();
  const { report, exit } = await inventory(root);
  assert.equal(exit, 2);
  assert.equal(report.complete, false);
  assert(
    report.diagnostics.some((item) => item.code === "unsupported-platform"),
  );
});

test("native CLI includes all raw membership, bytes, link targets, ACL, xattrs and hardlinks without following links", {
  skip: process.platform !== "darwin",
}, async (context) => {
  const { proof, root } = await fixture();
  await mkdir(join(root, ".scratch"));
  const bytes = Buffer.from([0, 255, 13, 10]);
  const file = join(root, ".scratch", "payload.bin");
  await writeFile(file, bytes);
  await link(file, join(root, "hardlink"));
  await writeFile(join(root, "Icon\r"), "");
  await writeFile(join(root, ".DS_Store"), "fixture");
  await writeFile(join(root, "Unicode_é"), "native");
  await symlink(".scratch/payload.bin", join(root, "internal"));
  await symlink("absent", join(root, "dangling"));
  await symlink(Buffer.from([255, 254]), join(root, "raw-target"));
  const outside = join(proof, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "never-read"), "outside secret");
  await symlink(outside, join(root, "external"));
  const rawName = Buffer.concat([
    Buffer.from(`${root}/raw-`),
    Buffer.from([255, 254]),
  ]);
  let rawCreated = false;
  try {
    await writeFile(rawName, "raw");
    rawCreated = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EILSEQ"))
      throw error;
  }
  execFileSync("/usr/bin/xattr", ["-wx", "academic-os.test", "00ff0a", file]);
  execFileSync("/usr/bin/xattr", [
    "-wx",
    "com.apple.ResourceFork",
    "7265736f75726365",
    file,
  ]);
  execFileSync("/bin/chmod", ["+a", "everyone deny delete", file]);
  execFileSync("/usr/bin/chflags", ["hidden", file]);
  const before = await lstat(file, { bigint: true });
  const a = await inventory(root);
  const b = await inventory(root);
  assert.equal(a.exit, 0);
  assert.equal(a.report.complete, true);
  assert.equal(b.report.sourceFingerprint, a.report.sourceFingerprint);
  assert.deepEqual(
    b.report.entries.map((entry) => entry.pathHex),
    a.report.entries.map((entry) => entry.pathHex),
  );
  const entries = new Map(
    a.report.entries.map((entry) => [entry.pathHex, entry]),
  );
  assert(entries.has(""));
  assert(entries.has(hex("Icon\r")));
  assert(entries.has(hex(".DS_Store")));
  assert(entries.has(hex(".scratch")));
  if (!rawCreated)
    context.diagnostic(
      "Filesystem rejected a non-UTF8 filename with EILSEQ; raw target and portable raw membership remain exercised.",
    );
  if (rawCreated)
    assert(
      entries.has(
        Buffer.concat([Buffer.from("raw-"), Buffer.from([255, 254])]).toString(
          "hex",
        ),
      ),
    );
  assert.equal(entries.get(hex("raw-target"))?.linkTargetHex, "fffe");
  assert.equal(entries.get(hex("internal"))?.kind, "symlink");
  assert.equal(entries.get(hex("external"))?.linkTargetHex, hex(outside));
  assert(
    !a.report.entries.some((entry) =>
      Buffer.from(entry.pathHex, "hex").includes(Buffer.from("never-read")),
    ),
  );
  const observed = entries.get(hex(".scratch/payload.bin"));
  assert(observed);
  assert.equal(observed.dataSha256, sha(bytes));
  assert.equal(observed.before.birthtimeNs, before.birthtimeNs.toString());
  assert.equal(observed.before.mtimeNs, before.mtimeNs.toString());
  assert.equal(observed.before.mode, Number(before.mode));
  assert.notEqual(observed.before.flags, 0);
  assert.notEqual(observed.acl?.valueHex, "");
  assert.equal(
    observed.xattrs?.find((item) => item.nameHex === hex("academic-os.test"))
      ?.payload?.valueHex,
    "00ff0a",
  );
  assert.equal(
    observed.xattrs?.find(
      (item) => item.nameHex === hex("com.apple.ResourceFork"),
    )?.payload?.valueHex,
    "7265736f75726365",
  );
  assert.equal(
    observed.hardlinkGroup,
    entries.get(hex("hardlink"))?.hardlinkGroup,
  );
  assert.notEqual(observed.hardlinkGroup, null);
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(
    await readFile(join(outside, "never-read")),
    Buffer.from("outside secret"),
  );
});

test("native CLI never opens a FIFO and marks unobserved special metadata incomplete", {
  skip: process.platform !== "darwin",
  timeout: 10000,
}, async () => {
  const { root } = await fixture();
  execFileSync("/usr/bin/mkfifo", [join(root, "pipe")]);
  const { report, exit } = await inventory(root);
  assert.equal(exit, 2);
  assert.equal(report.outcome, "incomplete");
  const pipe = report.entries.find((entry) => entry.pathHex === hex("pipe"));
  assert.equal(pipe?.kind, "fifo");
  assert.equal(pipe?.dataSha256, null);
  assert.equal(pipe?.acl, null);
});

test("native CLI refuses source root aliases and external hardlink aliases", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  await writeFile(join(root, "file"), "x");
  const alias = join(proof, "alias");
  await symlink(root, alias);
  assert.equal((await inventory(alias)).report.outcome, "refused");
  assert.equal((await inventory(join(alias, "."))).report.outcome, "refused");
  await link(join(root, "file"), join(proof, "external-hardlink"));
  const result = await inventory(root);
  assert.equal(result.report.outcome, "refused");
  assert(
    result.report.diagnostics.some(
      (item) => item.code === "external-hardlink-alias",
    ),
  );
});

test("native CLI refuses changed source instead of returning a stale complete fingerprint", {
  skip: process.platform !== "darwin",
  timeout: 15000,
}, async () => {
  const { root } = await fixture();
  const path = join(root, "changing");
  const file = await open(path, "w");
  await file.truncate(128 * 1024 * 1024);
  await file.close();
  let time = 1000000;
  const pending: Promise<void>[] = [];
  const interval = setInterval(() => {
    time++;
    pending.push(utimes(path, time, time));
  }, 1);
  let result: Awaited<ReturnType<typeof inventory>>;
  try {
    result = await inventory(root);
  } finally {
    clearInterval(interval);
    await Promise.all(pending);
  }
  assert.equal(result.report.outcome, "refused");
  assert.equal(result.report.sourceFingerprint, null);
  assert(
    result.report.diagnostics.some((item) => item.code === "source-changed"),
  );
});

test("native CLI log is exclusive, private and outside source/repository", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  const log = join(proof, "inventory.json");
  const { report } = await inventory(root, ["--log", log]);
  assert.deepEqual(JSON.parse(await readFile(log, "utf8")), report);
  assert.equal((await lstat(log)).mode & 0o777, 0o600);
  for (const bad of [
    log,
    join(root, "inside.json"),
    resolve("unowned-inventory.json"),
  ])
    await assert.rejects(
      run(process.execPath, [
        cli,
        "migration",
        "inventory",
        "--root",
        root,
        "--log",
        bad,
        "--json",
      ]),
    );
  await assert.rejects(lstat(join(root, "inside.json")));
});

test("native CLI rejects changed bundled helper artifacts", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  const installation = join(proof, "installation");
  await mkdir(join(installation, "dist"), { recursive: true });
  await cp(
    fileURLToPath(new URL("../../src/", import.meta.url)),
    join(installation, "dist/src"),
    { recursive: true },
  );
  await writeFile(join(installation, "package.json"), '{"type":"module"}');
  await symlink(resolve("node_modules"), join(installation, "node_modules"));
  const copiedCli = join(installation, "dist/src/cli.js");
  const helper = join(
    installation,
    "dist/src/migration/native-inventory/native/scan.native",
  );
  const source = join(
    installation,
    "dist/src/migration/native-inventory/native/scan.c",
  );
  assert.equal((await inventory(root, [], copiedCli)).report.complete, true);
  const bytes = await readFile(helper);
  await writeFile(helper, Buffer.concat([bytes, Buffer.from("tampered")]));
  let result = await inventory(root, [], copiedCli);
  assert.equal(result.report.outcome, "refused");
  assert(
    result.report.diagnostics.some(
      (item) => item.code === "invalid-adapter-binding",
    ),
  );
  await writeFile(helper, bytes);
  await writeFile(source, "changed source");
  result = await inventory(root, [], copiedCli);
  assert.equal(result.report.outcome, "refused");
  assert(
    result.report.diagnostics.some(
      (item) => item.code === "invalid-adapter-binding",
    ),
  );
});

test("native CLI reports an oversized resource fork as unavailable", {
  skip: process.platform !== "darwin",
}, async () => {
  const { root } = await fixture();
  const file = join(root, "large-fork");
  await writeFile(file, "data");
  const fork = await open(`${file}/..namedfork/rsrc`, "w");
  await fork.truncate(33 * 1024 * 1024);
  await fork.close();
  const { report, exit } = await inventory(root);
  assert.equal(exit, 2);
  assert.equal(report.complete, false);
  assert.equal(report.sourceFingerprint, null);
  const observed = report.entries.find(
    (entry) => entry.pathHex === hex("large-fork"),
  );
  assert.equal(
    observed?.xattrs?.find(
      (item) => item.nameHex === hex("com.apple.ResourceFork"),
    )?.payload,
    null,
  );
  assert(report.diagnostics.some((item) => item.code === "xattrs-unreadable"));
});
