import { recover } from "./failure.js";

export const maximumReplayAllocation = 256 * 1024 * 1024;

// The accounting profile uses eight-byte tagged slots, including builds without
// pointer compression. V8's OrderedHashTable has three slots per map entry, a
// half-capacity bucket array and doubling growth. Old and new tables coexist.
// https://github.com/nodejs/node/blob/v26.4.0/deps/v8/src/objects/ordered-hash-table.h
// https://github.com/nodejs/node/blob/v26.4.0/deps/v8/src/objects/ordered-hash-table.cc
// String storage is charged at two bytes per UTF-16 code unit, plus alignment
// and header. Object properties include dictionary/descriptor and shape storage.
// https://github.com/nodejs/node/blob/v26.4.0/deps/v8/src/objects/string.h
// https://github.com/nodejs/node/blob/v26.4.0/deps/v8/src/objects/js-objects.h
const allocation = {
  header: 64,
  property: 256,
  reference: 8,
  growingMapEntry: 256,
  internValue: 64 + 2 * 256,
};
const stringBytes = (value: string) => allocation.header + 2 * value.length;
const internEntryBytes = allocation.growingMapEntry + allocation.internValue;

// Native history uses at most sixteen map/set memberships per event. The store
// adds two digest/position cache memberships. Query
// arrays retain references to shared nodes, never cloned records. Thirty-two
// array slots cover simultaneously live results and old/new growing arrays.
// Two digest strings and the pending-row object are also charged per event.
export const replayRowWorkspace =
  18 * (allocation.growingMapEntry + stringBytes("x".repeat(256))) +
  32 * allocation.reference +
  2 * stringBytes("x".repeat(64)) +
  allocation.header +
  4 * allocation.property;

export function requireReplayAccountingProfile(
  node = process.versions.node,
  v8 = process.versions.v8,
  architecture = process.arch,
): void {
  const major = Number(node.split(".")[0]);
  const engine = Number(v8.split(".")[0]);
  if (
    !["arm64", "x64"].includes(architecture) ||
    !(
      (major === 24 && engine === 13) ||
      ((major === 25 || major === 26) && engine === 14)
    )
  )
    recover(
      "journal-recovery-required",
      "This runtime has no supported mixed-replay allocation accounting profile.",
    );
}

type Shared = { value: unknown; id: number };

function objectBytes(properties: number): number {
  return allocation.header + allocation.property * properties;
}

// This upper bound deliberately assumes no sharing. It reserves unknown future
// physical observations without assuming that their ACLs or identities repeat.
export function unsharedAllocation(value: unknown): number {
  if (typeof value === "string") return stringBytes(value) + internEntryBytes;
  if (value === null || typeof value !== "object") return 0;
  const entries = Object.entries(value);
  let bytes = objectBytes(entries.length) + internEntryBytes;
  let keyCharacters = 16;
  for (const [key, child] of entries) {
    bytes += unsharedAllocation(key) + unsharedAllocation(child);
    keyCharacters += 64;
  }
  return bytes + allocation.header + 2 * keyCharacters;
}

export class ReplayAllocation {
  private readonly strings = new Map<string, Shared>();
  private readonly nodes = new Map<string, Shared>();
  private nextId = 0;
  private bytes = 2 * allocation.header;
  private rows = 0;

  constructor() {
    requireReplayAccountingProfile();
  }

  get byteLength(): number {
    return this.bytes + this.rows * replayRowWorkspace;
  }

  require(additionalBytes = 0, additionalRows = 0): void {
    if (
      !Number.isSafeInteger(additionalBytes) ||
      additionalBytes < 0 ||
      !Number.isSafeInteger(additionalRows) ||
      additionalRows < 0 ||
      additionalBytes + additionalRows * replayRowWorkspace >
        maximumReplayAllocation - this.byteLength
    )
      recover(
        "durability-unavailable",
        "Mixed ledger compact replay allocation and complete recovery suffix exceed 256 MiB.",
      );
  }

  retain<T>(value: T): T {
    // The value already passed the closed wire schema. Interning changes only
    // reference identity. Frozen nodes make cross-record sharing immutable.
    return this.share(value).value as T;
  }

  addRow(): void {
    this.require(0, 1);
    this.rows++;
  }

  private charge(bytes: number): void {
    this.require(bytes);
    this.bytes += bytes;
  }

  private share(value: unknown): Shared {
    if (typeof value === "string") {
      const prior = this.strings.get(value);
      if (prior) return prior;
      this.charge(stringBytes(value) + internEntryBytes);
      // Detach from any sliced JSON source backing store.
      const detached = Buffer.from(value, "utf16le").toString("utf16le");
      const entry = { value: detached, id: this.nextId++ };
      this.strings.set(detached, entry);
      return entry;
    }
    if (value === null || typeof value !== "object") return { value, id: -1 };
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const children = entries.map(([key, child]) => ({
      key: this.share(key),
      child: this.share(child),
    }));
    const key = JSON.stringify([
      Array.isArray(value),
      ...children.map(({ key, child }) => [
        key.id,
        child.id < 0 ? [typeof child.value, child.value] : child.id,
      ]),
    ]);
    const prior = this.nodes.get(key);
    if (prior) return prior;
    this.charge(
      objectBytes(entries.length) + stringBytes(key) + internEntryBytes,
    );
    const normalized: unknown[] | Record<string, unknown> = Array.isArray(value)
      ? []
      : {};
    for (const { key, child } of children)
      Reflect.set(normalized, String(key.value), child.value);
    Object.freeze(normalized);
    const entry = { value: normalized, id: this.nextId++ };
    this.nodes.set(key, entry);
    return entry;
  }
}
