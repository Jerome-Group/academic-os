import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  rename,
  symlink,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  seedMountedModule,
  type SeedExecutionCheckpoint,
} from "../../src/mounted/index.js";
import { createModuleSeedPlan } from "../../src/seed/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";
import { testModuleContract } from "../fixtures/module-contract.js";

import { seedOwnershipTests } from "../support/seed-ownership.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

const interruptionPoints: SeedExecutionCheckpoint[] = [
  "before-staging",
  "during-staging",
  "before-publication",
  "during-publication",
  "after-publication",
];

describe("seedMountedModule", () => {
  seedOwnershipTests(async () => {
    const fixture = await mountedSeedFixture();
    return {
      parentRoot: fixture.semesterRoot,
      targetRoot: join(fixture.semesterRoot, "MH2100"),
      stateRoot: fixture.stateRoot,
      directoryPath:
        fixture.plan.operations.find(
          (operation) => operation.kind === "directory",
        )?.path ?? "missing",
      filePath:
        fixture.plan.operations.find((operation) => operation.kind === "file")
          ?.path ?? "missing",
      run: (options) =>
        seedMountedModule(fixture.config, fixture.plan, "apply", options),
    };
  });

  for (const interruptionPoint of interruptionPoints) {
    it(`resumes safely after interruption ${interruptionPoint}`, async () => {
      const fixture = await mountedSeedFixture();
      let interrupted = false;

      await assert.rejects(
        seedMountedModule(fixture.config, fixture.plan, "apply", {
          checkpoint: async ({ checkpoint }) => {
            if (!interrupted && checkpoint === interruptionPoint) {
              interrupted = true;
              throw new Error(`synthetic interruption ${interruptionPoint}`);
            }
          },
        }),
        new RegExp(`synthetic interruption ${interruptionPoint}`, "u"),
      );

      if (interruptionPoint !== "after-publication") {
        await assert.rejects(
          access(join(fixture.semesterRoot, "MH2100")),
          /ENOENT/u,
        );
        assert.equal(
          (await readdir(fixture.semesterRoot)).filter((name) =>
            name.startsWith(".academic-os-stage-"),
          ).length,
          interruptionPoint === "before-staging" ? 0 : 1,
        );
      }

      const inspected = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
      );
      assert.equal(inspected.outcome, "safely-resumable");
      assert.match(inspected.evidence.join("\n"), /completed/u);
      assert.match(inspected.evidence.join("\n"), /remaining/u);

      const resumed = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        { resume: true },
      );
      assert.equal(resumed.outcome, "completed");
      assert.equal(resumed.operations.length, 0);
      assert.deepEqual(await readdir(fixture.semesterRoot), ["MH2100"]);
      assert.equal(
        (await readdir(fixture.semesterRoot)).some((name) =>
          name.startsWith(".academic-os-stage-"),
        ),
        false,
      );

      const repeated = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        { resume: true },
      );
      assert.equal(repeated.outcome, "completed");
      assert.deepEqual(repeated.operations, []);

      const journal = await readOnlySeedJournal(fixture.stateRoot);
      assert.equal(journal[0]?.type, "started");
      assert.deepEqual(journal[0]?.plan, fixture.plan);
      assert.equal(journal[0]?.target.module, "MH2100");
      assert.equal("kind" in (journal[0]?.target ?? {}), false);
      assert.match(
        journal[0]?.stagingRoot ?? "",
        /\.academic-os-stage-MH2100-[0-9a-f-]+$/u,
      );
      assert.equal(journal[0]?.preconditions?.contractVersion, 7);
      assert.equal(journal.at(-1)?.outcome, "completed");
    });
  }

  it("preserves an empty target appearing immediately before publication", async () => {
    const fixture = await mountedSeedFixture();
    const target = join(fixture.semesterRoot, "MH2100");
    let inode: number | undefined;
    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      {
        checkpoint: async ({ checkpoint }) => {
          if (checkpoint === "during-publication" && inode === undefined) {
            await mkdir(target);
            inode = (await lstat(target)).ino;
          }
        },
      },
    );
    assert.equal(report.outcome, "blocked");
    assert.equal((await lstat(target)).ino, inode);
    assert.deepEqual(await readdir(target), []);
    assert.equal(
      (await readOnlySeedJournal(fixture.stateRoot)).some(
        ({ type }) => type === "root-claimed",
      ),
      false,
    );
  });

  it("resumes additive publication only into its durably claimed root", async () => {
    const fixture = await mountedSeedFixture();
    const target = join(fixture.semesterRoot, "MH2100");
    await assert.rejects(
      seedMountedModule(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint, operation }) => {
          if (checkpoint === "during-publication" && operation !== undefined)
            throw new Error("synthetic claimed-root interruption");
        },
      }),
      /synthetic claimed-root interruption/u,
    );
    const inode = (await lstat(target)).ino;
    const events = await readOnlySeedJournal(fixture.stateRoot);
    assert.equal(
      events.filter(({ type }) => type === "root-claimed").length,
      1,
    );
    assert.equal(
      (await seedMountedModule(fixture.config, fixture.plan, "apply")).outcome,
      "safely-resumable",
    );
    assert.equal(
      (
        await seedMountedModule(fixture.config, fixture.plan, "apply", {
          resume: true,
        })
      ).outcome,
      "completed",
    );
    assert.equal((await lstat(target)).ino, inode);
    assert.equal(
      (await readOnlySeedJournal(fixture.stateRoot)).filter(
        ({ type }) => type === "root-claimed",
      ).length,
      1,
    );
  });

  it("refuses an interrupted target with no recorded root claim", async () => {
    const fixture = await interruptedPublicationFixture(false);
    const target = join(fixture.semesterRoot, "MH2100");
    await mkdir(target);
    const inode = (await lstat(target)).ino;
    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /root claim/u);
    assert.equal((await lstat(target)).ino, inode);
    assert.deepEqual(await readdir(target), []);
  });

  it("refuses a missing claimed root before offering resume", async () => {
    const fixture = await interruptedPublicationFixture();
    const target = join(fixture.semesterRoot, "MH2100");
    await rm(target, { recursive: true });
    for (const resume of [false, true]) {
      const report = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        { resume },
      );
      assert.equal(report.outcome, "blocked");
      assert.match(report.evidence.join("\n"), /root claim/u);
      await assert.rejects(access(target), /ENOENT/u);
    }
  });

  it("verifies completed legacy journals without rewriting them", async () => {
    const fixture = await mountedSeedFixture();
    assert.equal(
      (await seedMountedModule(fixture.config, fixture.plan, "apply")).outcome,
      "completed",
    );
    const path = await onlyJournalPath(fixture.stateRoot);
    const legacy =
      (await readOnlySeedJournal(fixture.stateRoot))
        .filter(({ type }) =>
          ["started", "operation-completed", "outcome"].includes(type),
        )
        .map((event, sequence) =>
          JSON.stringify({ ...event, schemaVersion: 1, sequence }),
        )
        .join("\n") + "\n";
    await writeFile(path, legacy);
    assert.equal(
      (
        await seedMountedModule(fixture.config, fixture.plan, "apply", {
          resume: true,
        })
      ).outcome,
      "completed",
    );
    assert.equal(await readFile(path, "utf8"), legacy);
  });

  it("rejects coerced journal enums and impossible ownership events", async () => {
    const fixture = await mountedSeedFixture();
    await assert.rejects(
      seedMountedModule(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (checkpoint === "before-publication")
            throw new Error("journal fixture interruption");
        },
      }),
      /journal fixture interruption/u,
    );
    const path = await onlyJournalPath(fixture.stateRoot);
    const source = await readFile(path, "utf8");
    const events: Record<string, unknown>[] = source
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const claim = events.find((event) => event.type === "stage-claimed");
    const receipt = events.find((event) => event.type === "entry-created");
    assert.ok(claim !== undefined && receipt !== undefined);
    const last = events.at(-1);
    assert.ok(last !== undefined);
    const invalidSources = [
      source.replace('"phase":"staging"', '"phase":["staging"]'),
      [
        ...events,
        { ...last, type: "root-claimed", device: "1", inode: "1" },
        {
          ...last,
          type: "operation-completed",
          phase: "publication",
          generation: 4,
        },
      ]
        .map((event, sequence) => JSON.stringify({ ...event, sequence }))
        .join("\n") + "\n",
      [
        ...events.slice(0, -1),
        { ...receipt, type: "stage-entry-removing", path: "00 Module Admin" },
        last,
      ]
        .map((event, sequence) => JSON.stringify({ ...event, sequence }))
        .join("\n") + "\n",
      source.replace('"targetState":"absent"', '"targetState":["absent"]'),
      source.replace('"kind":"directory"', '"kind":["directory"]'),
      source +
        JSON.stringify({
          ...last,
          type: "outcome",
          outcome: ["completed"],
          sequence: events.length,
        }) +
        "\n",
      ...[
        claim,
        receipt,
        { ...claim, type: "stage-cleaned" },
        {
          ...claim,
          type: "stage-planned",
          generation: 1,
          stagingRoot: "unsafe",
        },
      ].map(
        (event) =>
          source + JSON.stringify({ ...event, sequence: events.length }) + "\n",
      ),
    ];
    for (const invalid of invalidSources) {
      await writeFile(path, invalid);
      const report = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        { resume: true },
      );
      assert.equal(report.outcome, "blocked");
      assert.match(report.evidence.join("\n"), /ambiguous journal/u);
    }
    await writeFile(path, source);
    assert.equal(
      (
        await seedMountedModule(fixture.config, fixture.plan, "apply", {
          resume: true,
        })
      ).outcome,
      "completed",
    );
  });

  it("resumes interrupted exact cleanup then claims a fresh stage generation", async () => {
    const fixture = await mountedSeedFixture();
    await assert.rejects(
      seedMountedModule(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (checkpoint === "before-publication")
            throw new Error("cleanup fixture interruption");
        },
      }),
      /cleanup fixture interruption/u,
    );
    const path = await onlyJournalPath(fixture.stateRoot);
    const events: Record<string, unknown>[] = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const started = events[0];
    const receipt = events.find(
      (event) =>
        event.type === "entry-created" &&
        typeof event.operation === "object" &&
        event.operation !== null &&
        "kind" in event.operation &&
        event.operation.kind === "file",
    );
    assert.ok(started !== undefined && typeof started.stagingRoot === "string");
    assert.ok(
      receipt !== undefined &&
        typeof receipt.operation === "object" &&
        receipt.operation !== null &&
        "path" in receipt.operation &&
        typeof receipt.operation.path === "string",
    );
    await writeFile(
      path,
      JSON.stringify({
        ...receipt,
        type: "stage-entry-removing",
        path: receipt.operation.path,
        sequence: events.length,
      }) + "\n",
      { flag: "a" },
    );
    await rm(join(started.stagingRoot, receipt.operation.path));
    assert.equal(
      (await seedMountedModule(fixture.config, fixture.plan, "apply")).outcome,
      "safely-resumable",
    );
    assert.equal(
      (
        await seedMountedModule(fixture.config, fixture.plan, "apply", {
          resume: true,
        })
      ).outcome,
      "completed",
    );
    const finalEvents = await readOnlySeedJournal(fixture.stateRoot);
    assert.equal(
      finalEvents.filter((event) => event.type === "stage-claimed").length,
      2,
    );
    assert.equal(
      finalEvents.filter((event) => event.type === "stage-cleaned").length,
      2,
    );
  });

  it("refuses duplicate root claims as an ambiguous journal", async () => {
    const fixture = await mountedSeedFixture();
    await assert.rejects(
      seedMountedModule(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint, operation }) => {
          if (checkpoint === "during-publication" && operation !== undefined)
            throw new Error("synthetic claimed interruption");
        },
      }),
      /synthetic claimed interruption/u,
    );
    const events = await readOnlySeedJournal(fixture.stateRoot);
    const claim = events.find(({ type }) => type === "root-claimed");
    await writeFile(
      await onlyJournalPath(fixture.stateRoot),
      JSON.stringify({ ...claim, sequence: events.length }) + "\n",
      { flag: "a" },
    );
    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /ambiguous journal lifecycle/u);
  });

  for (const replacement of ["directory", "symlink"] as const) {
    it(`blocks a claimed root replaced by a ${replacement} during publication`, async () => {
      const fixture = await mountedSeedFixture();
      const target = join(fixture.semesterRoot, "MH2100");
      const parked = join(fixture.semesterRoot, "parked-synthetic-target");
      let replaced = false;
      const report = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        {
          checkpoint: async ({ checkpoint, operation }) => {
            if (
              replaced ||
              checkpoint !== "during-publication" ||
              operation === undefined
            )
              return;
            replaced = true;
            await rename(target, parked);
            if (replacement === "directory") await mkdir(target);
            else await symlink(parked, target, "dir");
          },
        },
      );
      assert.equal(report.outcome, "blocked");
      assert.match(report.evidence.join("\n"), /root claim/u);
      assert.deepEqual(await readdir(parked), [
        fixture.plan.operations[0]?.path,
      ]);
      if (replacement === "directory")
        assert.deepEqual(await readdir(target), []);
      const resumed = await seedMountedModule(
        fixture.config,
        fixture.plan,
        "apply",
        { resume: true },
      );
      assert.equal(resumed.outcome, "blocked");
    });
  }

  it("blocks changed plans, controls, targets, and ambiguous journals before continuing", async () => {
    const changedPlan = await interruptedPublicationFixture();
    const changedControls = validModuleControls();
    const differentPlan = createModuleSeedPlan({
      module: "MH2100",
      semester: "Y2S1",
      profile: (changedControls.profile ?? "").replace(
        "Multivariable calculus.",
        "Changed approved scope.",
      ),
      definition: changedControls.definition ?? "",
      contract: testModuleContract,
    });
    const changedPlanReport = await seedMountedModule(
      changedPlan.config,
      differentPlan,
      "apply",
      { resume: true },
    );
    assert.equal(changedPlanReport.outcome, "blocked");
    assert.match(
      changedPlanReport.evidence.join("\n"),
      /approved plan changed/u,
    );

    const changedControl = await interruptedPublicationFixture();
    await mkdir(
      join(changedControl.semesterRoot, "MH2100", "00 Module Admin"),
      { recursive: true },
    );
    await writeFile(
      join(
        changedControl.semesterRoot,
        "MH2100",
        "00 Module Admin",
        "00 Module Profile.md",
      ),
      "conflicting contents\n",
    );
    const changedControlReport = await seedMountedModule(
      changedControl.config,
      changedControl.plan,
      "apply",
      { resume: true },
    );
    assert.equal(changedControlReport.outcome, "blocked");
    assert.match(changedControlReport.evidence.join("\n"), /conflict/u);

    const ambiguous = await interruptedPublicationFixture();
    const journalPath = await onlyJournalPath(ambiguous.stateRoot);
    await writeFile(journalPath, "not-json\n", { flag: "a" });
    const ambiguousReport = await seedMountedModule(
      ambiguous.config,
      ambiguous.plan,
      "apply",
      { resume: true },
    );
    assert.equal(ambiguousReport.outcome, "blocked");
    assert.match(ambiguousReport.evidence.join("\n"), /ambiguous journal/u);

    const impossible = await interruptedPublicationFixture();
    const impossibleJournal = await onlyJournalPath(impossible.stateRoot);
    const impossibleEvents = (await readFile(impossibleJournal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const secondStart = { ...impossibleEvents[0] };
    secondStart.sequence = impossibleEvents.length;
    await writeFile(impossibleJournal, `${JSON.stringify(secondStart)}\n`, {
      flag: "a",
    });
    const impossibleReport = await seedMountedModule(
      impossible.config,
      impossible.plan,
      "apply",
      { resume: true },
    );
    assert.equal(impossibleReport.outcome, "blocked");
    assert.match(impossibleReport.evidence.join("\n"), /journal lifecycle/u);

    const mismatched = await interruptedPublicationFixture();
    const mismatchedJournal = await onlyJournalPath(mismatched.stateRoot);
    const mismatchedEvents = (await readFile(mismatchedJournal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = JSON.parse(line);
        event.target.module = "MH9999";
        return JSON.stringify(event);
      });
    await writeFile(mismatchedJournal, `${mismatchedEvents.join("\n")}\n`);
    const mismatchedReport = await seedMountedModule(
      mismatched.config,
      mismatched.plan,
      "apply",
      { resume: true },
    );
    assert.equal(mismatchedReport.outcome, "blocked");
    assert.match(mismatchedReport.evidence.join("\n"), /mismatched target/u);
  });

  it("reports and retains an abandoned staging artifact without changing it", async () => {
    const fixture = await mountedSeedFixture();
    const abandoned = join(
      fixture.semesterRoot,
      `.academic-os-stage-MH2100-${randomUUID()}`,
    );
    await mkdir(abandoned);

    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );

    assert.equal(report.outcome, "abandoned-staging");
    assert.match(report.evidence.join("\n"), /no matching journal/u);
    await access(abandoned);
  });

  it("rejects a journal staging path outside the exact marked semester child", async () => {
    const fixture = await mountedSeedFixture();
    let interrupted = false;
    await assert.rejects(
      seedMountedModule(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (!interrupted && checkpoint === "before-staging") {
            interrupted = true;
            throw new Error("synthetic interruption before staging");
          }
        },
      }),
      /synthetic interruption/u,
    );
    const outside = join(fixture.stateRoot, "must-not-delete");
    await mkdir(outside);
    const journalPath = await onlyJournalPath(fixture.stateRoot);
    const events = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = JSON.parse(line);
        if (event.type === "started") event.stagingRoot = outside;
        return JSON.stringify(event);
      });
    await writeFile(journalPath, `${events.join("\n")}\n`);

    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );

    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /unsafe or ambiguous staging/u);
    assert.match(report.evidence.join("\n"), /operations remaining/u);
    await access(outside);
  });

  it("blocks projected nested conflicts before resume changes the target", async () => {
    const fixture = await interruptedPublicationFixture();
    const conflict = join(
      fixture.semesterRoot,
      "MH2100",
      "30 Assessments",
      "30 Midterms",
      "Unexpected Group",
    );
    await mkdir(conflict, { recursive: true });
    const before = await readdir(join(fixture.semesterRoot, "MH2100"));

    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );

    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /Projected/u);
    assert.deepEqual(
      await readdir(join(fixture.semesterRoot, "MH2100")),
      before,
    );
    await access(conflict);
  });

  it("journals a publication conflict, reports progress, and removes staging", async () => {
    const fixture = await mountedSeedFixture();
    const moduleAdmin = join(fixture.semesterRoot, "MH2100", "00 Module Admin");
    await mkdir(moduleAdmin, { recursive: true });
    await writeFile(
      join(moduleAdmin, "00 Module Profile.md"),
      fixture.plan.operations.find(
        ({ path }) => path === "00 Module Admin/00 Module Profile.md",
      )?.contents ?? "",
    );
    let injected = false;
    const report = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      {
        checkpoint: async ({ checkpoint }) => {
          if (!injected && checkpoint === "during-publication") {
            injected = true;
            await writeFile(
              join(moduleAdmin, "10 Module Definition.yaml"),
              "conflict\n",
            );
          }
        },
      },
    );

    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /conflict/u);
    assert.match(report.evidence.join("\n"), /operations remaining/u);
    assert.equal(
      (await readdir(fixture.semesterRoot)).some((name) =>
        name.startsWith(".academic-os-stage-"),
      ),
      false,
    );
    const journal = await readOnlySeedJournal(fixture.stateRoot);
    assert.equal(journal.at(-1)?.outcome, "blocked");
    assert.equal(
      journal.some(({ type }) => type === "failure"),
      true,
    );

    await rm(join(moduleAdmin, "10 Module Definition.yaml"));
    const inspected = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
    );
    assert.equal(inspected.outcome, "safely-resumable");
    assert.match(inspected.evidence.join("\n"), /prior blocked outcome/u);
    const resumed = await seedMountedModule(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(resumed.outcome, "completed");
  });
});

