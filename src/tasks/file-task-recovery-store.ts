import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { sha256 } from "../checksum.js";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import {
  nativeTaskTimingObservationDigest,
  unsupportedNativeTaskTimingObservation,
} from "./native-task-timing.js";
import { parseTaskLifecycleState } from "./task-lifecycle.js";
import type {
  TaskRecoveryCapture,
  TaskRecoveryOperation,
  TaskRecoveryRetention,
  TaskRecoverySnapshot,
  TaskRecoverySource,
  TaskRecoveryStore,
  TaskRecoverySummary,
} from "./task-recovery-types.js";
import type {
  LiveTask,
  TaskRegister,
  TaskRegisterEntry,
  TaskTargetIdentity,
} from "./types.js";

const defaultRetention: TaskRecoveryRetention = {
  maxSnapshots: 512,
  maxAgeDays: 90,
  maxBytes: 64 * 1024 * 1024,
};
const maximumFileBytes = 64 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const snapshotPattern = /^([0-9a-f-]+)\.json$/u;
const pinPattern = /^\.pin-([0-9a-f-]+)\.json$/u;
const retainedPattern = /^\.retain-([0-9a-f]{64})\.json$/u;

interface StoredSnapshot {
  snapshot: TaskRecoverySnapshot;
  bytes: number;
  contentDigest: string;
}
interface RecoveryInventory {
  snapshots: StoredSnapshot[];
  pinned: Set<string>;
  retained: Set<string>;
  auxiliaryBytes: number;
  temporaryCount: number;
}
interface SnapshotPin {
  schemaVersion: 1;
  pinId: string;
  snapshotId: string;
  reference?: string;
}

