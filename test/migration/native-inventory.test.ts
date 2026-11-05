import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleNativeInventory,
  sha256,
} from "../../src/migration/native-inventory/assemble.js";
import type {
  NativeScanEntry,
  NativeScanRecord,
  NativeStat,
} from "../../src/migration/native-inventory/generated/native-scan-record-1.js";
import {
  validateNativeInventory,
  validateScanRecord,
} from "../../src/migration/native-inventory/schema.js";

const stat: NativeStat = {
  device: "1",
  inode: "2",
  mode: 16832,
  uid: 1,
  gid: 1,
  size: "0",
  links: "1",
  flags: 0,
  rdev: "0",
  mtimeNs: "1234567890123456789",
  ctimeNs: "1234567890123456789",
  birthtimeNs: "-1234567890123456789",
  atimeNs: "1234567890123456789",
};
function entry(
  pathHex = "",
  kind: NativeScanEntry["kind"] = "directory",
): NativeScanEntry {
  return {
    record: "entry",
    pass: 1,
    pathHex,
    kind,
    before: { ...stat, inode: pathHex === "" ? "1" : "2" },
    after: { ...stat, inode: pathHex === "" ? "1" : "2" },
    dataSha256: kind === "file" ? sha256("") : null,
    linkTargetHex: kind === "symlink" ? "ff" : null,
    acl: { encoding: "darwin-acl-copy-ext", valueHex: "", sha256: sha256("") },
    xattrs: [],
  };
}
function both(entries: NativeScanEntry[]): NativeScanRecord[] {
  return [
    ...entries,
    ...entries.map((item) => ({ ...item, pass: 2 as const })),
  ];
}
function assemble(records: NativeScanRecord[]) {
  return assembleNativeInventory({
    rootPathHex: "2f66697874757265",
    adapter: {
      platform: "darwin",
      sourceSha256: sha256("source"),
      executableSha256: sha256("binary"),
    },
    records,
  });
}

test("portable schema and aggregation preserve raw non-UTF8 paths and ns integers exactly", () => {
  const raw = entry("fffe", "file");
  const records = both([entry(), raw]);
  for (const value of records) assert(validateScanRecord(value));
  const a = assemble(records);
  const b = assemble([...records].reverse());
  assert(validateNativeInventory(a));
  assert.equal(a.complete, true);
  assert.equal(a.entries[1]?.pathHex, "fffe");
  assert.equal(a.entries[1]?.before.birthtimeNs, "-1234567890123456789");
  assert.equal(a.sourceFingerprint, b.sourceFingerprint);
  const reordered = structuredClone(records);
  for (const row of reordered)
    if (row.record === "entry") {
      row.before = Object.fromEntries(
        Object.entries(row.before).reverse(),
      ) as NativeStat;
      if (row.after !== null)
        row.after = Object.fromEntries(
          Object.entries(row.after).reverse(),
        ) as NativeStat;
    }
  assert.equal(assemble(reordered).sourceFingerprint, a.sourceFingerprint);
  assert.equal(validateScanRecord({ ...raw, pathHex: "ffg0" }), false);
  assert.equal(validateScanRecord({ ...raw, unrecognized: true }), false);
});

test("portable boundary refuses invalid membership, metadata payloads and changed sources", () => {
  const child = entry("66696c65", "file");
  const cases: NativeScanRecord[][] = [
    both([entry(), entry("2e2e2f657363617065", "file")]),
    both([entry(), entry("6469722f66696c65", "file")]),
    both([entry(), child, child]),
    both([entry(), entry("61"), entry("62")]),
    [entry(), child, { ...entry(), pass: 2 }],
    both([entry(), { ...child, after: { ...child.before, ctimeNs: "999" } }]),
    both([
      entry(),
      {
        ...child,
        xattrs: [
          {
            nameHex: "61747472",
            payload: { valueHex: "ff", sha256: sha256("wrong") },
          },
        ],
      },
    ]),
  ];
  for (const records of cases) {
    const report = assemble(records);
    assert.equal(report.outcome, "refused");
    assert.equal(report.sourceFingerprint, null);
  }
});

test("portable missing metadata, data, dataless and unknown kinds remain incomplete", () => {
  const file = entry("66696c65", "file");
  const cases = [
    { ...file, acl: null },
    { ...file, xattrs: null },
    { ...file, dataSha256: null },
    { ...file, kind: "unknown" as const, dataSha256: null },
    {
      ...file,
      before: { ...file.before, flags: 0x40000000 },
      after: { ...file.before, flags: 0x40000000 },
    },
  ];
  for (const value of cases) {
    const report = assemble(both([entry(), value]));
    assert.equal(report.complete, false);
    assert.equal(report.sourceFingerprint, null);
  }
  for (const kind of [
    "fifo",
    "character-device",
    "block-device",
    "socket",
  ] as const) {
    const value = entry("7370656369616c", kind);
    value.acl = null;
    value.xattrs = null;
    const report = assemble(both([entry(), value]));
    assert.equal(report.outcome, "incomplete");
    assert.equal(report.entries[1]?.kind, kind);
    assert.equal(report.entries[1]?.dataSha256, null);
  }
});

test("portable diagnostics stay bounded and cannot authorize a snapshot", () => {
  const report = assemble(
    Array.from({ length: 1000 }, () => ({
      record: "diagnostic" as const,
      pass: 1 as const,
      pathHex: "",
      code: "source-changed",
      errno: 0,
    })),
  );
  assert.equal(report.outcome, "refused");
  assert.equal(report.diagnostics.length, 128);
  assert.equal(report.omittedDiagnostics, 873);
});

test("portable access time observations do not change source fingerprint", () => {
  const records = both([entry()]);
  const a = assemble(records);
  for (const row of records)
    if (row.record === "entry") {
      row.before = { ...row.before, atimeNs: "1" };
      if (row.after) row.after = { ...row.after, atimeNs: "2" };
    }
  assert.equal(assemble(records).sourceFingerprint, a.sourceFingerprint);
});
