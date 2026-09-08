import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  codexSessionArguments,
  createCodexModuleSession,
  MODULE_PASS_SCHEMA,
  MORNING_SESSION_AUDIT_AFTER_FILENAME,
  MORNING_SESSION_AUDIT_BEFORE_FILENAME,
  MORNING_SESSION_MODEL,
  MORNING_SESSION_ORIGINAL_CONTROLS_DIRECTORY,
  MORNING_SESSION_REASONING_EFFORT,
  MORNING_SESSION_SANDBOX,
  MORNING_SESSION_VALIDATED_OUTCOME_FILENAME,
  MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
  MORNING_SESSION_WORK_ORDER_FILENAME,
  WRITE_JOURNAL_FILENAME,
  sessionSpawnOptions,
} from "../../src/routine/index.js";
import {
  moduleControlContents,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { universalPaths } from "../fixtures/universal-structure.js";

const arguments_ = codexSessionArguments({
  prompt: "the morning's prompt",
  schemaPath: "/state/routine/sessions/2026-08-23/AB1234/result-schema.json",
  resultPath: "/state/routine/sessions/2026-08-23/AB1234/result.json",
  writeJournalDirectory:
    "/state/routine/sessions/2026-08-23/AB1234/write-journal",
});

function flagValue(flag: string): string | undefined {
  return arguments_[arguments_.indexOf(flag) + 1];
}

describe("the Codex invocation a module pass runs under", () => {
  it("runs headless, on the named model at the named effort", () => {
    assert.equal(arguments_[0], "exec");
    assert.equal(MORNING_SESSION_MODEL, "gpt-6-astra");
    assert.equal(MORNING_SESSION_REASONING_EFFORT, "medium");
    assert.ok(
      arguments_.includes("--model") &&
        arguments_[arguments_.indexOf("--model") + 1] === MORNING_SESSION_MODEL,
    );
    assert.ok(
      arguments_.some(
        (argument) =>
          argument ===
          `model_reasoning_effort="${MORNING_SESSION_REASONING_EFFORT}"`,
      ),
    );
  });

  // The pass runs from a LaunchAgent, whose PATH holds none of the tools a Codex installation ships
  // beside its binary. Both unsupervised mornings searched with `command not found: rg` in every
  // module because this environment was built and never handed to the spawn, and the prompt had
  // already been sharpened to stop a pass reporting that as a failure — so nothing said so.
  it("searches with the tools shipped beside the Codex binary", () => {
    const options = sessionSpawnOptions({
      codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
      moduleRoot: "/mount/Modules/Y2S1/AB1234",
    });
    const path = options.env.PATH ?? "";
    assert.equal(
      path.split(delimiter)[0],
      "/Applications/ChatGPT.app/Contents/Resources",
    );
    assert.ok(
      path.split(delimiter).length > 1,
      "the machine's own PATH is kept behind it, not replaced.",
    );
  });

  // Stdin closed rather than inherited: `codex exec` reads it, and an open pipe with nothing coming
  // holds the session — and behind it, the rest of the cohort — until the timeout.
  it("runs in the module folder, with stdin closed and a timeout", () => {
    const options = sessionSpawnOptions({
      codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
      moduleRoot: "/mount/Modules/Y2S1/AB1234",
    });
    assert.equal(options.cwd, "/mount/Modules/Y2S1/AB1234");
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    assert.ok(options.timeout > 0);
  });

  it("gets the module folder to write in and nothing wider", () => {
    assert.equal(MORNING_SESSION_SANDBOX, "workspace-write");
    assert.equal(flagValue("--sandbox"), MORNING_SESSION_SANDBOX);
    assert.equal(
      flagValue("--add-dir"),
      "/state/routine/sessions/2026-08-23/AB1234/write-journal",
    );
  });

  // Which buckets the schema demands is `module-pass-buckets.test.ts`'s question, held there against
  // every other copy of the list at once.
  it("has the harness enforce the report's shape and write it down", () => {
    assert.equal(
      flagValue("--output-schema"),
      "/state/routine/sessions/2026-08-23/AB1234/result-schema.json",
    );
    assert.equal(
      flagValue("--output-last-message"),
      "/state/routine/sessions/2026-08-23/AB1234/result.json",
    );
  });

  it("names every property in `required`, which structured-output mode insists on", () => {
    const unsatisfied: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object" && typeof schema.properties === "object") {
        const properties = Object.keys(
          schema.properties as Record<string, unknown>,
        );
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const property of properties) {
          if (!required.includes(property)) {
            unsatisfied.push(`${path}.${property}`);
          }
        }
      }
      for (const [key, value] of Object.entries(schema)) {
        walk(value, `${path}.${key}`);
      }
    };

    walk(JSON.parse(JSON.stringify(MODULE_PASS_SCHEMA)), "schema");

    assert.deepEqual(
      unsatisfied,
      [],
      "an optional field is offered as null and listed in `required`, never omitted",
    );
  });

  it("demands of the harness exactly what the parser demands, so neither can accept what the other refuses", () => {
    const schema = JSON.parse(JSON.stringify(MODULE_PASS_SCHEMA));

    // Structured-output mode requires every property to be listed, so an absent destination is
    // offered as null rather than omitted.
    assert.deepEqual(schema.properties.superseded.items.required, [
      "item",
      "destination",
    ]);
    assert.deepEqual(
      schema.properties.superseded.items.properties.destination.type,
      ["string", "null"],
    );
    assert.deepEqual(schema.properties.curated.items.required, [
      "item",
      "destination",
    ]);
    const nonEmptyFields: Array<[string, string]> = [
      ["curated", "item"],
      ["curated", "destination"],
      ["parked", "evidence"],
      ["docWrites", "summary"],
      ["failures", "message"],
      ["noted", "item"],
      ["noted", "note"],
    ];
    for (const [bucket, field] of nonEmptyFields) {
      assert.equal(
        schema.properties[bucket].items.properties[field].minLength,
        1,
        `${bucket}.${field} must refuse the empty string`,
      );
    }
  });

  it("expects a module folder rather than a checkout, and ends on the prompt", () => {
    assert.ok(arguments_.includes("--skip-git-repo-check"));
    assert.equal(arguments_.at(-1), "the morning's prompt");
  });
});

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("the module maintenance session", () => {
  it("persists before evidence and exact controls, inlines a full work order, then audits the result", async () => {
    const { config, moduleRoot, stateRoot } = await maintenanceFixture();
    const sourceMapPath = join(
      moduleRoot,
      "00 Module Admin",
      "40 Source Map.yaml",
    );
    const originalSourceMap = await readFile(sourceMapPath);
    let invoked = false;
    let clockCalls = 0;
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () =>
        new Date(
          clockCalls++ === 0
            ? "2026-08-22T22:00:00.000Z"
            : "2026-08-22T22:10:00.000Z",
        ),
      runner: async ({ arguments: arguments_, moduleRoot: cwd }) => {
        invoked = true;
        assert.equal(cwd, await realpath(moduleRoot));
        const resultPath =
          arguments_[arguments_.indexOf("--output-last-message") + 1];
        assert.ok(resultPath);
        const artifacts = dirname(resultPath);
        const workOrder = JSON.parse(
          await readFile(
            join(artifacts, MORNING_SESSION_WORK_ORDER_FILENAME),
            "utf8",
          ),
        ) as {
          observedAt: string;
          domains: Array<{ domain: string }>;
          audit: { proposedDirectories: string[] };
          imports: { roots: Array<{ status: string }> };
          writeJournalDirectory: string;
          writeJournalPath: string;
        };
        assert.equal(workOrder.observedAt, "2026-08-22T22:00:00.000Z");
        assert.equal(workOrder.imports.roots[0]?.status, "current");
        assert.equal(
          workOrder.domains.length,
          syntheticMaintenanceCoverage().length,
        );
        assert.equal(
          workOrder.writeJournalDirectory,
          join(artifacts, MORNING_SESSION_WRITE_JOURNAL_DIRECTORY),
        );
        assert.equal(
          workOrder.writeJournalPath,
          join(
            artifacts,
            MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
            "operations.jsonl",
          ),
        );
        assert.ok(
          workOrder.audit.proposedDirectories.includes(
            "30 Assessments/10 Quizzes",
          ),
        );
        await readFile(
          join(artifacts, MORNING_SESSION_AUDIT_BEFORE_FILENAME),
          "utf8",
        );
        assert.deepEqual(
          await readFile(
            join(
              artifacts,
              MORNING_SESSION_ORIGINAL_CONTROLS_DIRECTORY,
              "00 Module Admin",
              "40 Source Map.yaml",
            ),
          ),
          originalSourceMap,
        );
        const prompt = arguments_.at(-1) ?? "";
        assert.match(prompt, /<maintenance-work-order>/u);
        assert.match(prompt, /"learningSources"/u);
        assert.match(prompt, /"documentation-lifecycle"/u);

        await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
        await writeSuccessfulJournal(
          join(
            artifacts,
            MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
            WRITE_JOURNAL_FILENAME,
          ),
          "30 Assessments/10 Quizzes",
          "create-directory",
        );
        await writeFile(
          resultPath,
          `${JSON.stringify({
            maintenance: syntheticMaintenanceCoverage(),
            curated: [
              {
                item: "NTULearn/synthetic.pdf",
                destination:
                  "10 Learning Materials/10 Lecture Materials/synthetic.pdf",
              },
            ],
            rederived: [],
            superseded: [],
            withdrawn: [],
            parked: [],
            docWrites: [],
            failures: [],
            noted: [],
          })}\n`,
        );
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(invoked, true);
    assert.equal(result.curated.length, 1, JSON.stringify(result.failures));
    assert.equal(
      result.failures.some(({ code }) => code === "import-status-noncurrent"),
      false,
    );
    const after = JSON.parse(
      await readFile(
        join(result.artifacts, MORNING_SESSION_AUDIT_AFTER_FILENAME),
        "utf8",
      ),
    ) as {
      observedAt: string;
      comparison: { resolved: Array<{ path: string }> };
    };
    assert.equal(after.observedAt, "2026-08-22T22:10:00.000Z");
    assert.ok(
      after.comparison.resolved.some(
        ({ path }) => path === "30 Assessments/10 Quizzes",
      ),
    );
    assert.ok(
      result.artifacts.startsWith(
        join(
          stateRoot,
          "routine",
          "sessions",
          "2026-08-23",
          "MH2100",
          "attempt-",
        ),
      ),
    );
  });

  it("continues maintenance but raises a machine failure for a stale importer", async () => {
    const { config, moduleRoot } = await maintenanceFixture();
    await writeFile(
      join(moduleRoot, "NTULearn", "Sync status.json"),
      JSON.stringify({
        schemaVersion: 1,
        producer: "ntulearn",
        status: "complete",
        startedAt: "2026-08-19T21:00:00.000Z",
        finishedAt: "2026-08-19T21:05:00.000Z",
        lastSuccessfulAt: "2026-08-19T21:05:00.000Z",
        counts: {
          downloaded: 0,
          skipped: 0,
          markdown: 0,
          uncopied: 0,
          failures: 0,
        },
        unread: [],
      }),
    );
    let invoked = false;
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date("2026-08-22T22:00:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        invoked = true;
        const prompt = arguments_.at(-1) ?? "";
        assert.match(prompt, /"status": "stale"/u);
        assert.match(prompt, /do not infer withdrawals/u);
        const resultPath =
          arguments_[arguments_.indexOf("--output-last-message") + 1];
        assert.ok(resultPath);
        await writeFile(
          resultPath,
          JSON.stringify({
            maintenance: syntheticMaintenanceCoverage(),
            curated: [],
            rederived: [],
            superseded: [],
            withdrawn: [],
            parked: [],
            docWrites: [],
            failures: [],
            noted: [],
          }),
        );
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(invoked, true);
    assert.ok(
      result.failures.some(({ code }) => code === "import-status-noncurrent"),
    );
    assert.equal(
      result.maintenance.length,
      syntheticMaintenanceCoverage().length,
    );
  });

  it("keeps each same-day attempt's own original control bytes", async () => {
    const { config, moduleRoot } = await maintenanceFixture();
    const sourceMapPath = join(
      moduleRoot,
      "00 Module Admin",
      "40 Source Map.yaml",
    );
    const bomContents = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      await readFile(sourceMapPath),
    ]);
    await writeFile(sourceMapPath, bomContents);
    const firstContents = await readFile(sourceMapPath);
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date("2026-08-22T22:00:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        const resultPath =
          arguments_[arguments_.indexOf("--output-last-message") + 1];
        assert.ok(resultPath);
        await writeFile(
          resultPath,
          JSON.stringify({
            maintenance: syntheticMaintenanceCoverage(),
            curated: [],
            rederived: [],
            superseded: [],
            withdrawn: [],
            parked: [],
            docWrites: [],
            failures: [],
            noted: [],
          }),
        );
        return 0;
      },
    });

    const first = await session.run({ semester: "Y2S1", module: "MH2100" });
    const secondContents = Buffer.from("units: {}\n# second attempt\n");
    await writeFile(sourceMapPath, secondContents);
    const second = await session.run({ semester: "Y2S1", module: "MH2100" });
    const snapshotPath = (artifacts: string) =>
      join(
        artifacts,
        MORNING_SESSION_ORIGINAL_CONTROLS_DIRECTORY,
        "00 Module Admin",
        "40 Source Map.yaml",
      );

    assert.notEqual(first.artifacts, second.artifacts);
    assert.deepEqual(
      await readFile(snapshotPath(first.artifacts)),
      firstContents,
    );
    assert.deepEqual(
      await readFile(snapshotPath(second.artifacts)),
      secondContents,
    );
  });

  it("runs one fresh correction attempt, shares the deadline, and retains earlier successful buckets", async () => {
    const { config, moduleRoot, stateRoot } = await maintenanceFixture();
    let calls = 0;
    const time = [
      "2026-08-22T22:00:00.000Z",
      "2026-08-22T22:01:00.000Z",
      "2026-08-22T22:02:00.000Z",
      "2026-08-22T22:03:00.000Z",
      "2026-08-22T22:04:00.000Z",
      "2026-08-22T22:05:00.000Z",
      "2026-08-22T22:06:00.000Z",
      "2026-08-22T22:07:00.000Z",
    ];
    const timeouts: number[] = [];
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date(time.shift() ?? "2026-08-22T22:19:00.000Z"),
      runner: async ({ arguments: arguments_, timeoutMs }) => {
        calls += 1;
        timeouts.push(timeoutMs);
        const resultPath = flagFrom(arguments_, "--output-last-message");
        const artifacts = dirname(resultPath);
        if (calls === 2) {
          assert.match(arguments_.at(-1) ?? "", /Bounded correction attempt/u);
          await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
          await writeSuccessfulJournal(
            join(
              artifacts,
              MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
              WRITE_JOURNAL_FILENAME,
            ),
            "30 Assessments/10 Quizzes",
            "create-directory",
          );
        }
        await writeFile(
          resultPath,
          JSON.stringify(
            passOutcome({
              noted: [
                {
                  item: `attempt-${calls}`,
                  note: `successful observation ${calls}`,
                },
              ],
            }),
          ),
        );
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(calls, 2);
    assert.ok((timeouts[0] ?? 0) > (timeouts[1] ?? Number.MAX_SAFE_INTEGER));
    assert.deepEqual(
      result.noted.map(({ item }) => item),
      ["attempt-1", "attempt-2"],
    );
    assert.equal(
      result.failures.some(({ code }) => code.startsWith("post-audit-")),
      false,
    );
    const attemptRoot = join(
      stateRoot,
      "routine",
      "sessions",
      "2026-08-23",
      "MH2100",
    );
    const attempts = (await readdir(attemptRoot)).filter((name) =>
      name.startsWith("attempt-"),
    );
    assert.equal(attempts.length, 2);
    for (const attempt of attempts)
      await readFile(
        join(attemptRoot, attempt, MORNING_SESSION_VALIDATED_OUTCOME_FILENAME),
        "utf8",
      );
  });

  it("does not retry a missing write journal", async () => {
    const { config } = await maintenanceFixture();
    let calls = 0;
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date("2026-08-22T22:00:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        calls += 1;
        const resultPath = flagFrom(arguments_, "--output-last-message");
        await rm(
          join(
            dirname(resultPath),
            MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
            WRITE_JOURNAL_FILENAME,
          ),
        );
        await writeFile(resultPath, JSON.stringify(passOutcome()));
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(calls, 1);
    assert.ok(
      result.failures.some(({ code }) => code === "write-journal-unreadable"),
    );
  });

  it("rejects an observed control change omitted from an empty journal", async () => {
    const { config, moduleRoot } = await maintenanceFixture();
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date("2026-08-22T22:00:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        await writeFile(
          join(moduleRoot, "00 Module Admin", "40 Source Map.yaml"),
          "units: {}\n# changed without journal\n",
        );
        await writeFile(
          flagFrom(arguments_, "--output-last-message"),
          JSON.stringify(passOutcome()),
        );
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.ok(
      result.failures.some(
        ({ code, message }) =>
          code === "write-journal-invalid" &&
          message.includes("00 Module Admin/40 Source Map.yaml"),
      ),
    );
  });

  it("does not start correction after the original module deadline", async () => {
    const { config } = await maintenanceFixture();
    let calls = 0;
    const time = [
      "2026-08-22T22:00:00.000Z",
      "2026-08-22T22:01:00.000Z",
      "2026-08-22T22:21:00.000Z",
      "2026-08-22T22:22:00.000Z",
    ];
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date(time.shift() ?? "2026-08-22T22:22:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        calls += 1;
        await writeFile(
          flagFrom(arguments_, "--output-last-message"),
          JSON.stringify(passOutcome()),
        );
        return 0;
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(calls, 1);
    assert.ok(
      result.failures.some(({ code }) => code === "post-audit-residual"),
    );
  });

  it("salvages a written report and independently audits after the runner rejects", async () => {
    const { config, moduleRoot } = await maintenanceFixture();
    const session = createCodexModuleSession({
      config,
      codexPath: "/synthetic/codex",
      date: "2026-08-23",
      clock: () => new Date("2026-08-22T22:00:00.000Z"),
      runner: async ({ arguments: arguments_ }) => {
        const resultPath = flagFrom(arguments_, "--output-last-message");
        const artifacts = dirname(resultPath);
        const target = "00 Module Admin/40 Source Map.yaml";
        await writeFile(join(moduleRoot, target), "units: {}\n# salvaged\n");
        await writeSuccessfulJournal(
          join(
            artifacts,
            MORNING_SESSION_WRITE_JOURNAL_DIRECTORY,
            WRITE_JOURNAL_FILENAME,
          ),
          target,
          "replace-file",
        );
        await writeFile(
          resultPath,
          JSON.stringify(
            passOutcome({
              docWrites: [{ file: target, summary: "source map refreshed" }],
            }),
          ),
        );
        throw new Error("synthetic timeout after output");
      },
    });

    const result = await session.run({ semester: "Y2S1", module: "MH2100" });

    assert.equal(result.docWrites.length, 1);
    assert.ok(
      result.failures.some(({ code }) => code === "session-runner-failed"),
    );
    await readFile(
      join(result.artifacts, MORNING_SESSION_AUDIT_AFTER_FILENAME),
      "utf8",
    );
    await readFile(
      join(result.artifacts, MORNING_SESSION_VALIDATED_OUTCOME_FILENAME),
      "utf8",
    );
  });
});

function flagFrom(arguments_: string[], flag: string): string {
  const value = arguments_[arguments_.indexOf(flag) + 1];
  assert.ok(value);
  return value;
}

function passOutcome(
  overrides: Partial<ReturnType<typeof passOutcomeBase>> = {},
): ReturnType<typeof passOutcomeBase> {
  return { ...passOutcomeBase(), ...overrides };
}

function passOutcomeBase() {
  return {
    maintenance: syntheticMaintenanceCoverage(),
    curated: [] as Array<{ item: string; destination: string }>,
    rederived: [] as Array<{ item: string; derived: string[] }>,
    superseded: [] as Array<{ item: string; destination?: string }>,
    withdrawn: [] as Array<{ item: string; evidence: string }>,
    parked: [] as Array<{ item: string; reason: string; evidence: string }>,
    docWrites: [] as Array<{ file: string; summary: string }>,
    failures: [] as Array<{ code: string; message: string }>,
    noted: [] as Array<{ item: string; note: string }>,
  };
}

async function writeSuccessfulJournal(
  path: string,
  target: string,
  operation: "create-directory" | "create-file" | "replace-file",
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      type: "intent",
      id: "fixture-operation",
      path: target,
      operation,
      plannedResult: "fixture change",
      proofs: {
        containment: "fixture realpath containment",
        deliberateTarget: "fixture exclusive target",
        materialization: "fixture materialized bytes",
        freshReading: "fixture fresh listing",
      },
    })}\n${JSON.stringify({
      schemaVersion: 1,
      type: "result",
      id: "fixture-operation",
      path: target,
      operation,
      outcome: "completed",
      actual: "fixture fresh target state",
    })}\n`,
  );
}

async function maintenanceFixture(): Promise<{
  config: {
    driveMount: string;
    stateRoot: string;
    activeSemester: string;
    semesters: {
      Y2S1: { root: string; status: "active"; modules: string[] };
    };
  };
  moduleRoot: string;
  stateRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-routine-session-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const moduleRoot = join(driveMount, "Modules", "Y2S1", "MH2100");
  const controls = moduleControlContents(validModuleControls());
  await mkdir(stateRoot, { recursive: true });
  for (const [relativePath, kind] of [
    ...universalPaths,
    ...learningWorkspacePaths,
  ]) {
    const path = join(moduleRoot, relativePath);
    if (kind === "directory") {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, controls.get(relativePath) ?? "fixture\n");
    }
  }
  await writeFile(
    join(moduleRoot, "NTULearn", "Sync status.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      producer: "ntulearn",
      status: "complete",
      startedAt: "2026-08-22T21:00:00.000Z",
      finishedAt: "2026-08-22T21:05:00.000Z",
      lastSuccessfulAt: "2026-08-22T21:05:00.000Z",
      counts: {
        downloaded: 0,
        skipped: 0,
        markdown: 0,
        uncopied: 0,
        failures: 0,
      },
      unread: [],
    })}\n`,
  );
  return {
    moduleRoot,
    stateRoot,
    config: {
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: {
          root: "Modules/Y2S1",
          status: "active",
          modules: ["MH2100"],
        },
      },
    },
  };
}