export function createFileTaskRecoveryStore(input: {
  stateRoot: string;
  excludedRoots: readonly string[];
  now?: () => string;
  retention?: TaskRecoveryRetention;
}): TaskRecoveryStore {
  const retention = { ...(input.retention ?? defaultRetention) };
  requireRetention(retention);
  const now = (): string => instant(input.now?.() ?? new Date().toISOString());
  const locate = async (): Promise<{ root: string; directory: string }> => {
    if (!isAbsolute(input.stateRoot) || input.excludedRoots.length === 0)
      throw new Error(
        "Task recovery needs an absolute private root and explicit excluded Drive/repository roots.",
      );
    await requireDirectory(input.stateRoot);
    const root = await realpath(input.stateRoot);
    for (const excluded of input.excludedRoots) {
      if (!isAbsolute(excluded))
        throw new Error("Excluded Task recovery roots must be absolute.");
      const boundary = await realpath(excluded);
      const child = relative(boundary, root);
      const ancestor = relative(root, boundary);
      if (
        child === "" ||
        (child !== ".." &&
          !child.startsWith(`..${sep}`) &&
          !isAbsolute(child)) ||
        (ancestor !== ".." &&
          !ancestor.startsWith(`..${sep}`) &&
          !isAbsolute(ancestor))
      )
        throw new Error(
          "Task recovery storage must be outside Drive, academic targets and the public repository.",
        );
    }
    const directory = join(root, "task-recovery");
    const created = await mkdir(directory, { mode: 0o700 })
      .then(() => true)
      .catch((error: unknown) => {
        if (!hasCode(error, "EEXIST")) throw error;
        return false;
      });
    await requireDirectory(directory);
    if ((await realpath(directory)) !== directory)
      throw new Error("Task recovery storage ancestry must be canonical.");
    if (created) await syncDirectory(root);
    return { root, directory };
  };
  const withOwner = async <T>(
    run: (directory: string) => Promise<T>,
  ): Promise<T> => {
    const { root, directory } = await locate();
    const owned = await withJournalMutationOwner(
      { stateRoot: root, journalPath: join(directory, "store-owner") },
      async () => {
        await requireDirectory(root);
        await requireDirectory(directory);
        return run(directory);
      },
    );
    if (owned.kind === "refused") throw new Error(owned.evidence);
    return owned.value;
  };
  const store: TaskRecoveryStore = {
    async capture(value) {
      const captured = projectCapture(value);
      const capturedAt = now();
      const snapshot: TaskRecoverySnapshot = {
        ...captured,
        schemaVersion: 1,
        snapshotId: randomUUID(),
        capturedAt,
        nativeTiming: captured.nativeTiming,
        coverage: {
          provider: "complete-observation",
          register: "historical-local-state",
          nativeTiming:
            captured.nativeTiming.status === "observed"
              ? "observed"
              : "unavailable",
        },
      };
      return withOwner(async (directory) => {
        let inventory = await readInventory(directory);
        const digest = contentDigest(snapshot);
        const cutoff =
          Date.parse(capturedAt) - retention.maxAgeDays * 86_400_000;
        const duplicate = inventory.snapshots.find(
          (item) =>
            item.contentDigest === digest &&
            Date.parse(item.snapshot.capturedAt) >= cutoff,
        );
        const selected = duplicate?.snapshot ?? snapshot;
        const bytes = snapshotBytes(selected);
        const candidate = {
          snapshot: selected,
          bytes: Buffer.byteLength(bytes),
          contentDigest: digest,
        };
        const plannedInventory = (): RecoveryInventory => ({
          ...inventory,
          snapshots: duplicate
            ? inventory.snapshots
            : [...inventory.snapshots, candidate],
        });
        let obsolete = retentionPlan(
          plannedInventory(),
          retention,
          capturedAt,
          selected.snapshotId,
        );
        if (
          inventory.snapshots.length + inventory.temporaryCount >
            retention.maxSnapshots ||
          inventory.auxiliaryBytes +
            inventory.snapshots.reduce((total, item) => total + item.bytes, 0) >
            retention.maxBytes
        ) {
          const interruptedPruning = retentionPlan(
            inventory,
            retention,
            capturedAt,
            selected.snapshotId,
          );
          await pruneSnapshots(directory, interruptedPruning);
          inventory = await readInventory(directory);
          obsolete = retentionPlan(
            plannedInventory(),
            retention,
            capturedAt,
            selected.snapshotId,
          );
        }
        if (!duplicate) {
          await publish(directory, `${selected.snapshotId}.json`, bytes);
          const verified = await readSnapshot(directory, selected.snapshotId);
          if (canonical(verified.snapshot) !== canonical(selected))
            throw new Error(
              "Task recovery publication failed readback verification.",
            );
        }
        await pruneSnapshots(directory, obsolete);
        return structuredClone(selected);
      });
    },
    async read(snapshotId) {
      requireSnapshotId(snapshotId);
      return withOwner(async (directory) => {
        const snapshot = (await readSnapshot(directory, snapshotId)).snapshot;
        if (
          !withinAge(snapshot, now(), retention.maxAgeDays) &&
          !(await retainedSnapshots(directory)).has(snapshotId)
        )
          throw expiredSnapshot();
        return structuredClone(snapshot);
      });
    },
    async list(target) {
      const checked = projectTarget(target);
      return withOwner(async (directory) => {
        const inventory = await readInventory(directory);
        const observedAt = now();
        return inventory.snapshots
          .map((item) => item.snapshot)
          .filter(
            (snapshot) =>
              sameTarget(snapshot.target, checked) &&
              (withinAge(snapshot, observedAt, retention.maxAgeDays) ||
                inventory.retained.has(snapshot.snapshotId)),
          )
          .sort(
            (left, right) =>
              right.capturedAt.localeCompare(left.capturedAt) ||
              left.snapshotId.localeCompare(right.snapshotId),
          )
          .map(summary);
      });
    },
    async retain(snapshotId, reference) {
      const pin = retainedPin(snapshotId, reference);
      await withOwner(async (directory) => {
        const snapshot = (await readSnapshot(directory, snapshotId)).snapshot;
        const name = `.retain-${pin.pinId}.json`;
        const previous = await readPin(directory, name).catch(
          (error: unknown) => {
            if (hasCode(error, "ENOENT")) return undefined;
            throw error;
          },
        );
        if (previous !== undefined) {
          if (canonical(previous) !== canonical(pin))
            throw new Error("Task recovery retention reference changed.");
          return;
        }
        if (!withinAge(snapshot, now(), retention.maxAgeDays))
          throw expiredSnapshot();
        const bytes = `${JSON.stringify(pin)}\n`;
        requirePinCapacity(await readInventory(directory), retention, bytes);
        await publish(directory, name, bytes);
        if (canonical(await readPin(directory, name)) !== canonical(pin))
          throw new Error(
            "Task recovery retention persistence failed verification.",
          );
      });
    },
    async release(snapshotId, reference) {
      const pin = retainedPin(snapshotId, reference);
      await withOwner(async (directory) => {
        const name = `.retain-${pin.pinId}.json`;
        const previous = await readPin(directory, name).catch(
          (error: unknown) => {
            if (hasCode(error, "ENOENT")) return undefined;
            throw error;
          },
        );
        if (previous === undefined) return;
        if (canonical(previous) !== canonical(pin))
          throw new Error("Task recovery retention reference changed.");
        await unlink(join(directory, name));
        await syncDirectory(directory);
      });
    },
    async withSnapshot(snapshotId, run) {
      requireSnapshotId(snapshotId);
      const pin: SnapshotPin = {
        schemaVersion: 1,
        pinId: randomUUID(),
        snapshotId,
      };
      const pinned = await withOwner(async (directory) => {
        const snapshot = (await readSnapshot(directory, snapshotId)).snapshot;
        const bytes = `${JSON.stringify(pin)}\n`;
        const inventory = await readInventory(directory);
        if (
          !withinAge(snapshot, now(), retention.maxAgeDays) &&
          !inventory.retained.has(snapshotId)
        )
          throw expiredSnapshot();
        requirePinCapacity(inventory, retention, bytes);
        await publish(directory, `.pin-${pin.pinId}.json`, bytes);
        const persisted = await readPin(directory, `.pin-${pin.pinId}.json`);
        if (canonical(persisted) !== canonical(pin))
          throw new Error("Task recovery pin persistence failed verification.");
        return { directory, snapshot };
      });
      try {
        return await run(structuredClone(pinned.snapshot));
      } finally {
        await withOwner(async (directory) => {
          if (directory !== pinned.directory)
            throw new Error("Task recovery pin storage identity changed.");
          const name = `.pin-${pin.pinId}.json`;
          if (canonical(await readPin(directory, name)) !== canonical(pin))
            throw new Error(
              "Task recovery pin changed; manual reconciliation is required.",
            );
          await unlink(join(directory, name));
          await syncDirectory(directory);
        });
      }
    },
  };
  return store;
}

