import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  type JournalMutationResult,
  withJournalMutationOwner,
} from "../journal-mutation-owner.js";

const maximumJsonBytes = 4 * 1024 * 1024;
const maximumSourceBytes = 4096;
const maximumEnvelopeBytes = 12 * 1024 * 1024;

export interface CompletionCatalogSnapshot {
  rawJson: Buffer;
  sourceIdentity: string;
  acquisitionJson: Buffer;
}

export interface CompletionCatalogOwner {
  assertCurrent(): Promise<void>;
  read(): Promise<CompletionCatalogSnapshot | undefined>;
  publish<T>(
    candidate: CompletionCatalogSnapshot,
    validate: (
      candidate: CompletionCatalogSnapshot,
      current: CompletionCatalogSnapshot | undefined,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface PrivateCompletionCatalogStore {
  withOwner<T>(
    run: (owner: CompletionCatalogOwner) => Promise<T>,
  ): Promise<JournalMutationResult<T>>;
}

// This adapter establishes storage identity, never producer authority. The injected validator
// owns source/age/revision policy, including comparing candidate against the retained current bytes.
export function createPrivateCompletionCatalogStore(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
}): PrivateCompletionCatalogStore {
  const stateRoot = input.stateRoot;
  const excludedRoots = [...input.excludedRoots];
  async function locate() {
    if (!isAbsolute(stateRoot) || excludedRoots.length === 0)
      throw new Error(
        "Catalog requires an absolute private root and excluded repository/Drive roots.",
      );
    const info = await lstat(stateRoot);
    const root = await realpath(stateRoot);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o7777) !== 0o700 ||
      root !== stateRoot
    )
      throw new Error(
        "Catalog root must be canonical, private and user-owned.",
      );
    for (const excluded of excludedRoots) {
      if (!isAbsolute(excluded))
        throw new Error("Excluded roots must be absolute.");
      const boundary = await realpath(excluded);
      if (contains(boundary, root) || contains(root, boundary))
        throw new Error(
          "Catalog root overlaps excluded repository/Drive storage.",
        );
    }
    return {
      root,
      path: join(root, "completion-catalog.json"),
      dev: info.dev,
      ino: info.ino,
    };
  }
  return {
    async withOwner(run) {
      const identity = await locate();
      const { root, path } = identity;
      async function requireRootIdentity() {
        const current = await locate();
        if (current.dev !== identity.dev || current.ino !== identity.ino)
          throw new Error(
            "Catalog root identity changed during ownership; reacquire and revalidate before sending.",
          );
      }
      return withJournalMutationOwner(
        { stateRoot: root, journalPath: path },
        async (canonicalPath) => {
          const ownerDirectory = join(root, "journal-ownership");
          const ownerPath = join(
            ownerDirectory,
            `${createHash("sha256")
              .update(
                join(
                  dirname(canonicalPath),
                  basename(canonicalPath).toLowerCase(),
                ),
              )
              .digest("hex")}.sqlite`,
          );
          const directoryIdentity = await lstat(ownerDirectory);
          const sidecarIdentity = await lstat(ownerPath);
          // Cooperating publication shares this SQLite owner. Identity probes detect observed
          // swaps; hostile filesystem changes between probes remain outside that guarantee.
          async function requireCurrentOwner() {
            await requireRootIdentity();
            const directory = await lstat(ownerDirectory);
            const sidecar = await lstat(ownerPath);
            if (
              !directory.isDirectory() ||
              directory.isSymbolicLink() ||
              directory.dev !== directoryIdentity.dev ||
              directory.ino !== directoryIdentity.ino ||
              directory.uid !== process.getuid?.() ||
              (directory.mode & 0o7777) !== 0o700 ||
              !sidecar.isFile() ||
              sidecar.isSymbolicLink() ||
              sidecar.nlink !== 1 ||
              sidecar.dev !== sidecarIdentity.dev ||
              sidecar.ino !== sidecarIdentity.ino ||
              sidecar.uid !== process.getuid?.() ||
              (sidecar.mode & 0o7777) !== 0o600 ||
              (await realpath(ownerDirectory)) !== ownerDirectory
            )
              throw new Error(
                "Catalog ownership identity changed; reacquire before continuing.",
              );
          }
          await requireCurrentOwner();
          let active = true;
          let pending: Promise<unknown> | undefined;
          function scoped<T>(action: () => Promise<T>): Promise<T> {
            if (!active)
              return Promise.reject(
                new Error("Catalog owner is no longer active."),
              );
            if (pending !== undefined)
              return Promise.reject(
                new Error(
                  "Catalog owner already has an operation in progress.",
                ),
              );
            const result = action();
            pending = result;
            void result
              .finally(() => {
                if (pending === result) pending = undefined;
              })
              .catch(() => {});
            return result;
          }
          const owner: CompletionCatalogOwner = {
            assertCurrent: () => scoped(requireCurrentOwner),
            read: () =>
              scoped(async () => {
                await requireCurrentOwner();
                const value = await readSnapshot(canonicalPath);
                await requireCurrentOwner();
                return value;
              }),
            publish: (candidate, validate) => {
              // Capture before the first await; validators and callers cannot mutate publication bytes.
              let captured: CompletionCatalogSnapshot;
              try {
                captured = capture(candidate);
              } catch (error) {
                return Promise.reject(error);
              }
              return scoped(async () => {
                await requireCurrentOwner();
                const current = await readSnapshot(canonicalPath);
                const validated = await validate(
                  capture(captured),
                  current === undefined ? undefined : capture(current),
                );
                await requireCurrentOwner();
                await requireUnchanged(canonicalPath, current);
                await replaceSnapshot(
                  root,
                  canonicalPath,
                  captured,
                  requireCurrentOwner,
                );
                await requireCurrentOwner();
                return validated;
              });
            },
          };
          try {
            const value = await run(owner);
            await requireCurrentOwner();
            return value;
          } finally {
            active = false;
            // Keep ownership even if a callback starts an operation without awaiting it.
            await pending?.catch(() => {});
          }
        },
      );
    },
  };
}

