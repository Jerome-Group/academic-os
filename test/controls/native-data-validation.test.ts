import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readControls,
  type ModuleDataControl,
} from "../../src/controls/index.js";
import { moduleCode } from "./fixtures.js";
import {
  controlFor,
  evidence,
  known,
  moduleDataControls,
  moduleDataFixture,
  unknown,
} from "./module-data-fixtures.js";

type Edit = (controls: ModuleDataControl[]) => void;
function alternative(value: string) {
  return {
    value,
    evidence: evidence(),
    reasoning: "Retained alternative observation",
  };
}
function artifact(controls: ModuleDataControl[]) {
  const value = controlFor(controls, "artifacts").artifacts[0];
  assert.ok(value);
  return value;
}
function entry(controls: ModuleDataControl[]) {
  const value = artifact(controls).representation.entries[0];
  assert.ok(value);
  return value;
}
function result(edit: Edit) {
  const controls = moduleDataControls();
  edit(controls);
  return readControls({ moduleCode, files: moduleDataFixture(controls) });
}
function refuses(edit: Edit, code: string) {
  const observed = result(edit);
  assert.equal(
    observed.kind,
    "unsupported",
    JSON.stringify(observed.diagnostics),
  );
  assert.ok(
    observed.diagnostics.some((item) => item.code === code),
    JSON.stringify(observed.diagnostics),
  );
}
function directory(controls: ModuleDataControl[]) {
  const root = entry(controls);
  root.kind = "directory";
  root.pathBytesBase64 = Buffer.from("native").toString("base64");
  const first: ReturnType<typeof entry> = {
    ...structuredClone(root),
    kind: "file" as const,
    pathBytesBase64: Buffer.from("native/a").toString("base64"),
    hardlinkGroup: known("inode-1"),
  };
  const second: ReturnType<typeof entry> = {
    ...structuredClone(first),
    pathBytesBase64: Buffer.from("native/b").toString("base64"),
  };
  const representation = artifact(controls).representation;
  representation.kind = "directory";
  representation.entries = [root, first, second];
  return { root, first, second };
}