async function requireDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o7777) !== 0o700
  )
    throw new Error(
      "Task recovery needs private ordinary directories owned by the current user.",
    );
}

async function readPrivateFile(
  path: string,
  limit = maximumFileBytes,
): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o7777) !== 0o600 ||
      info.size > limit
    )
      throw new Error("Unsafe or oversized Task recovery file.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await file.readFile(),
    );
  } finally {
    await file.close();
  }
}

async function readSnapshot(
  directory: string,
  snapshotId: string,
): Promise<StoredSnapshot> {
  requireSnapshotId(snapshotId);
  const bytes = await readPrivateFile(join(directory, `${snapshotId}.json`));
  const envelope = record(JSON.parse(bytes));
  requireKeys(envelope, ["schemaVersion", "checksum", "snapshot"]);
  if (
    envelope.schemaVersion !== 1 ||
    typeof envelope.checksum !== "string" ||
    !/^[0-9a-f]{64}$/u.test(envelope.checksum) ||
    sha256(canonical(envelope.snapshot)) !== envelope.checksum
  )
    throw new Error("Task recovery snapshot checksum did not verify.");
  const raw = record(envelope.snapshot);
  const projected = projectCapture(raw);
  const snapshot: TaskRecoverySnapshot = {
    ...projected,
    schemaVersion: 1,
    snapshotId,
    capturedAt: instant(raw.capturedAt),
    nativeTiming: projected.nativeTiming,
    coverage: {
      provider: "complete-observation",
      register: "historical-local-state",
      nativeTiming:
        projected.nativeTiming.status === "observed"
          ? "observed"
          : "unavailable",
    },
  };
  if (
    raw.schemaVersion !== 1 ||
    raw.snapshotId !== snapshotId ||
    canonical(raw) !== canonical(snapshot)
  )
    throw new Error("Unsupported or invalid Task recovery snapshot fields.");
  return {
    snapshot,
    bytes: Buffer.byteLength(bytes),
    contentDigest: contentDigest(snapshot),
  };
}