function capture(value: CompletionCatalogSnapshot): CompletionCatalogSnapshot {
  if (
    typeof value.sourceIdentity !== "string" ||
    value.sourceIdentity.length === 0 ||
    Buffer.byteLength(value.sourceIdentity) > maximumSourceBytes
  )
    throw new Error("Catalog source identity is missing or oversized.");
  return {
    rawJson: captureJson(value.rawJson),
    sourceIdentity: value.sourceIdentity,
    acquisitionJson: captureJson(value.acquisitionJson),
  };
}

function captureJson(bytes: Buffer): Buffer {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > maximumJsonBytes
  )
    throw new Error("Catalog JSON bytes are missing or oversized.");
  const captured = Buffer.from(bytes);
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captured));
  return captured;
}

async function readSnapshot(
  path: string,
): Promise<CompletionCatalogSnapshot | undefined> {
  const pointer = await readEnvelope(path);
  if (pointer === undefined) return undefined;
  if (
    typeof pointer !== "object" ||
    pointer === null ||
    !("version" in pointer) ||
    pointer.version !== 1 ||
    !("record" in pointer) ||
    typeof pointer.record !== "string" ||
    !/^[a-f0-9]{64}$/u.test(pointer.record)
  )
    throw new Error("Invalid catalog current pointer.");
  const value = parseSnapshot(
    await readEnvelope(
      join(dirname(path), `completion-catalog-${pointer.record}.json`),
    ),
  );
  if (digest(value) !== pointer.record)
    throw new Error("Catalog record identity mismatch.");
  return value;
}