async function mountedSeedFixture() {
  const root = await mkdtemp(join(tmpdir(), "academic-os-resume-seed-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const semesterRoot = join(driveMount, "Modules", "Y2S1");
  await mkdir(semesterRoot, { recursive: true });
  await mkdir(stateRoot);
  const controls = validModuleControls();
  const plan = createModuleSeedPlan({
    module: "MH2100",
    semester: "Y2S1",
    profile: controls.profile ?? "",
    definition: (controls.definition ?? "").replace(
      "quizzes: {enabled: true, evidence: [assessment-profile]}",
      "quizzes: {enabled: false}",
    ),
    contract: testModuleContract,
  });
  return {
    config: {
      driveMount,
      stateRoot,
      semester: "Y2S1",
      module: "MH2100",
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    },
    plan,
    semesterRoot,
    stateRoot,
  };
}

async function interruptedPublicationFixture(afterClaim = true) {
  const fixture = await mountedSeedFixture();
  let interrupted = false;
  await assert.rejects(
    seedMountedModule(fixture.config, fixture.plan, "apply", {
      checkpoint: async ({ checkpoint, operation }) => {
        if (
          !interrupted &&
          checkpoint === "during-publication" &&
          (!afterClaim || operation !== undefined)
        ) {
          interrupted = true;
          throw new Error("synthetic publication interruption");
        }
      },
    }),
    /synthetic publication interruption/u,
  );
  return fixture;
}

async function onlyJournalPath(stateRoot: string): Promise<string> {
  const directory = join(stateRoot, "journals", "seeds");
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  return join(directory, entries[0] ?? "missing");
}

interface JournalEvent {
  type: string;
  plan?: unknown;
  target: { module: string };
  stagingRoot?: string;
  preconditions?: { contractVersion: number | "unavailable" };
  outcome?: string;
}

async function readOnlySeedJournal(stateRoot: string): Promise<JournalEvent[]> {
  return (await readFile(await onlyJournalPath(stateRoot), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as JournalEvent);
}