async function readPin(directory: string, name: string): Promise<SnapshotPin> {
  const value = record(
    JSON.parse(await readPrivateFile(join(directory, name), 4096)),
  );
  requireKeys(value, ["schemaVersion", "pinId", "snapshotId", "reference"]);
  if (value.schemaVersion !== 1)
    throw new Error(
      "Unsupported Task recovery pin; manual reconciliation is required.",
    );
  const snapshotId = requireSnapshotId(value.snapshotId);
  const pin =
    value.reference === undefined
      ? {
          schemaVersion: 1 as const,
          pinId: requireSnapshotId(value.pinId),
          snapshotId,
        }
      : retainedPin(snapshotId, text(value.reference));
  const expectedName =
    pin.reference === undefined
      ? `.pin-${pin.pinId}.json`
      : `.retain-${pin.pinId}.json`;
  if (name !== expectedName || value.pinId !== pin.pinId)
    throw new Error(
      "Task recovery pin identity changed; manual reconciliation is required.",
    );
  return pin;
}

async function readInventory(directory: string): Promise<RecoveryInventory> {
  const inventory: RecoveryInventory = {
    snapshots: [],
    pinned: new Set(),
    retained: new Set(),
    auxiliaryBytes: 0,
    temporaryCount: 0,
  };
  for (const name of await readdir(directory)) {
    const snapshotMatch = snapshotPattern.exec(name);
    if (snapshotMatch) {
      inventory.snapshots.push(
        await readSnapshot(directory, snapshotMatch[1] ?? ""),
      );
    } else if (pinPattern.test(name) || retainedPattern.test(name)) {
      const pin = await readPin(directory, name);
      inventory.pinned.add(pin.snapshotId);
      if (pin.reference !== undefined) inventory.retained.add(pin.snapshotId);
      inventory.auxiliaryBytes += (await lstat(join(directory, name))).size;
    } else if (name.startsWith(".") && name.endsWith(".tmp")) {
      const partial = await open(
        join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await partial.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o7777) !== 0o600 ||
          info.size > maximumFileBytes
        )
          throw new Error("Unsafe or oversized partial Task recovery file.");
        inventory.auxiliaryBytes += info.size;
        inventory.temporaryCount++;
      } finally {
        await partial.close();
      }
    } else {
      throw new Error(
        "Unrecognized Task recovery storage entry; manual reconciliation is required.",
      );
    }
  }
  for (const snapshotId of inventory.pinned) {
    if (
      !inventory.snapshots.some(
        (item) => item.snapshot.snapshotId === snapshotId,
      )
    )
      throw new Error(
        "Task recovery pin has no verified snapshot; manual reconciliation is required.",
      );
  }
  return inventory;
}

async function retainedSnapshots(directory: string): Promise<Set<string>> {
  const retained = new Set<string>();
  for (const name of await readdir(directory)) {
    if (retainedPattern.test(name))
      retained.add((await readPin(directory, name)).snapshotId);
  }
  return retained;
}

