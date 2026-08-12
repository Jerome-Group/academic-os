import assert from "node:assert/strict";
import {
  access,
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
      assert.equal(journal[0]?.preconditions?.contractVersion, 2);
      assert.equal(journal.at(-1)?.outcome, "completed");
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
      ".academic-os-stage-MH2100-abandoned",
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

async function interruptedPublicationFixture() {
  const fixture = await mountedSeedFixture();
  let interrupted = false;
  await assert.rejects(
    seedMountedModule(fixture.config, fixture.plan, "apply", {
      checkpoint: async ({ checkpoint }) => {
        if (!interrupted && checkpoint === "during-publication") {
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
  preconditions?: { contractVersion: number | "unavailable" };
  outcome?: string;
}

async function readOnlySeedJournal(stateRoot: string): Promise<JournalEvent[]> {
  return (await readFile(await onlyJournalPath(stateRoot), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as JournalEvent);
}
