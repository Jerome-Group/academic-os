import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { sha256, sha256Bytes } from "../checksum.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import {
  parseTaskExecutionPlan,
  taskExecutionPlanDigest,
} from "./task-execution-plan.js";
import type {
  PreparedCompletion,
  PreparedCompletionStore,
} from "./prepared-completion-store.js";

const maximumBytes = 4 * 1024 * 1024;

export function createFilePreparedCompletionStore(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
}): PreparedCompletionStore {
  const stateRoot = input.stateRoot;
  const excludedRoots = [...input.excludedRoots];
  const locate = async (operationId: string) => {
    requireOperationId(operationId);
    if (!isAbsolute(stateRoot) || excludedRoots.length === 0)
      throw new Error(
        "Prepared completion requires an absolute private root and excluded Drive/repository roots.",
      );
    const info = await lstat(stateRoot);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o7777) !== 0o700
    )
      throw new Error(
        "Prepared completion root must be private, ordinary and user-owned.",
      );
    const root = await realpath(stateRoot);
    for (const excluded of excludedRoots) {
      if (!isAbsolute(excluded))
        throw new Error("Excluded roots must be absolute.");
      const boundary = await realpath(excluded);
      if (contains(boundary, root) || contains(root, boundary))
        throw new Error(
          "Prepared completion root overlaps excluded Drive/repository storage.",
        );
    }
    return {
      root,
      path: join(root, `prepared-completion-${sha256(operationId)}.json`),
    };
  };
  return {
    async readEffect(effectKey) {
      if (!/^[a-f0-9]{64}$/u.test(effectKey))
        throw new Error("Invalid completion effect key.");
      const key = `effect:${effectKey}`;
      const { root, path } = await locate(key);
      const owned = await withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        (canonicalPath) => readPrepared(canonicalPath, undefined, key),
      );
      if (owned.kind === "refused") throw new Error(owned.evidence);
      return owned.value;
    },
    async reserveEffect(effectKey, prepared) {
      if (!/^[a-f0-9]{64}$/u.test(effectKey))
        throw new Error("Invalid completion effect key.");
      const captured = parsePrepared(structuredClone(prepared));
      const key = `effect:${effectKey}`;
      const bytes = encode(captured);
      const { root, path } = await locate(key);
      const owned = await withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        async (canonicalPath) => {
          const previous = await readPrepared(canonicalPath, undefined, key);
          if (previous !== undefined) {
            if (encode(previous) !== bytes)
              throw new Error("completion-effect-reserved");
            return;
          }
          if (!(await recoverTemporary(root, canonicalPath, bytes, key)))
            await publish(root, canonicalPath, bytes, key);
          const stored = await readPrepared(
            canonicalPath,
            captured.operationId,
            key,
          );
          if (stored === undefined || encode(stored) !== bytes)
            throw new Error("Completion effect reservation did not verify.");
        },
      );
      if (owned.kind === "refused") throw new Error(owned.evidence);
    },
    async prepare(value) {
      // Capture before awaiting ownership: caller mutation cannot change the binding.
      const captured = parsePrepared({
        schemaVersion: 1,
        operationId: value.plan.operationId,
        packetJson: value.packetJson,
        ...(value.acquisitionEvidenceJson === undefined
          ? {}
          : { acquisitionEvidenceJson: value.acquisitionEvidenceJson }),
        plan: value.plan,
        planDigest: taskExecutionPlanDigest(value.plan),
      });
      const bytes = encode(captured);
      const { root, path } = await locate(captured.operationId);
      const owned = await withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        async (canonicalPath) => {
          const previous = await readPrepared(
            canonicalPath,
            captured.operationId,
          );
          if (previous !== undefined) {
            if (encode(previous) !== bytes)
              throw new Error(
                "Prepared completion identity already binds a different packet, evidence or plan.",
              );
            return previous;
          }
          if (
            !(await recoverTemporary(
              root,
              canonicalPath,
              bytes,
              captured.operationId,
            ))
          )
            await publish(root, canonicalPath, bytes, captured.operationId);
          const stored = await readPrepared(
            canonicalPath,
            captured.operationId,
          );
          if (stored === undefined || encode(stored) !== bytes)
            throw new Error("Prepared completion publication did not verify.");
          return stored;
        },
      );
      if (owned.kind === "refused") throw new Error(owned.evidence);
      return owned.value;
    },
    async read(operationId) {
      const { root, path } = await locate(operationId);
      const owned = await withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        (canonicalPath) => readPrepared(canonicalPath, operationId),
      );
      if (owned.kind === "refused") throw new Error(owned.evidence);
      return owned.value;
    },
  };
}