function withinAge(
  snapshot: TaskRecoverySnapshot,
  now: string,
  maxAgeDays: number,
): boolean {
  return (
    Date.parse(snapshot.capturedAt) >= Date.parse(now) - maxAgeDays * 86_400_000
  );
}

function expiredSnapshot(): Error {
  return new Error(
    "Task recovery snapshot has expired under the retention policy.",
  );
}

function retainedPin(snapshotId: string, reference: string): SnapshotPin {
  requireSnapshotId(snapshotId);
  text(reference);
  requireNoCredentials(reference);
  return {
    schemaVersion: 1,
    pinId: sha256(JSON.stringify([snapshotId, reference])),
    snapshotId,
    reference,
  };
}

function requirePinCapacity(
  inventory: RecoveryInventory,
  retention: TaskRecoveryRetention,
  bytes: string,
): void {
  if (
    inventory.auxiliaryBytes +
      inventory.snapshots.reduce((total, item) => total + item.bytes, 0) +
      Buffer.byteLength(bytes) >
    retention.maxBytes
  )
    throw new Error(
      "Task recovery retention has no capacity for a protected snapshot pin.",
    );
}

function retentionPlan(
  inventory: RecoveryInventory,
  retention: TaskRecoveryRetention,
  now: string,
  protectedId: string,
): StoredSnapshot[] {
  const cutoff = Date.parse(now) - retention.maxAgeDays * 86_400_000;
  const protectedIds = new Set([...inventory.pinned, protectedId]);
  const ordered = [...inventory.snapshots].sort(
    (left, right) =>
      Date.parse(left.snapshot.capturedAt) -
        Date.parse(right.snapshot.capturedAt) ||
      left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId),
  );
  const obsolete = ordered.filter(
    (item) =>
      Date.parse(item.snapshot.capturedAt) < cutoff &&
      !protectedIds.has(item.snapshot.snapshotId),
  );
  const removed = new Set(obsolete);
  let count = ordered.length + inventory.temporaryCount - obsolete.length;
  let bytes =
    inventory.auxiliaryBytes +
    ordered.reduce(
      (total, item) => total + (removed.has(item) ? 0 : item.bytes),
      0,
    );
  for (const item of ordered) {
    if (count <= retention.maxSnapshots && bytes <= retention.maxBytes) break;
    if (removed.has(item) || protectedIds.has(item.snapshot.snapshotId))
      continue;
    obsolete.push(item);
    removed.add(item);
    count--;
    bytes -= item.bytes;
  }
  if (count > retention.maxSnapshots || bytes > retention.maxBytes)
    throw new Error(
      "Task recovery retention capacity is protected or exhausted; manual reconciliation is required.",
    );
  return obsolete;
}

async function pruneSnapshots(
  directory: string,
  obsolete: StoredSnapshot[],
): Promise<void> {
  for (const item of obsolete) {
    const current = await readSnapshot(directory, item.snapshot.snapshotId);
    if (canonical(current.snapshot) !== canonical(item.snapshot))
      throw new Error("Task recovery snapshot changed before pruning.");
    await unlink(join(directory, `${item.snapshot.snapshotId}.json`));
  }
  if (obsolete.length > 0) await syncDirectory(directory);
}

