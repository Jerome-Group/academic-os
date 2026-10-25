import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const tlcIdentity = Object.freeze({
  sha256: "d15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f",
  size: 4502259,
  revision: "2ef2af8c767b76e5db5cba2878f027ac07aad36c",
  banner: "TLC2 Version 2026.10.24.013619 (rev: 2ef2af8)",
  helpBanner:
    "\tTLC - provides model checking and simulation of TLA+ specifications - Version 2026.10.24.013619",
});

export async function preparePinnedTlc({ evidence, overrideJar }) {
  const owner = await lstat(evidence);
  assert.ok(
    owner.isDirectory() &&
      !owner.isSymbolicLink() &&
      owner.uid === process.getuid?.() &&
      (owner.mode & 0o777) === 0o700,
    "TLC evidence requires an owned private directory",
  );
  const source = resolve(
    overrideJar ??
      join(dirname(fileURLToPath(import.meta.url)), "vendor/tla2tools.jar"),
  );
  const bytes = await readFile(source);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    tlcIdentity.sha256,
    "pinned TLC jar checksum",
  );
  assert.equal(bytes.length, tlcIdentity.size, "pinned TLC jar size");
  const directory = await mkdtemp(join(await realpath(evidence), "tlc-tool-"));
  assert.deepEqual(
    await readdir(directory),
    [],
    "fresh TLC classpath directory",
  );
  const jar = join(directory, "tla2tools.jar");
  await writeFile(jar, bytes, { flag: "wx", mode: 0o400 });
  await chmod(directory, 0o500);
  const [stagedDirectory, stagedJar] = await Promise.all([
    lstat(directory),
    lstat(jar),
  ]);
  assert.ok(
    stagedDirectory.isDirectory() &&
      !stagedDirectory.isSymbolicLink() &&
      stagedDirectory.uid === owner.uid &&
      (stagedDirectory.mode & 0o777) === 0o500,
    "owned read-only TLC classpath directory",
  );
  assert.ok(
    stagedJar.isFile() &&
      !stagedJar.isSymbolicLink() &&
      stagedJar.uid === owner.uid &&
      (stagedJar.mode & 0o777) === 0o400,
    "owned read-only TLC artifact",
  );
  assert.equal(await realpath(jar), jar, "canonical TLC artifact");
  assert.deepEqual(
    await readdir(directory),
    ["tla2tools.jar"],
    "manifest classpath neighbors must be absent",
  );
  assert.deepEqual(await readFile(jar), bytes, "staged TLC bytes");
  return { jar, source, identity: tlcIdentity };
}

export function tlcJavaEnvironment(temporary, source = process.env) {
  const environment = {};
  for (const key of [
    "PATH",
    "HOME",
    "JAVA",
    "JAVA_HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SYSTEMROOT",
  ])
    if (source[key] !== undefined) environment[key] = source[key];
  return { ...environment, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
}