async function readPrepared(
  path: string,
  operationId: string | undefined,
  publicationId = operationId,
): Promise<PreparedCompletion | undefined> {
  let file: FileHandle;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      ![1, 2].includes(info.nlink) ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o7777) !== 0o600 ||
      info.size > maximumBytes
    )
      throw new Error("Unsafe or oversized prepared completion file.");
    const prepared = parsePublication(await readBoundedBytes(file));
    if (operationId !== undefined && prepared.operationId !== operationId)
      throw new Error(
        "Prepared completion identity or checksum did not verify.",
      );
    if (info.nlink === 2) {
      if (publicationId === undefined)
        throw new Error("Missing publication identity.");
      await recoverPublication(path, publicationId, file, info);
    }
    await syncDirectory(dirname(path));
    return prepared;
  } finally {
    await file.close();
  }
}

async function readBoundedBytes(file: FileHandle): Promise<Buffer> {
  const buffer = Buffer.alloc(maximumBytes + 1);
  let length = 0;
  while (length < buffer.length) {
    const result = await file.read(
      buffer,
      length,
      buffer.length - length,
      null,
    );
    if (result.bytesRead === 0) break;
    length += result.bytesRead;
  }
  if (length > maximumBytes)
    throw new Error("Oversized prepared completion file.");
  return buffer.subarray(0, length);
}

function parsePublication(buffer: Buffer): PreparedCompletion {
  const bytes = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(buffer);
  const envelope = record(JSON.parse(bytes));
  requireKeys(envelope, ["checksum", "prepared"]);
  const prepared = parsePrepared(envelope.prepared);
  if (
    envelope.checksum !== sha256(JSON.stringify(prepared)) ||
    encode(prepared) !== bytes
  )
    throw new Error("Prepared completion identity or checksum did not verify.");
  return prepared;
}

async function recoverTemporary(
  root: string,
  path: string,
  expected: string,
  operationId: string,
): Promise<boolean> {
  const temporary = publicationTemporary(root, operationId);
  let file: FileHandle;
  try {
    file = await open(
      temporary,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  try {
    const info = await file.stat();
    requirePrivateTemporary(info);
    const bytes = await readBoundedBytes(file);
    let complete: PreparedCompletion | undefined;
    try {
      complete = parsePublication(bytes);
    } catch {
      /* Partial bytes remain evidence in quarantine. */
    }
    if (complete !== undefined) {
      if (
        complete.operationId !==
          parsePublication(Buffer.from(expected)).operationId ||
        !bytes.equals(Buffer.from(expected))
      )
        throw new Error(
          "Prepared completion temp binds a different operation, packet, evidence or plan.",
        );
      if (info.nlink !== 1)
        throw new Error("Unsafe prepared completion temp has unrelated links.");
      await requireSameTemporary(temporary, file, info, 1);
      await file.sync();
      await link(temporary, path);
      await recoverPublication(path, operationId, file, info);
      return true;
    }
    const quarantine = join(
      root,
      `.prepared-completion-${sha256(operationId)}-partial-${sha256Bytes(bytes)}-${info.dev.toString(16)}-${info.ino.toString(16)}.quarantine`,
    );
    if (info.nlink === 1) {
      await requireSameTemporary(temporary, file, info, 1);
      await file.sync();
      await link(temporary, quarantine);
    }
    await requireSameTemporary(quarantine, file, info, 2);
    await requireSameTemporary(temporary, file, info, 2);
    await syncDirectory(root);
    await unlink(temporary);
    await syncDirectory(root);
    await requireSameTemporary(quarantine, file, info, 1);
    return false;
  } finally {
    await file.close();
  }
}

function requirePrivateTemporary(info: Stats): void {
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    ![1, 2].includes(info.nlink) ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o7777) !== 0o600 ||
    info.size > maximumBytes
  )
    throw new Error(
      "Unsafe or oversized prepared completion temp requires reconciliation.",
    );
}