async function publish(
  directory: string,
  name: string,
  bytes: string,
): Promise<void> {
  if (Buffer.byteLength(bytes) > maximumFileBytes)
    throw new Error(
      "Task recovery snapshot exceeds its private storage limit.",
    );
  const temporary = join(directory, `.capture-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    const destination = join(directory, name);
    try {
      await lstat(destination);
      throw new Error("An immutable Task recovery publication already exists.");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    await rename(temporary, destination);
    await syncDirectory(directory);
    if ((await readPrivateFile(destination)) !== bytes)
      throw new Error(
        "Task recovery publication failed readback verification.",
      );
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function projectCapture(value: unknown): TaskRecoveryCapture & {
  nativeTiming: TaskRecoverySnapshot["nativeTiming"];
} {
  const raw = record(value);
  const target = projectTarget(raw.target);
  const listId = text(raw.listId);
  const register = projectRegister(raw.register);
  if (register.listId !== undefined && register.listId !== listId)
    throw new Error(
      "Task recovery register and observation list identities differ.",
    );
  if (!Array.isArray(raw.live))
    throw new Error("Missing complete Task recovery observation.");
  const live = raw.live.map(projectLive);
  if (new Set(live.map((task) => task.id)).size !== live.length)
    throw new Error(
      "Task recovery observation contains duplicate Task identities.",
    );
  if (
    raw.reason !== "refresh" &&
    raw.reason !== "before-operation" &&
    raw.reason !== "after-operation"
  )
    throw new Error("Invalid Task recovery capture reason.");
  const nativeTiming =
    raw.nativeTiming === undefined
      ? unsupportedNativeTaskTimingObservation(
          "Independent native Task timing was not available when this snapshot was captured.",
        )
      : (structuredClone(
          raw.nativeTiming,
        ) as TaskRecoverySnapshot["nativeTiming"]);
  nativeTaskTimingObservationDigest(nativeTiming);
  const result: TaskRecoveryCapture & {
    nativeTiming: TaskRecoverySnapshot["nativeTiming"];
  } = {
    target,
    listId,
    register,
    live,
    reason: raw.reason,
    nativeTiming,
  };
  if (raw.operation !== undefined)
    result.operation = projectOperation(raw.operation);
  if (raw.lifecycle !== undefined) {
    result.lifecycle = parseTaskLifecycleState(raw.lifecycle);
    if (
      result.lifecycle.entries.some(
        (entry) => !sameTarget(entry.target, target),
      )
    )
      throw new Error(
        "Task recovery lifecycle evidence belongs to a different target.",
      );
  }
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources))
      throw new Error("Invalid Task recovery source mappings.");
    result.sources = raw.sources.map(projectSource);
  }
  requireNoCredentials(result);
  return result;
}

function projectTarget(value: unknown): TaskTargetIdentity {
  const item = record(value);
  if (item.kind !== "module" && item.kind !== "research-project")
    throw new Error("Invalid Task recovery target kind.");
  return { kind: item.kind, key: text(item.key), title: text(item.title) };
}
function projectRegister(value: unknown): TaskRegister {
  const item = record(value);
  if (!Array.isArray(item.tasks))
    throw new Error("Invalid historical Task register.");
  const result: TaskRegister = { tasks: item.tasks.map(projectRegisterEntry) };
  if (item.listId !== undefined) result.listId = text(item.listId);
  return result;
}
function projectRegisterEntry(value: unknown): TaskRegisterEntry {
  const item = record(value);
  if (
    item.status !== "open" &&
    item.status !== "completed" &&
    item.status !== "cancelled"
  )
    throw new Error("Invalid historical Task register status.");
  const entry: TaskRegisterEntry = {
    title: text(item.title, true),
    status: item.status,
  };
  for (const key of ["taskId", "doDate", "notes"] as const)
    if (item[key] !== undefined) entry[key] = text(item[key], key === "notes");
  if (item.provenance !== undefined) {
    const provenance = record(item.provenance);
    entry.provenance = {};
    for (const key of [
      "assessment",
      "source",
      "milestone",
      "claim",
      "meeting",
      "deliverable",
    ] as const)
      if (provenance[key] !== undefined)
        entry.provenance[key] = text(provenance[key], true);
  }
  return entry;
}
function projectLive(value: unknown): LiveTask {
  const item = record(value);
  const result: LiveTask = { id: text(item.id) };
  for (const key of [
    "etag",
    "updated",
    "completed",
    "parent",
    "position",
    "title",
    "notes",
    "due",
  ] as const)
    if (item[key] !== undefined) result[key] = text(item[key], true);
  for (const key of ["hidden", "deleted"] as const) {
    if (item[key] !== undefined) {
      if (typeof item[key] !== "boolean")
        throw new Error("Invalid Task recovery observation flag.");
      result[key] = item[key];
    }
  }
  if (item.status !== undefined) {
    if (item.status !== "needsAction" && item.status !== "completed")
      throw new Error("Invalid Task recovery provider status.");
    result.status = item.status;
  }
  return result;
}
function projectOperation(value: unknown): TaskRecoveryOperation {
  const item = record(value);
  const result: TaskRecoveryOperation = {
    operationId: text(item.operationId),
    planDigest: text(item.planDigest),
    phase: text(item.phase),
    taskId: item.taskId === null ? null : text(item.taskId),
  };
  if (item.sourceOccurrenceId !== undefined)
    result.sourceOccurrenceId = text(item.sourceOccurrenceId);
  return result;
}
function projectSource(value: unknown): TaskRecoverySource {
  const item = record(value);
  return {
    taskId: text(item.taskId),
    sourceOccurrenceId: text(item.sourceOccurrenceId),
    operationId: text(item.operationId),
    planDigest: text(item.planDigest),
  };
}
function summary(snapshot: TaskRecoverySnapshot): TaskRecoverySummary {
  return {
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    target: structuredClone(snapshot.target),
    listId: snapshot.listId,
    reason: snapshot.reason,
    coverage: { ...snapshot.coverage },
    taskCount: snapshot.live.length,
    registerTaskCount: snapshot.register.tasks.length,
    ...(snapshot.operation === undefined
      ? {}
      : { operation: { ...snapshot.operation } }),
  };
}
function snapshotBytes(snapshot: TaskRecoverySnapshot): string {
  return `${JSON.stringify({ schemaVersion: 1, checksum: sha256(canonical(snapshot)), snapshot })}\n`;
}
function contentDigest(snapshot: TaskRecoverySnapshot): string {
  const { snapshotId: _id, capturedAt: _time, ...content } = snapshot;
  return sha256(canonical(content));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function requireRetention(value: TaskRecoveryRetention): void {
  if (
    !Number.isSafeInteger(value.maxSnapshots) ||
    value.maxSnapshots < 1 ||
    !Number.isFinite(value.maxAgeDays) ||
    value.maxAgeDays <= 0 ||
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1
  )
    throw new Error(
      "Task recovery retention needs positive count, age and byte limits.",
    );
}
function requireSnapshotId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new Error("Invalid Task recovery snapshot identity.");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid Task recovery data shape.");
  return value as Record<string, unknown>;
}
function requireKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unsupported Task recovery file fields.");
}
function text(value: unknown, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim() === "") ||
    value.includes("\0")
  )
    throw new Error("Task recovery fields require explicit strings.");
  return value;
}
function instant(value: unknown): string {
  const result = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(`${result.slice(0, 19)}Z`).toISOString().slice(0, 19) !==
      result.slice(0, 19)
  )
    throw new Error(
      "Task recovery capture timestamps require valid explicit instants.",
    );
  return result;
}
function requireNoCredentials(value: unknown): void {
  if (
    typeof value === "string" &&
    /(?:-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bBearer [A-Za-z0-9._~-]{12,}|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|\bya29\.[A-Za-z0-9._~-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,})/u.test(
      value,
    )
  )
    throw new Error("Task recovery refuses credential-shaped content.");
  if (Array.isArray(value))
    for (const item of value) requireNoCredentials(item);
  else if (typeof value === "object" && value !== null)
    for (const item of Object.values(value)) requireNoCredentials(item);
}
function sameTarget(
  left: Pick<TaskTargetIdentity, "kind" | "key">,
  right: Pick<TaskTargetIdentity, "kind" | "key">,
): boolean {
  return left.kind === right.kind && left.key === right.key;
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
