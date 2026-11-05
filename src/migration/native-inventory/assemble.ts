import { createHash } from "node:crypto";
import type {
  NativeInventory,
  NativeInventoryEntry,
} from "./generated/native-inventory-1.js";
import type {
  NativeScanEntry,
  NativeScanRecord,
  NativeStat,
} from "./generated/native-scan-record-1.js";

export const inventoryLimits = {
  outputBytes: 268435456,
  attributeBytes: 33554432,
  depth: 256,
  entries: 1000000,
} as const;

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function binary(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function stableStat(stat: NativeStat) {
  return {
    device: stat.device,
    inode: stat.inode,
    mode: stat.mode,
    uid: stat.uid,
    gid: stat.gid,
    size: stat.size,
    links: stat.links,
    flags: stat.flags,
    rdev: stat.rdev,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs,
  };
}
function stableEntry(entry: NativeScanEntry | NativeInventoryEntry) {
  return {
    pathHex: entry.pathHex,
    kind: entry.kind,
    before: stableStat(entry.before),
    after: entry.after === null ? null : stableStat(entry.after),
    dataSha256: entry.dataSha256,
    linkTargetHex: entry.linkTargetHex,
    acl: entry.acl,
    xattrs: entry.xattrs,
  };
}

export function assembleNativeInventory(input: {
  rootPathHex: string;
  adapter: NativeInventory["adapter"];
  records: NativeScanRecord[];
  failure?: string;
}): NativeInventory {
  const diagnostics: NativeInventory["diagnostics"] = [];
  let omittedDiagnostics = 0;
  let refused = false;
  const add = (code: string, pathHex: string, detail: string) => {
    if (/changed|alias|cross-device|invalid-adapter|invalid-path/u.test(code))
      refused = true;
    if (diagnostics.length < 128)
      diagnostics.push({ code, pathHex, detail: detail.slice(0, 256) });
    else omittedDiagnostics++;
  };
  if (input.failure !== undefined)
    add(
      input.failure,
      "",
      "Native adapter could not establish a complete observation.",
    );
  const first = new Map<string, NativeScanEntry>();
  const second = new Map<string, NativeScanEntry>();
  for (const record of input.records) {
    if (record.record === "diagnostic") {
      add(
        record.code,
        record.pathHex,
        `Native pass ${record.pass}; errno ${record.errno}.`,
      );
      continue;
    }
    const pass = record.pass === 1 ? first : second;
    if (pass.has(record.pathHex))
      add(
        "invalid-adapter-membership",
        record.pathHex,
        "Duplicate raw relative path.",
      );
    pass.set(record.pathHex, record);
    if ((record.before.flags & 0x40000000) !== 0)
      add(
        "dataless-entry",
        record.pathHex,
        "Dataless content cannot establish complete native representation.",
      );
    if (record.kind === "unknown")
      add(
        "unsupported-entry-kind",
        record.pathHex,
        "Unknown native entry kind.",
      );
    const path = Buffer.from(record.pathHex, "hex");
    if (
      path.includes(0) ||
      (path.length !== 0 &&
        path
          .toString("latin1")
          .split("/")
          .some((part) => part === "" || part === "." || part === ".."))
    )
      add(
        "invalid-path",
        record.pathHex,
        "Raw relative path contains an unsafe component.",
      );
    if (
      record.after === null ||
      JSON.stringify(stableStat(record.before)) !==
        JSON.stringify(stableStat(record.after))
    )
      add(
        "source-changed",
        record.pathHex,
        "Entry identity or metadata changed during collection.",
      );
    if (
      (record.kind === "file") !== (record.dataSha256 !== null) ||
      (record.kind === "symlink") !== (record.linkTargetHex !== null)
    )
      add(
        "missing-native-representation",
        record.pathHex,
        "Data hash or raw link target is unavailable or inconsistent with entry kind.",
      );
    if (
      record.acl === null ||
      record.xattrs === null ||
      record.xattrs.some((item) => item.payload === null)
    )
      add(
        "metadata-unavailable",
        record.pathHex,
        "ACL or extended attribute observation is unavailable.",
      );
    for (const payload of [
      record.acl,
      ...(record.xattrs ?? []).map((item) => item.payload),
    ])
      if (
        payload !== null &&
        sha256(Buffer.from(payload.valueHex, "hex")) !== payload.sha256
      )
        add(
          "invalid-adapter-payload",
          record.pathHex,
          "Retained native payload does not match its hash.",
        );
    const attrs = record.xattrs?.map((item) => item.nameHex) ?? [];
    if (
      attrs.some(
        (name, index) =>
          name === "" ||
          Buffer.from(name, "hex").includes(0) ||
          (index > 0 && name <= (attrs[index - 1] ?? "")),
      )
    )
      add(
        "invalid-adapter-xattrs",
        record.pathHex,
        "Extended attribute names must be unique and sorted by raw bytes.",
      );
  }
  for (const path of [...new Set([...first.keys(), ...second.keys()])].sort()) {
    const a = first.get(path);
    const b = second.get(path);
    if (
      a === undefined ||
      b === undefined ||
      JSON.stringify(stableEntry(a)) !== JSON.stringify(stableEntry(b))
    )
      add(
        "source-changed",
        path,
        "Complete membership or native representation differs between passes.",
      );
  }
  if (!first.has("") || first.get("")?.kind !== "directory")
    add(
      "root-unobserved",
      "",
      "A physical root directory was not observed in both passes.",
    );
  const entries: NativeInventoryEntry[] = [...first.values()]
    .sort((a, b) =>
      a.pathHex < b.pathHex ? -1 : a.pathHex > b.pathHex ? 1 : 0,
    )
    .map(({ record: _record, pass: _pass, ...entry }) => ({
      ...entry,
      hardlinkGroup: null,
    }));
  const groups = new Map<string, NativeInventoryEntry[]>();
  const directories = new Map<string, string>();
  for (const entry of entries) {
    if (entry.pathHex !== "") {
      const raw = Buffer.from(entry.pathHex, "hex");
      const slash = raw.lastIndexOf(47);
      const parent = slash < 0 ? "" : raw.subarray(0, slash).toString("hex");
      if (first.get(parent)?.kind !== "directory")
        add(
          "invalid-adapter-membership",
          entry.pathHex,
          "Entry parent is absent or not a directory.",
        );
    }
    const key = `${entry.before.device}:${entry.before.inode}`;
    if (entry.kind === "directory") {
      if (directories.has(key))
        add(
          "directory-alias",
          entry.pathHex,
          "Two raw paths identify the same native directory.",
        );
      directories.set(key, entry.pathHex);
    }
    if (entry.kind !== "file") continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const anchor = group[0];
    if (anchor === undefined) continue;
    if (BigInt(anchor.before.links) !== BigInt(group.length))
      add(
        "external-hardlink-alias",
        anchor.pathHex,
        "Observed regular-file link count differs from complete root membership.",
      );
    if (group.length > 1) {
      const id = sha256(JSON.stringify(group.map((entry) => entry.pathHex)));
      for (const entry of group) {
        entry.hardlinkGroup = id;
        if (
          entry.dataSha256 !== anchor.dataSha256 ||
          JSON.stringify(stableStat(entry.before)) !==
            JSON.stringify(stableStat(anchor.before))
        )
          add(
            "source-changed",
            entry.pathHex,
            "Hardlink members disagree on their shared representation.",
          );
      }
    }
  }
  diagnostics.sort(
    (a, b) =>
      binary(a.pathHex, b.pathHex) ||
      binary(a.code, b.code) ||
      binary(a.detail, b.detail),
  );
  const common = {
    schema: "urn:academic-os:native-inventory:1",
    metadataPolicy: "darwin-native-observation/1",
    rootPathHex: input.rootPathHex,
    adapter: input.adapter,
    observation: "two-pass-non-atomic",
    entries,
    sourceFingerprint:
      diagnostics.length === 0
        ? sha256(
            JSON.stringify({
              rootPathHex: input.rootPathHex,
              entries: entries.map((entry) => ({
                ...stableEntry(entry),
                hardlinkGroup: entry.hardlinkGroup,
              })),
            }),
          )
        : null,
    diagnostics,
    omittedDiagnostics,
    limits: inventoryLimits,
  } as const;
  return refused
    ? { ...common, outcome: "refused", complete: false }
    : diagnostics.length > 0
      ? { ...common, outcome: "incomplete", complete: false }
      : { ...common, outcome: "observed", complete: true };
}
