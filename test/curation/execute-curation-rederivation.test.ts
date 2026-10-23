import assert from "node:assert/strict";
import filesystem, {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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

function observation(
  register: string,
  module: string,
): ObservedModuleRederivation {
  return {
    module,
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
  modules = ["AB1234"],
): Promise<CohortCurationRederivations> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "academic-os-rederive-")),
  );
  temporaryRoots.push(root);
  const stateRoot = join(root, "state");
  const moduleRoots = new Map<string, string>();
  for (const module of modules) {
    const moduleRoot = join(root, "Modules", "Y2S1", module);
    moduleRoots.set(module, moduleRoot);
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
  }
  await mkdir(stateRoot, { recursive: true });
  return {
    driveMount: root,
    stateRoot,
    modules: modules.map((module) => observation(register, module)),
    moduleRoots,
    unresolved: [],
  };
}

function planFor(cohort: CohortCurationRederivations) {
  return planCurationRederivation({ modules: cohort.modules, now });
}

async function duringJournalIntent<T>(input: {
  cohort: CohortCurationRederivations;
  moduleIndex: number;
  change(): Promise<void>;
  execute(): Promise<T>;
}): Promise<T> {
  const originalOpen = filesystem.open;
  const originalReadFile = filesystem.readFile;
  let openings = 0;
  let changed = false;
  filesystem.open = async (...args) => {
    if (String(args[0]).startsWith(join(input.cohort.stateRoot, "journals"))) {
      openings += 1;
      if (openings === input.moduleIndex * 2 + 1) {
        await input.change();
        changed = true;
      }
    }
    return await originalOpen(...args);
  };
  syncBuiltinESMExports();
  try {
    const result = await input.execute();
    assert.equal(
      changed,
      true,
      "the real journal intent yielded to the change",
    );
    return result;
  } finally {
    filesystem.open = originalOpen;
    filesystem.readFile = originalReadFile;
    syncBuiltinESMExports();
  }
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

  for (const [change, destination, bytes] of [
    ["disappeared", chapterOne, undefined],
    ["became a copy", chapterOne, sourceBytes],
    [
      "gained different derived bytes",
      chapterOne,
      Buffer.from("Reworked cut.\n"),
    ],
    ["lost its whole copy", wholeCopy, chapterOneBytes],
  ] as const) {
    it(`refuses before appending when a destination ${change}`, async () => {
      const cohort = await mountedModule(splitRegister);
      const moduleRoot = cohort.moduleRoots.get("AB1234") ?? "";
      const plan = planFor(cohort);
      const before = await readFile(join(moduleRoot, registerPath));
      const target = join(moduleRoot, destination);
      if (bytes === undefined) await rm(target);
      else await writeFile(target, bytes);

      const report = await executeCurationRederivation({
        plan,
        cohort,
        mode: "apply",
      });

      assert.equal(report.outcome, "refused");
      assert.equal(report.appended, 0);
      assert.equal(report.counts.rederiving, 1);
      assert.equal(report.counts.settled, 0);
      assert.equal(report.journal, undefined);
      assert.ok(
        report.refusals.some((refusal) => refusal.includes(destination)),
      );
      assert.deepEqual(await readFile(join(moduleRoot, registerPath)), before);
    });
  }

  it("proves every module's destinations before the first cohort append", async () => {
    const cohort = await mountedModule(splitRegister, ["AB1234", "ZZ1234"]);
    const plan = planFor(cohort);
    const before = await Promise.all(
      [...cohort.moduleRoots.values()].map((root) =>
        readFile(join(root, registerPath)),
      ),
    );
    await rm(join(cohort.moduleRoots.get("ZZ1234") ?? "", chapterTwo));

    const report = await executeCurationRederivation({
      plan,
      cohort,
      mode: "apply",
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.equal(report.counts.rederiving, 2);
    assert.equal(report.counts.settled, 0);
    assert.equal(report.journal, undefined);
    assert.deepEqual(
      await Promise.all(
        [...cohort.moduleRoots.values()].map((root) =>
          readFile(join(root, registerPath)),
        ),
      ),
      before,
    );
  });

  for (const location of [sourceLocation, chapterOne]) {
    for (const change of ["removed", "rewritten", "unreadable"]) {
      it(`refuses when ${location} is ${change} during journal intent`, async () => {
        const cohort = await mountedModule(splitRegister);
        const plan = planFor(cohort);
        const moduleRoot = cohort.moduleRoots.get("AB1234") ?? "";
        const target = join(moduleRoot, location);
        const before = await readFile(join(moduleRoot, registerPath));
        const report = await duringJournalIntent({
          cohort,
          moduleIndex: 0,
          change: async () => {
            if (change === "removed") await rm(target);
            else if (change === "rewritten")
              await writeFile(target, "Changed while the journal opened.\n");
            else {
              filesystem.readFile = new Proxy(filesystem.readFile, {
                apply(read, receiver, args) {
                  if (String(args[0]) === target)
                    return Promise.reject(new Error("synthetic read failure"));
                  return Reflect.apply(read, receiver, args);
                },
              });
              syncBuiltinESMExports();
            }
          },
          execute: () =>
            executeCurationRederivation({ plan, cohort, mode: "apply" }),
        });

        assert.equal(report.outcome, "refused");
        assert.equal(report.appended, 0);
        assert.equal(report.counts.rederiving, 1);
        assert.equal(report.counts.settled, 0);
        assert.ok(
          report.refusals.some((refusal) => refusal.includes(location)),
        );
        assert.deepEqual(
          await readFile(join(moduleRoot, registerPath)),
          before,
        );
        assert.ok(report.journal);
        const entries = (await readFile(report.journal, "utf8"))
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepEqual(
          entries.map((entry) => entry.type),
          ["intent", "refused"],
        );
        assert.match(entries[1]?.evidence ?? "", /changed after it was read/u);
      });
    }
  }

  it("refuses when a missing destination reappears during journal intent", async () => {
    const cohort = await mountedModule(splitRegister);
    const module = cohort.modules[0];
    assert.ok(module);
    const moduleRoot = cohort.moduleRoots.get("AB1234") ?? "";
    const target = join(moduleRoot, chapterTwo);
    await rm(target);
    module.artifacts = new Map(
      [...module.artifacts].filter(([location]) => location !== chapterTwo),
    );
    const plan = planFor(cohort);
    const report = await duringJournalIntent({
      cohort,
      moduleIndex: 0,
      change: () => writeFile(target, chapterTwoBytes),
      execute: () =>
        executeCurationRederivation({ plan, cohort, mode: "apply" }),
    });

    assert.equal(report.outcome, "refused");
    assert.equal(report.appended, 0);
    assert.equal(report.counts.rederiving, 1);
    assert.equal(report.counts.settled, 0);
    assert.ok(report.refusals.some((refusal) => refusal.includes(chapterTwo)));
    assert.equal(
      await readFile(join(moduleRoot, registerPath), "utf8"),
      splitRegister,
    );
    assert.ok(report.journal);
    const entries = (await readFile(report.journal, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      entries.map((entry) => entry.type),
      ["intent", "refused"],
    );
  });

  for (const location of [sourceLocation, chapterOne]) {
    it(`preserves an earlier append when later ${location} changes at journal intent`, async () => {
      const cohort = await mountedModule(splitRegister, ["AB1234", "ZZ1234"]);
      const plan = planFor(cohort);
      const first = cohort.moduleRoots.get("AB1234") ?? "";
      const second = cohort.moduleRoots.get("ZZ1234") ?? "";
      const report = await duringJournalIntent({
        cohort,
        moduleIndex: 1,
        change: () => rm(join(second, location)),
        execute: () =>
          executeCurationRederivation({ plan, cohort, mode: "apply" }),
      });

      assert.equal(report.outcome, "partially-corrected");
      assert.equal(report.appended, 1);
      assert.equal(report.counts.rederiving, 1);
      assert.equal(report.counts.settled, 1);
      assert.equal(report.modules[0]?.counts.rederiving, 0);
      assert.equal(report.modules[0]?.counts.settled, 1);
      assert.equal(report.modules[1]?.counts.rederiving, 1);
      assert.equal(report.modules[1]?.counts.settled, 0);
      assert.ok(report.refusals.some((refusal) => refusal.includes(location)));
      const firstRegister = await readFile(join(first, registerPath), "utf8");
      assert.ok(firstRegister.startsWith(splitRegister));
      assert.equal(firstRegister.trimEnd().split("\n").length, 4);
      assert.equal(
        JSON.parse(firstRegister.trimEnd().split("\n")[3] ?? "").decision,
        "rederived",
      );
      assert.equal(
        await readFile(join(second, registerPath), "utf8"),
        splitRegister,
      );
      assert.ok(report.journal);
      const entries = (await readFile(report.journal, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        entries.map((entry) => [entry.module, entry.type]),
        [
          ["AB1234", "intent"],
          ["AB1234", "result"],
          ["ZZ1234", "intent"],
          ["ZZ1234", "refused"],
        ],
      );
    });
  }

  for (const appeared of [false, true]) {
    it(`checks a destination absent during planning when it ${appeared ? "reappears" : "stays absent"}`, async () => {
      const cohort = await mountedModule(splitRegister);
      const module = cohort.modules[0];
      assert.ok(module);
      const moduleRoot = cohort.moduleRoots.get("AB1234") ?? "";
      const target = join(moduleRoot, chapterTwo);
      await rm(target);
      module.artifacts = new Map(
        [...module.artifacts].filter(([location]) => location !== chapterTwo),
      );
      const plan = planFor(cohort);
      if (appeared) await writeFile(target, chapterTwoBytes);

      const report = await executeCurationRederivation({
        plan,
        cohort,
        mode: "apply",
      });

      assert.equal(report.outcome, appeared ? "refused" : "settled");
      assert.equal(report.appended, appeared ? 0 : 1);
      assert.deepEqual(report.modules[0]?.rederivations[0]?.derived, [
        chapterOne,
      ]);
      assert.deepEqual(report.modules[0]?.rederivations[0]?.missing, [
        chapterTwo,
      ]);
      if (appeared)
        assert.equal(
          await readFile(join(moduleRoot, registerPath), "utf8"),
          splitRegister,
        );
    });
  }

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
