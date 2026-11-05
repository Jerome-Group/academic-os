import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  ConfigurationError,
  parseConfig,
  validateConfig,
} from "../../src/config/index.js";

const base = { driveMount: "/synthetic/Drive", stateRoot: "/synthetic/State" };
const local = {
  ...base,
  semester: "Y2S1",
  module: "MH2100",
  semesterRoots: { Y2S1: "Modules/Y2S1" },
};
const academic = {
  ...base,
  activeSemester: "Y2S1",
  semesters: {
    Y2S1: { root: "Modules/Y2S1", status: "active", modules: ["MH2100"] },
  },
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
function refused(value: unknown, code = "invalid-config-value") {
  assert.throws(
    () => validateConfig(value),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      error.code === "invalid-config" &&
      error.diagnostics.some((item) => item.code === code),
  );
}

describe("schema-derived configuration boundary", () => {
  it("keeps committed runtime schemas and generated declarations derived from the source schema", () => {
    execFileSync(
      process.execPath,
      ["scripts/generate-config-types.mjs", "--check"],
      { cwd: process.cwd(), stdio: "pipe" },
    );
  });
  it("preserves supported local, cohort and service objects, order and optional defaults", async () => {
    const example: unknown = JSON.parse(
      await readFile(
        new URL("../../../academic-os.config.example.json", import.meta.url),
        "utf8",
      ),
    );
    for (const config of [base, local, academic, validateConfig(example)]) {
      assert.deepEqual(parseConfig(bytes(config)), config);
      assert.deepEqual(parseConfig(bytes({ ...config, schemaVersion: 1 })), {
        ...config,
        schemaVersion: 1,
      });
    }
  });

  it("rejects partial local/cohort declarations instead of interpreting them as service config", () => {
    for (const key of [
      "semester",
      "module",
      "semesterRoots",
      "activeSemester",
      "semesters",
    ])
      refused({ ...base, [key]: "incomplete" });
    refused({ ...local, ...academic }, "conflicting-config-shapes");
    for (const schemaVersion of [0, 2, "1", null, {}, 1.5])
      refused({ ...local, schemaVersion }, "unsupported-config-version");
  });

  it("validates every nested owner and rejects unknown fields without reflecting supplied data", () => {
    const secret = "synthetic-credential-value-keep-private";
    const cases = [
      {
        ...base,
        calendar: {
          managementHorizon: "not-an-instant",
          credentials: { scheduledRead: "/read", interactiveWrite: "/write" },
        },
      },
      {
        ...base,
        calendar: {
          managementHorizon: "2026-01-01",
          credentials: { scheduledRead: secret, interactiveWrite: "/write" },
        },
      },
      {
        ...base,
        tasks: {
          credentials: {
            scheduledRead: "/read",
            interactiveWrite: "/write",
            [secret]: secret,
          },
        },
      },
      { ...base, routine: { codexPath: "/codex", ghPath: false } },
      { ...base, textbooks: { shelfRoot: 3 } },
      {
        ...academic,
        semesters: {
          privateKey: { root: "Modules", status: "wrong", modules: [] },
        },
      },
      {
        ...academic,
        research: {
          root: "Research",
          projects: { privateKey: { folder: "Project", status: "active" } },
        },
      },
      { ...academic, seedTarget: { semester: "Y2S1", module: "wrong" } },
      { ...academic, driveApi: { moduleFolderIds: { Y2S1: { MH2100: [] } } } },
      { ...academic, repair: { driveRecoveryRootId: "id" } },
      {
        ...base,
        tasks: {
          credentials: { scheduledRead: "/read", interactiveWrite: "/write" },
          planning: { [secret]: secret },
        },
      },
    ];
    for (const config of cases) {
      assert.throws(
        () => parseConfig(bytes(config)),
        (error: unknown) => {
          assert.ok(error instanceof ConfigurationError);
          assert.ok(error.diagnostics.length);
          assert.equal(JSON.stringify(error).includes(secret), false);
          assert.equal(error.message.includes(secret), false);
          assert.equal(
            JSON.stringify(error.diagnostics).includes("privateKey"),
            false,
          );
          return true;
        },
      );
    }
  });

  it("accepts supported service settings and exact task producer pinning without injecting defaults", () => {
    const value = {
      ...base,
      calendar: {
        managementHorizon: "2026-08-01T08:00:00+08:00",
        credentials: { scheduledRead: "/read", interactiveWrite: "/write" },
      },
      tasks: {
        credentials: {
          scheduledRead: "/tasks-read",
          interactiveWrite: "/tasks-write",
        },
        planning: {
          releaseRoot: "/release",
          privateRoot: "/private",
          manifestSha256: "a".repeat(64),
          sourceCommit: "b".repeat(40),
          environment: "test",
          accountId: "fixture",
          sourceIdentity: "fixture",
          catalogSourcePath: "/catalog",
        },
      },
    };
    assert.deepEqual(parseConfig(bytes(value)), value);
    refused({
      ...value,
      tasks: {
        ...value.tasks,
        planning: { ...value.tasks.planning, sourceCommit: "not-pinned" },
      },
    });
  });

  it("refuses malformed, duplicate, unsafe numeric and non-scalar UTF-8 JSON bytes with no payload in diagnostics", () => {
    for (const source of [
      "{",
      "[]",
      '{"driveMount":"/a","driveMount":"/secret"}',
      '{"a":1,"\\u0061":2}',
      '{"secret":"\\ud800"}',
      '{"schemaVersion":9007199254740993}',
      '{"schemaVersion":1e400}',
      '{"schemaVersion":-0}',
      "\ufeff{}",
    ]) {
      assert.throws(() => parseConfig(Buffer.from(source)), ConfigurationError);
    }
    assert.throws(
      () =>
        parseConfig(Uint8Array.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125])),
      ConfigurationError,
    );
  });
});