async function requireSameTemporary(
  path: string,
  file: FileHandle,
  original: Stats,
  links: number,
): Promise<void> {
  for (const candidate of [await lstat(path), await file.stat()]) {
    requirePrivateTemporary(candidate);
    if (
      candidate.dev !== original.dev ||
      candidate.ino !== original.ino ||
      candidate.size !== original.size ||
      candidate.nlink !== links
    )
      throw new Error(
        "Unsafe prepared completion temp identity requires reconciliation.",
      );
  }
}

async function publish(
  root: string,
  path: string,
  bytes: string,
  operationId: string,
): Promise<void> {
  const temporary = publicationTemporary(root, operationId);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    // Exclusive link publication cannot replace an existing immutable record.
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
  await syncDirectory(root);
}

async function recoverPublication(
  path: string,
  operationId: string,
  file: FileHandle,
  original: Stats,
): Promise<void> {
  const root = dirname(path);
  const temporary = publicationTemporary(root, operationId);
  const final = await lstat(path);
  let pending: Stats;
  try {
    pending = await lstat(temporary);
  } catch {
    throw new Error(
      "Unsafe prepared completion link has no operation-bound publication temp.",
    );
  }
  for (const candidate of [final, pending, await file.stat()]) {
    if (
      !candidate.isFile() ||
      candidate.isSymbolicLink() ||
      candidate.dev !== original.dev ||
      candidate.ino !== original.ino ||
      candidate.nlink !== 2 ||
      candidate.uid !== process.getuid?.() ||
      (candidate.mode & 0o7777) !== 0o600 ||
      candidate.size !== original.size
    )
      throw new Error(
        "Unsafe prepared completion publication links require manual reconciliation.",
      );
  }
  await unlink(temporary);
  await syncDirectory(root);
  const recovered = await file.stat();
  const published = await lstat(path);
  if (
    recovered.nlink !== 1 ||
    published.nlink !== 1 ||
    published.dev !== recovered.dev ||
    published.ino !== recovered.ino
  )
    throw new Error("Prepared completion publication recovery did not verify.");
}

function publicationTemporary(root: string, operationId: string): string {
  return join(root, `.prepared-completion-${sha256(operationId)}.tmp`);
}

async function syncDirectory(root: string): Promise<void> {
  const directory = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parsePrepared(value: unknown): PreparedCompletion {
  const item = record(value);
  requireKeys(item, [
    "schemaVersion",
    "operationId",
    "packetJson",
    "acquisitionEvidenceJson",
    "plan",
    "planDigest",
  ]);
  requireOperationId(item.operationId);
  const plan = parseTaskExecutionPlan(item.plan);
  const packetJson = requireJson(item.packetJson);
  const acquisitionEvidenceJson =
    item.acquisitionEvidenceJson === undefined
      ? undefined
      : requireJson(item.acquisitionEvidenceJson);
  if (
    item.schemaVersion !== 1 ||
    plan.operationId !== item.operationId ||
    item.planDigest !== taskExecutionPlanDigest(plan)
  )
    throw new Error("Invalid prepared completion plan binding.");
  return {
    schemaVersion: 1,
    operationId: item.operationId,
    packetJson,
    ...(acquisitionEvidenceJson === undefined
      ? {}
      : { acquisitionEvidenceJson }),
    plan,
    planDigest: item.planDigest,
  };
}

function requireJson(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximumBytes)
    throw new Error("Prepared completion requires bounded JSON text.");
  JSON.parse(value);
  return value;
}
function encode(prepared: PreparedCompletion): string {
  const bytes = `${JSON.stringify({ checksum: sha256(JSON.stringify(prepared)), prepared })}\n`;
  if (Buffer.byteLength(bytes) > maximumBytes)
    throw new Error("Prepared completion exceeds its storage bound.");
  return bytes;
}
function requireOperationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200)
    throw new Error("Invalid prepared completion operation identity.");
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid prepared completion object.");
  return value as Record<string, unknown>;
}
function requireKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown prepared completion field.");
}
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
