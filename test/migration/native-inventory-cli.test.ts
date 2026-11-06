import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  realpath,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

test("native CLI refuses changing enumeration instead of a complete stale membership", {
  skip: process.platform !== "darwin",
  timeout: 15000,
}, async () => {
  const { root } = await fixture();
  const large = await open(join(root, "large"), "wx");
  await large.truncate(128 * 1024 * 1024);
  await large.close();
  const first = join(root, "member-a");
  const second = join(root, "member-b");
  await writeFile(first, "membership");
  let active = true;
  const changing = (async () => {
    while (active) {
      await rename(first, second);
      await rename(second, first);
    }
  })();
  let result: Awaited<ReturnType<typeof inventory>>;
  try {
    result = await inventory(root);
  } finally {
    active = false;
    await changing;
  }
  assert.equal(result.exit, 2);
  assert.equal(result.report.complete, false);
  assert.equal(result.report.sourceFingerprint, null);
  assert(
    result.report.diagnostics.some((entry) => entry.code === "source-changed"),
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
  for (const path of [
    source,
    join(dirname(source), "scan-core.c"),
    join(dirname(source), "scan-core.h"),
  ]) {
    const original = await readFile(path);
    await writeFile(path, "changed source");
    result = await inventory(root, [], copiedCli);
    assert.equal(result.report.outcome, "refused");
    assert(
      result.report.diagnostics.some(
        (item) => item.code === "invalid-adapter-binding",
      ),
    );
    await writeFile(path, original);
  }
  assert.equal((await inventory(root, [], copiedCli)).report.complete, true);
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

test("native CLI streams files above64MiB and retains signed dates and fragmented metadata", {
  skip: process.platform !== "darwin",
}, async () => {
  const { root } = await fixture();
  const path = join(root, "large");
  const length = 64 * 1024 * 1024 + 1;
  const file = await open(path, "wx");
  await file.truncate(length);
  await file.write(Buffer.from([7]), 0, 1, length - 1);
  await file.close();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const forkBytes = Buffer.alloc(65537, 0x31);
  const fork = await open(`${path}/..namedfork/rsrc`, "w");
  await fork.writeFile(forkBytes);
  await fork.close();
  execFileSync("/usr/bin/xattr", ["-wx", "academic-os.empty", "", path]);
  await utimes(path, new Date(-12345000), new Date(-12345000));
  const before = await lstat(path, { bigint: true });
  const { report, exit } = await inventory(root);
  assert.equal(exit, 0);
  const observed = report.entries.find(
    (entry) => entry.pathHex === hex("large"),
  );
  assert(observed);
  assert.equal(observed.dataSha256, hash.digest("hex"));
  assert.equal(observed.before.size, String(length));
  assert.equal(observed.before.mtimeNs, "-12345000000000");
  assert.equal(observed.before.birthtimeNs, before.birthtimeNs.toString());
  assert.equal(
    observed.xattrs?.find(
      (entry) => entry.nameHex === hex("com.apple.ResourceFork"),
    )?.payload?.valueHex,
    forkBytes.toString("hex"),
  );
  assert.equal(
    observed.xattrs?.find((entry) => entry.nameHex === hex("academic-os.empty"))
      ?.payload?.valueHex,
    "",
  );
});

test("native CLI distinguishes the supported depth boundary from its existing limit", {
  skip: process.platform !== "darwin",
}, async () => {
  const { root } = await fixture();
  let deepest = root;
  for (let depth = 0; depth < 256; depth++) {
    deepest = join(deepest, "d");
    await mkdir(deepest);
  }
  const supported = await inventory(root);
  assert.equal(supported.report.complete, true);
  assert.equal(supported.report.entries.length, 257);
  await mkdir(join(deepest, "d"));
  const exceeded = await inventory(root);
  assert.equal(exceeded.exit, 2);
  assert.equal(exceeded.report.complete, false);
  assert.equal(exceeded.report.sourceFingerprint, null);
  assert(
    exceeded.report.diagnostics.some(
      (entry) => entry.code === "inventory-limit",
    ),
  );
});

test("the synchronous scanner supports a C++ consumer, bounded fragments and abort without descriptor leaks", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  const path = join(root, "fragmented");
  await writeFile(path, "fixture");
  const fork = await open(`${path}/..namedfork/rsrc`, "w");
  await fork.writeFile(Buffer.alloc(65537, 0x31));
  await fork.close();
  const object = join(proof, "scan-core.o");
  const executable = join(proof, "scan-core-fixture");
  await run("/usr/bin/xcrun", [
    "clang",
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wno-deprecated-declarations",
    "-c",
    resolve("src/migration/native-inventory/native/scan-core.c"),
    "-o",
    object,
  ]);
  await run("/usr/bin/xcrun", [
    "clang++",
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    resolve("test/migration/native-scan-core-fixture.cc"),
    object,
    "-o",
    executable,
  ]);
  const result = await run(executable, [root]);
  const observed: unknown = JSON.parse(result.stdout);
  assert(
    typeof observed === "object" &&
      observed !== null &&
      "fragments" in observed,
  );
  assert(typeof observed.fragments === "number" && observed.fragments >= 2);
  assert.deepEqual(observed, {
    entries: 2,
    maximumWindow: 65536,
    fragments: observed.fragments,
    abortCount: 16,
    descriptorCountPreserved: true,
  });
});

test("a built native adapter runs without compiler availability", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  const result = await run(
    process.execPath,
    [cli, "migration", "inventory", "--root", root, "--json"],
    {
      env: { ...process.env, DEVELOPER_DIR: join(proof, "missing-toolchain") },
    },
  );
  const value: unknown = JSON.parse(result.stdout);
  assert(validateNativeInventory(value));
  assert.equal((value as NativeInventory).complete, true);
});

async function refusedLog(command: string, root: string, log: string) {
  await assert.rejects(
    run(process.execPath, [
      command,
      "migration",
      "inventory",
      "--root",
      root,
      "--log",
      log,
      "--json",
    ]),
    (error: unknown) => {
      assert(
        error instanceof Error &&
          "stdout" in error &&
          typeof error.stdout === "string",
      );
      const result = JSON.parse(error.stdout);
      assert.equal(result.error?.code, "invalid-arguments");
      assert.match(result.error?.message, /source.*repository/u);
      return true;
    },
  );
}

test("native log refuses physical case and Unicode aliases before mutation", {
  skip: process.platform !== "darwin",
}, async (context) => {
  for (const [name, alias] of [
    ["CaseSource", "casesource"],
    ["Café", "Cafe\u0301"],
  ] as const) {
    await context.test(name, async (child) => {
      const { proof, root: original } = await fixture();
      const root = join(proof, name);
      const alternate = join(proof, alias);
      await rename(original, root);
      await chmod(root, 0o700);
      const before = await lstat(root, { bigint: true });
      const other = await lstat(alternate, { bigint: true }).catch(
        () => undefined,
      );
      if (
        other === undefined ||
        other.ino !== before.ino ||
        other.dev !== before.dev
      ) {
        child.skip(
          "Filesystem gives the alternate spelling a distinct identity.",
        );
        return;
      }
      const contents = await readdir(root);
      await refusedLog(cli, root, join(alternate, "forbidden.json"));
      const after = await lstat(root, { bigint: true });
      assert.deepEqual(await readdir(root), contents);
      assert.equal(after.ctimeNs, before.ctimeNs);
      assert.equal(after.mtimeNs, before.mtimeNs);
      await assert.rejects(lstat(join(root, "forbidden.json")), {
        code: "ENOENT",
      });
    });
  }
});

test("native log refuses physical repository aliases in a disposable installation", {
  skip: process.platform !== "darwin",
}, async (context) => {
  for (const [name, alias] of [
    ["CaseInstallation", "caseinstallation"],
    ["CaféInstallation", "Cafe\u0301Installation"],
  ] as const) {
    await context.test(name, async (child) => {
      const { proof, root } = await fixture();
      const installation = join(proof, name);
      await mkdir(join(installation, "dist"), { recursive: true });
      await cp(
        fileURLToPath(new URL("../../src/", import.meta.url)),
        join(installation, "dist/src"),
        { recursive: true },
      );
      await writeFile(join(installation, "package.json"), '{"type":"module"}');
      await symlink(
        resolve("node_modules"),
        join(installation, "node_modules"),
      );
      const alternate = join(proof, alias);
      const before = await lstat(installation, { bigint: true });
      const other = await lstat(alternate, { bigint: true }).catch(
        () => undefined,
      );
      if (
        other === undefined ||
        other.ino !== before.ino ||
        other.dev !== before.dev
      ) {
        child.skip(
          "Filesystem gives the alternate spelling a distinct identity.",
        );
        return;
      }
      const directory = join(installation, "private-logs");
      await mkdir(directory, { mode: 0o700 });
      const metadata = await lstat(directory, { bigint: true });
      const contents = await readdir(directory);
      await refusedLog(
        join(installation, "dist/src/cli.js"),
        root,
        join(alternate, "private-logs", "forbidden.json"),
      );
      const after = await lstat(directory, { bigint: true });
      assert.deepEqual(await readdir(directory), contents);
      assert.equal(after.ctimeNs, metadata.ctimeNs);
      assert.equal(after.mtimeNs, metadata.mtimeNs);
      await assert.rejects(lstat(join(directory, "forbidden.json")), {
        code: "ENOENT",
      });
    });
  }
});

test("native inventory preserves symlink hardlinks and refuses their external aliases", {
  skip: process.platform !== "darwin",
}, async () => {
  const { proof, root } = await fixture();
  const first = join(root, "first");
  const second = join(root, "second");
  await symlink("no-target", first);
  execFileSync("/bin/ln", ["-P", first, second]);
  const internal = await inventory(root);
  assert.equal(internal.exit, 0);
  const links = internal.report.entries.filter(
    (entry) => entry.kind === "symlink",
  );
  assert.equal(links.length, 2);
  assert.notEqual(links[0]?.hardlinkGroup, null);
  assert.equal(links[0]?.hardlinkGroup, links[1]?.hardlinkGroup);
  assert.equal(links[0]?.before.links, "2");
  assert.equal(links[0]?.linkTargetHex, hex("no-target"));
  execFileSync("/bin/ln", ["-P", first, join(proof, "external-hardlink")]);
  const external = await inventory(root);
  assert.equal(external.exit, 2);
  assert.equal(external.report.outcome, "refused");
  assert.equal(external.report.sourceFingerprint, null);
  assert(
    external.report.diagnostics.some(
      (item) => item.code === "external-hardlink-alias",
    ),
  );
});