async function readEnvelope(path: string): Promise<unknown> {
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
    await requireFile(file);
    const bytes = Buffer.alloc(maximumEnvelopeBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    if (count > maximumEnvelopeBytes)
      throw new Error("Catalog envelope is oversized.");
    await requireFile(file);
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, count),
      ),
    );
  } finally {
    await file.close();
  }
}

function parseSnapshot(envelope: unknown): CompletionCatalogSnapshot {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("version" in envelope) ||
    envelope.version !== 1 ||
    !("rawBase64" in envelope) ||
    typeof envelope.rawBase64 !== "string" ||
    !("sourceIdentity" in envelope) ||
    typeof envelope.sourceIdentity !== "string" ||
    !("acquisitionBase64" in envelope) ||
    typeof envelope.acquisitionBase64 !== "string" ||
    !("checksum" in envelope) ||
    typeof envelope.checksum !== "string"
  )
    throw new Error("Invalid catalog storage envelope.");
  const snapshot = capture({
    rawJson: decodeBase64(envelope.rawBase64),
    sourceIdentity: envelope.sourceIdentity,
    acquisitionJson: decodeBase64(envelope.acquisitionBase64),
  });
  if (digest(snapshot) !== envelope.checksum)
    throw new Error("Catalog storage checksum mismatch.");
  return snapshot;
}

async function requireFile(file: FileHandle): Promise<void> {
  const info = await file.stat();
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o7777) !== 0o600 ||
    info.size > maximumEnvelopeBytes
  )
    throw new Error(
      "Catalog must be an ordinary private owned file without hardlinks.",
    );
}

async function requireUnchanged(
  path: string,
  expected: CompletionCatalogSnapshot | undefined,
) {
  const current = await readSnapshot(path);
  if (
    (current === undefined) !== (expected === undefined) ||
    (current !== undefined &&
      expected !== undefined &&
      digest(current) !== digest(expected))
  )
    throw new Error("Catalog changed during producer validation.");
}

async function replaceSnapshot(
  root: string,
  path: string,
  value: CompletionCatalogSnapshot,
  requireRootIdentity: () => Promise<void>,
): Promise<void> {
  const checksum = digest(value);
  const recordPath = join(root, `completion-catalog-${checksum}.json`);
  const existing = await readEnvelope(recordPath);
  if (existing !== undefined) {
    if (digest(parseSnapshot(existing)) !== checksum)
      throw new Error("Existing immutable catalog record differs.");
  } else {
    await atomicWrite(
      root,
      recordPath,
      JSON.stringify({
        version: 1,
        rawBase64: value.rawJson.toString("base64"),
        sourceIdentity: value.sourceIdentity,
        acquisitionBase64: value.acquisitionJson.toString("base64"),
        checksum,
      }),
      requireRootIdentity,
    );
  }
  await atomicWrite(
    root,
    path,
    JSON.stringify({ version: 1, record: checksum }),
    requireRootIdentity,
  );
}

async function atomicWrite(
  root: string,
  path: string,
  bytes: string,
  requireRootIdentity: () => Promise<void>,
): Promise<void> {
  await requireRootIdentity();
  const temporary = join(root, `.completion-catalog-${randomUUID()}.tmp`);
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let renamed = false;
  try {
    await file.writeFile(bytes);
    await file.sync();
    await requireFile(file);
    await file.close();
    await requireRootIdentity();
    await rename(temporary, path);
    renamed = true;
    const directory = await open(
      root,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (renamed)
      throw new Error(
        "Catalog replacement durability is uncertain; re-read current under its owner before retry. Immutable records remain retained.",
        { cause: error },
      );
    throw error;
  } finally {
    await file.close();
    await unlink(temporary).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}

function digest(value: CompletionCatalogSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        value.rawJson.toString("base64"),
        value.sourceIdentity,
        value.acquisitionJson.toString("base64"),
      ]),
    )
    .digest("hex");
}

function decodeBase64(value: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new Error("Invalid catalog byte encoding.");
  return bytes;
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
