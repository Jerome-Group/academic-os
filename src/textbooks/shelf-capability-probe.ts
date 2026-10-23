import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  identity,
  observeShelfFile,
  requireShelfRoot,
  sameFile,
  type ShelfIdentity,
  type ShelfFileObservation,
} from "./shelf-file-observation.js";
import { runShelfNative } from "./shelf-native.js";
import {
  appendShelfRun,
  syncDirectory,
  type ShelfRun,
} from "./shelf-run-journal.js";

export async function probeShelfCapabilities(input: {
  run: ShelfRun;
  journal: string;
  binary: string;
}): Promise<void> {
  const { run } = input;
  const directory = join(run.shelfRoot, run.probe);
  await requireShelfRoot(run.shelfRoot, run.root);
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(run.shelfRoot);
  const root = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const expected = identity(await root.stat({ bigint: true }));
    run.probeIdentity = expected;
    await appendShelfRun(input.journal, run);
    const a = await writeSyncedShelfFile(
      directory,
      "a",
      "Shelf capability A\n",
    );
    run.probeFiles = { a };
    await appendShelfRun(input.journal, run);
    const b = await writeSyncedShelfFile(
      directory,
      "b",
      "Shelf capability B\n",
    );
    await requireFile(directory, "a", a);
    await requireFile(directory, "b", b);
    run.probeFiles = { a, b };
    run.probeStep = "occupied-exclusion";
    await appendShelfRun(input.journal, run);
    const blocked = await runShelfNative({
      binary: input.binary,
      rootFd: root.fd,
      root: expected,
      operation: "exclusive",
      source: "a",
      target: "b",
      sourceIdentity: a,
      targetIdentity: null,
    });
    if (blocked.kind !== "refused" || blocked.phase !== "syscall")
      throw new Error(
        `Shelf exclusive rename does not refuse an occupied target: ${JSON.stringify(blocked)}.`,
      );
    await requireFile(directory, "a", a);
    await requireFile(directory, "b", b);
    run.probeStep = "exclusive";
    await appendShelfRun(input.journal, run);
    const moved = await runShelfNative({
      binary: input.binary,
      rootFd: root.fd,
      root: expected,
      operation: "exclusive",
      source: "a",
      target: "c",
      sourceIdentity: a,
      targetIdentity: null,
    });
    if (moved.kind !== "moved")
      throw new Error(
        `Shelf exclusive rename/sync unsupported: ${JSON.stringify(moved)}.`,
      );
    run.probeFiles = { b, c: a };
    run.probeStep = "exchange";
    await appendShelfRun(input.journal, run);
    const exchanged = await runShelfNative({
      binary: input.binary,
      rootFd: root.fd,
      root: expected,
      operation: "exchange",
      source: "c",
      target: "b",
      sourceIdentity: a,
      targetIdentity: b,
    });
    if (exchanged.kind !== "moved")
      throw new Error(
        `Shelf exchange/sync unsupported: ${JSON.stringify(exchanged)}.`,
      );
    await requireFile(directory, "b", a);
    await requireFile(directory, "c", b);
    run.probeFiles = { b: a, c: b };
    run.probeStep = "cleanup";
    await appendShelfRun(input.journal, run);
    if (
      !identityMatches(
        expected,
        identity(await lstat(directory, { bigint: true })),
      )
    )
      throw new Error("Shelf probe directory changed.");
    await requireShelfRoot(run.shelfRoot, run.root);
    await unlink(join(directory, "b"));
    await unlink(join(directory, "c"));
    await root.sync();
    await rmdir(directory);
    await syncDirectory(run.shelfRoot);
  } finally {
    await root.close();
  }
}

function identityMatches(a: ShelfIdentity, b: ShelfIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

async function requireFile(
  root: string,
  name: string,
  expected: NonNullable<Awaited<ReturnType<typeof observeShelfFile>>>,
): Promise<void> {
  const current = await observeShelfFile(root, name);
  if (current === null || !sameFile(current, expected))
    throw new Error(`Shelf capability probe drift: ${name}.`);
}

export async function writeSyncedShelfFile(
  root: string,
  name: string,
  contents: string,
): Promise<ShelfFileObservation> {
  const bytes = Buffer.from(contents, "utf8");
  const file = await open(
    join(root, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let expected: ShelfFileObservation;
  try {
    await file.writeFile(bytes);
    await file.sync();
    const metadata = await file.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size !== BigInt(bytes.byteLength))
      throw new Error(`Shelf exclusive write differs: ${name}.`);
    expected = {
      ...identity(metadata),
      size: String(bytes.byteLength),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await file.close();
  }
  await syncDirectory(root);
  return expected;
}
