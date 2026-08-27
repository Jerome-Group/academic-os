import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { sha256Bytes } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import {
  type CohortCurationRederivations,
  executeCurationRederivation,
  type ObservedModuleRederivation,
  planCurationRederivation,
} from "../../src/curation/index.js";

// A synthetic tree in an operating-system temporary directory, which is the contract tier of
// `docs/agents/safe-drive-testing.md`. No real module folder is ever a fixture here.
const registerPath = writtenControlPaths.curationRegister;
const now = "2026-08-27T06:00:00.000Z";
const sourcePath = "03 Combined Notes.pdf";
const sourceLocation = `NTULearn/${sourcePath}`;
const itemKey = "ntulearn/Combined Notes.pdf";
const chapterOne = "10 Learning Materials/AB1234_Chapter_01_Notes.pdf";
const chapterTwo = "10 Learning Materials/AB1234_Chapter_02_Notes.pdf";
const wholeCopy = "10 Learning Materials/AB1234_Course_Notes.pdf";

const sourceBytes = Buffer.from("Every chapter, in one document.\n", "utf8");
const chapterOneBytes = Buffer.from("Chapter one, cut out of it.\n", "utf8");
const chapterTwoBytes = Buffer.from("Chapter two, cut out of it.\n", "utf8");

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function curatedLine(destination: string): string {
  return JSON.stringify({
    schema_version: 3,
    source_id: "Combined Notes.pdf",
    integration: "ntulearn",
    role: "lecture",
    source_path: sourcePath,
    checksum: `sha256:${sha256Bytes(sourceBytes)}`,
    decision: "curated",
    destination,
    evidence: "Follows the standing precedent for lecture notes.",
    timestamp: "2026-08-23T20:36:46Z",
  });
}

const splitRegister = `${[chapterOne, chapterTwo, wholeCopy].map(curatedLine).join("\n")}\n`;

function observation(register: string): ObservedModuleRederivation {
  return {
    module: "AB1234",
    semester: "Y2S1",
    register,
    integrations: ["ntulearn"],
    sources: new Map([
      [
        itemKey,
        {
          location: sourceLocation,
          sourcePath,
          sha256: sha256Bytes(sourceBytes),
        },
      ],
    ]),
    artifacts: new Map([
      [chapterOne, sha256Bytes(chapterOneBytes)],
      [chapterTwo, sha256Bytes(chapterTwoBytes)],
      [wholeCopy, sha256Bytes(sourceBytes)],
    ]),
  };
}

async function mountedModule(
  register: string,
): Promise<CohortCurationRederivations> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "academic-os-rederive-")),
  );
  temporaryRoots.push(root);
  const moduleRoot = join(root, "Modules", "Y2S1", "AB1234");
  const stateRoot = join(root, "state");
  for (const [path, bytes] of [
    [registerPath, Buffer.from(register, "utf8")],
    [sourceLocation, sourceBytes],
    [chapterOne, chapterOneBytes],
    [chapterTwo, chapterTwoBytes],
    [wholeCopy, sourceBytes],
  ] as const) {
    const target = join(moduleRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await mkdir(stateRoot, { recursive: true });
  return {
    driveMount: root,
    stateRoot,
    modules: [observation(register)],
    moduleRoots: new Map([["AB1234", moduleRoot]]),
    unresolved: [],
  };
}

function planFor(cohort: CohortCurationRederivations) {
  return planCurationRederivation({ modules: cohort.modules, now });
}

describe("correcting a split source on the mount", () => {
  it("writes nothing in preview and names what it would append", async () => {
    const cohort = await mountedModule(splitRegister);
    const before = await readFile(
      join(cohort.moduleRoots.get("AB1234") ?? "", registerPath),
      "utf8",
    );

    const report = await executeCurationRederivation({
      plan: planFor(cohort),
      cohort,
      mode: "preview",
    });

    assert.equal(report.outcome, "split");
    assert.equal(report.appended, 0);
    assert.equal(report.journal, undefined);
    assert.equal(
      await readFile(
        join(cohort.moduleRoots.get("AB1234") ?? "", registerPath),
        "utf8",
      ),
      before,
    );
    assert.deepEqual(report.modules[0]?.rederivations[0]?.derived, [
      chapterOne,
      chapterTwo,
    ]);
  });

  it("appends one rederived line and leaves every earlier line where it was", async () => {
    const cohort = await mountedModule(splitRegister);

    const report = await executeCurationRederivation({
      plan: planFor(cohort),
      cohort,
      mode: "apply",
    });

    assert.equal(report.outcome, "settled");
    assert.equal(report.appended, 1);
    const written = await readFile(
      join(cohort.moduleRoots.get("AB1234") ?? "", registerPath),
      "utf8",
    );
    assert.equal(written.startsWith(splitRegister), true);
    const lines = written.trimEnd().split("\n");
    assert.equal(lines.length, 4);
    const appended: Record<string, unknown> = JSON.parse(lines[3] ?? "");
    assert.equal(appended.decision, "rederived");
    assert.deepEqual(appended.derived, [chapterOne, chapterTwo]);
    assert.equal(appended.destination, undefined);
    assert.equal(
      appended.supersedes,
      "Combined Notes.pdf@2026-08-23T20:36:46Z",
    );
  });

  it("journals the intent and the result of every append", async () => {
    const cohort = await mountedModule(splitRegister);

    const report = await executeCurationRederivation({
      plan: planFor(cohort),
      cohort,
      mode: "apply",
    });

    assert.ok(report.journal !== undefined);
    const entries = (await readFile(report.journal, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(
      entries.map((entry) => entry.type),
      ["intent", "result"],
    );
    assert.equal(entries[0]?.appended, 1);
    assert.equal(entries[0]?.path, registerPath);
  });

  // Rule 4 of a mounted write. A plan built against a tree that has since moved is a plan about a
  // different tree, and the disagreement refuses the run rather than the one operation.
  it("refuses the run when the register changed after the preview read it", async () => {
    const cohort = await mountedModule(splitRegister);
    const plan = planFor(cohort);
    await writeFile(
      join(cohort.moduleRoots.get("AB1234") ?? "", registerPath),
      `${splitRegister}${curatedLine("10 Learning Materials/AB1234_Chapter_03_Notes.pdf")}\n`,
    );

    const report = await executeCurationRederivation({
      plan,
      cohort,
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.match(report.refusals[0] ?? "", /changed after it was read/u);
  });

  it("refuses the run when the source changed after the preview read it", async () => {
    const cohort = await mountedModule(splitRegister);
    const plan = planFor(cohort);
    await writeFile(
      join(cohort.moduleRoots.get("AB1234") ?? "", sourceLocation),
      "Reissued upstream.\n",
    );

    const report = await executeCurationRederivation({
      plan,
      cohort,
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.match(
      report.refusals[0] ?? "",
      /the source changed after it was read/u,
    );
  });

  it("applies nothing and writes no journal when the cohort holds no split", async () => {
    const single = `${curatedLine(chapterOne)}\n`;
    const cohort = await mountedModule(single);

    const report = await executeCurationRederivation({
      plan: planFor(cohort),
      cohort,
      mode: "apply",
    });

    assert.equal(report.outcome, "settled");
    assert.equal(report.appended, 0);
    assert.equal(report.journal, undefined);
  });
});