describe("native representation consistency through the public control owner", () => {
  for (const bytes of [
    "%%%not-base64",
    "YQ",
    "YR==",
    "",
    Buffer.from("a\0b").toString("base64"),
  ]) {
    it(`refuses malformed or impossible raw name and link bytes ${JSON.stringify(bytes)}`, () => {
      refuses((controls) => {
        entry(controls).xattrs = {
          kind: "known",
          entries: [
            {
              nameBytesBase64: bytes,
              valueSha256: "1".repeat(64),
              byteLength: 0,
            },
          ],
          evidence: evidence(),
        };
      }, "invalid-control-schema");
      refuses((controls) => {
        artifact(controls).representation.kind = "symlink";
        const item = entry(controls);
        item.kind = "symlink";
        item.symlinkTargetBytesBase64 = known(bytes);
      }, "invalid-control-schema");
    });
  }
  it("refuses repeated raw xattr names even when their values agree", () => {
    for (const hash of ["1", "2"])
      refuses((controls) => {
        entry(controls).xattrs = {
          kind: "known",
          entries: ["1", hash].map((value) => ({
            nameBytesBase64: Buffer.from("user.same").toString("base64"),
            valueSha256: value.repeat(64),
            byteLength: 0,
          })),
          evidence: evidence(),
        };
      }, "duplicate-native-xattr-name");
  });
  it("retains internal, external, dangling, nonUTF8 and disputed link targets without traversal", () => {
    for (const target of [
      Buffer.from("../inside"),
      Buffer.from("/external/missing"),
      Buffer.from("missing"),
      Buffer.from([255, 47, 97]),
    ]) {
      const observed = result((controls) => {
        artifact(controls).representation.kind = "symlink";
        const item = entry(controls);
        item.kind = "symlink";
        item.pathBytesBase64 = Buffer.from([254]).toString("base64");
        item.symlinkTargetBytesBase64 = {
          kind: "disputed",
          alternatives: [
            alternative(target.toString("base64")),
            alternative(Buffer.from("alternative").toString("base64")),
          ],
        };
        item.xattrs = {
          kind: "known",
          entries: [
            {
              nameBytesBase64: Buffer.from([255]).toString("base64"),
              valueSha256: "1".repeat(64),
              byteLength: 0,
            },
          ],
          evidence: evidence(),
        };
      });
      assert.equal(
        observed.kind,
        "canonical",
        JSON.stringify(observed.diagnostics),
      );
    }
  });
  it("requires one raw ancestor root with a coherent kind and single entry leaves", () => {
    refuses((controls) => {
      artifact(controls).representation.kind = "symlink";
    }, "conflicting-native-representation-root");
    refuses((controls) => {
      directory(controls).root.kind = "file";
    }, "conflicting-native-representation-root");
    refuses((controls) => {
      directory(controls).second.pathBytesBase64 =
        Buffer.from("elsewhere").toString("base64");
    }, "conflicting-native-representation-root");
    refuses((controls) => {
      directory(controls);
      artifact(controls).representation.kind = "file";
    }, "conflicting-native-representation-root");
    const observed = result((controls) => {
      directory(controls);
      artifact(controls).representation.entries.reverse();
    });
    assert.equal(
      observed.kind,
      "canonical",
      JSON.stringify(observed.diagnostics),
    );
  });
  it("requires every nonroot immediate parent to be an included directory without following links", () => {
    for (const kind of ["missing", "file", "symlink", "special"] as const)
      refuses((controls) => {
        const { root, first, second } = directory(controls);
        first.pathBytesBase64 = Buffer.from("native/a").toString("base64");
        second.pathBytesBase64 =
          Buffer.from("native/a/child").toString("base64");
        if (kind === "missing")
          artifact(controls).representation.entries = [root, second];
        else {
          first.kind = kind;
          if (kind === "symlink")
            first.symlinkTargetBytesBase64 = known(
              Buffer.from("/external").toString("base64"),
            );
          if (kind === "special") first.specialType = known("fifo");
        }
      }, "invalid-native-entry-parent");
    const observed = result((controls) => {
      const { first, second } = directory(controls);
      first.kind = "directory";
      first.hardlinkGroup = unknown();
      first.pathBytesBase64 = Buffer.concat([
        Buffer.from("native/"),
        Buffer.from([255]),
      ]).toString("base64");
      second.pathBytesBase64 = Buffer.concat([
        Buffer.from("native/"),
        Buffer.from([255, 47, 254]),
      ]).toString("base64");
    });
    assert.equal(
      observed.kind,
      "canonical",
      JSON.stringify(observed.diagnostics),
    );
  });

  it("refuses known hardlink data and inode metadata conflicts while accepting unknown or disputed evidence", () => {
    for (const field of [
      "data",
      "mode",
      "flags",
      "mtimeNanoseconds",
      "birthtimeNanoseconds",
      "acl",
    ] as const) {
      refuses((controls) => {
        const { first, second } = directory(controls);
        if (field === "data") {
          first.data = known("1".repeat(64));
          second.data = known("2".repeat(64));
        } else if (field === "mode" || field === "flags") {
          first[field] = known(1);
          second[field] = known(2);
        } else if (field === "acl") {
          first.acl = { kind: "known", value: ["allow"], evidence: evidence() };
          second.acl = { kind: "known", value: ["deny"], evidence: evidence() };
        } else {
          first[field] = known("1");
          second[field] = known("2");
        }
      }, "conflicting-native-hardlink");
    }
    const observed = result((controls) => {
      const { first, second } = directory(controls);
      first.data = known("1".repeat(64));
      second.data = {
        kind: "disputed",
        alternatives: [
          alternative("1".repeat(64)),
          alternative("2".repeat(64)),
        ],
      };
      first.mode = known(420);
      second.mode = unknown();
    });
    assert.equal(
      observed.kind,
      "canonical",
      JSON.stringify(observed.diagnostics),
    );
  });
  it("compares inode metadata values independently of evidence and xattr ordering", () => {
    const attribute = (name: string) => ({
      nameBytesBase64: Buffer.from(name).toString("base64"),
      valueSha256: "1".repeat(64),
      byteLength: 0,
    });
    const observed = result((controls) => {
      const { first, second } = directory(controls);
      first.xattrs = {
        kind: "known",
        entries: [attribute("user.a"), attribute("user.b")],
        evidence: evidence(),
      };
      second.xattrs = {
        kind: "known",
        entries: [attribute("user.b"), attribute("user.a")].map((item) => ({
          byteLength: item.byteLength,
          valueSha256: item.valueSha256,
          nameBytesBase64: item.nameBytesBase64,
        })),
        evidence: evidence(),
      };
      first.resourceFork = second.resourceFork = {
        kind: "present",
        byteSha256: "2".repeat(64),
        byteLength: 0,
        evidence: evidence(),
      };
    });
    assert.equal(
      observed.kind,
      "canonical",
      JSON.stringify(observed.diagnostics),
    );
    for (const field of ["xattrs", "resourceFork"] as const)
      refuses((controls) => {
        const { first, second } = directory(controls);
        if (field === "xattrs") {
          first.xattrs = {
            kind: "known",
            entries: [attribute("user.a")],
            evidence: evidence(),
          };
          second.xattrs = { kind: "known", entries: [], evidence: evidence() };
        } else {
          first.resourceFork = { kind: "absent", evidence: evidence() };
          second.resourceFork = {
            kind: "present",
            byteSha256: "2".repeat(64),
            byteLength: 0,
            evidence: evidence(),
          };
        }
      }, "conflicting-native-hardlink");
  });

  it("refuses cycles among native bundle memberships and accepts an acyclic bundle graph", () => {
    for (const cyclic of [true, false]) {
      const observed = result((controls) => {
        const first = artifact(controls);
        first.representation.kind = "native-bundle";
        entry(controls).kind = "directory";
        const second = structuredClone(first);
        second.id = "artifact:second";
        second.path = "native/second";
        first.representation.bundleMembers = [
          { kind: "artifact", id: second.id },
        ];
        second.representation.bundleMembers = cyclic
          ? [{ kind: "artifact", id: first.id }]
          : [];
        controlFor(controls, "artifacts").artifacts.push(second);
      });
      assert.equal(
        observed.kind,
        cyclic ? "unsupported" : "canonical",
        JSON.stringify(observed.diagnostics),
      );
      if (cyclic)
        assert.ok(
          observed.diagnostics.some(
            (item) => item.code === "native-bundle-cycle",
          ),
        );
    }
  });
  it("validates calendar dates and integer nanoseconds only in their typed claims", () => {
    for (const value of [
      "2026-99-99",
      "2025-02-29",
      "1900-02-29",
      "2026-04-31",
      "2026-1-01",
    ])
      refuses((controls) => {
        const record = controlFor(controls, "learning-records").records[1];
        assert.ok(record?.kind === "current");
        record.date = known(value);
      }, "invalid-control-schema");
    for (const value of ["2024-02-29", "2000-02-29", "1900-02-28"]) {
      const observed = result((controls) => {
        const record = controlFor(controls, "learning-records").records[1];
        assert.ok(record?.kind === "current");
        record.date = known(value);
        entry(controls).birthtimeNanoseconds = known("-12345678901234567890");
        entry(controls).mtimeNanoseconds = known("0");
      });
      assert.equal(
        observed.kind,
        "canonical",
        JSON.stringify(observed.diagnostics),
      );
    }
    for (const value of ["yesterday", "1.5", "01", "+1", "-0"])
      refuses((controls) => {
        entry(controls).mtimeNanoseconds = known(value);
      }, "invalid-control-schema");
  });
});
