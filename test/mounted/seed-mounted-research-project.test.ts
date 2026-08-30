import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

import type { AcademicConfig } from "../../src/config/index.js";
import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";
import { seedMountedResearchProject } from "../../src/mounted/index.js";
import { createResearchProjectSeedPlan } from "../../src/seed/index.js";
import { recordResearchBehaviorEvidence } from "../support/rule-evidence.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("seedMountedResearchProject", () => {
  it("previews, applies, preserves Finder metadata, and repeats as a no-op", async () => {
    const fixture = await researchSeedFixture();

    const preview = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "preview",
    );
    assert.equal(preview.outcome, "preview");
    assert.ok(preview.operations.length > 0);
    assert.deepEqual(await readdir(fixture.projectRoot), ["Icon\r"]);

    const applied = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );
    assert.equal(applied.outcome, "completed");
    assert.deepEqual(applied.project, {
      key: "ureca-y2",
      folder: "URECA Y2",
    });
    await access(join(fixture.projectRoot, "70 Research", "20 Mathematics"));
    assert.equal(
      await readFile(join(fixture.projectRoot, "Icon\r"), "utf8"),
      "",
    );

    const repeated = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(repeated.outcome, "completed");
    assert.deepEqual(repeated.operations, []);

    const journal = await onlyResearchJournal(fixture.stateRoot);
    assert.equal(journal[0]?.target.kind, "research-project");
    assert.equal(journal[0]?.target.projectKey, "ureca-y2");
    assert.equal(journal[0]?.preconditions.contractVersion, 1);
    assert.equal(journal.at(-1)?.outcome, "completed");
  });

  it("blocks unexpected project-root content before writing", async () => {
    const fixture = await researchSeedFixture();
    await writeFile(join(fixture.projectRoot, "loose-note.md"), "keep me\n");

    const report = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );

    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /Unexpected root content/u);
    assert.equal(
      await readFile(join(fixture.projectRoot, "loose-note.md"), "utf8"),
      "keep me\n",
    );
    recordResearchBehaviorEvidence("RP-SEED-002", () => {
      assert.equal(report.outcome, "blocked");
      assert.equal(report.operations.length, fixture.plan.operations.length);
    });
  });

  it("publishes an absent project atomically", async () => {
    const fixture = await researchSeedFixture({ existing: false });

    const report = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );

    assert.equal(report.outcome, "completed");
    await access(join(fixture.projectRoot, "AGENTS.md"));
    assert.equal(
      (await readdir(fixture.researchRoot)).some((name) =>
        name.startsWith(".academic-os-stage-research-"),
      ),
      false,
    );
  });

  it("ignores a valid stage belonging to a longer research-project key", async () => {
    const fixture = await researchSeedFixture();
    const otherStage = join(
      fixture.researchRoot,
      `.academic-os-stage-research-ureca-y2-extension-${randomUUID()}`,
    );
    await mkdir(otherStage);

    const report = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "preview",
    );

    assert.equal(report.outcome, "preview");
    await access(otherStage);
  });

  it("resumes a synthetic publication interruption without replacing existing metadata", async () => {
    const fixture = await researchSeedFixture();
    let interrupted = false;
    await assert.rejects(
      seedMountedResearchProject(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (!interrupted && checkpoint === "during-publication") {
            interrupted = true;
            throw new Error("synthetic research publication interruption");
          }
        },
      }),
      /synthetic research publication interruption/u,
    );

    const inspected = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );
    assert.equal(inspected.outcome, "safely-resumable");
    const resumed = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(resumed.outcome, "completed");
    assert.equal(
      await readFile(join(fixture.projectRoot, "Icon\r"), "utf8"),
      "",
    );
  });

  it("refuses to apply a seed to an inactive project", async () => {
    const fixture = await researchSeedFixture();
    if (fixture.config.research === undefined)
      assert.fail("fixture lacks research");
    fixture.config.research.projects["ureca-y2"] = {
      ...fixture.config.research.projects["ureca-y2"],
      folder: "URECA Y2",
      status: "inactive",
    };

    await assert.rejects(
      seedMountedResearchProject(fixture.config, fixture.plan, "apply"),
      /inactive and read-only/u,
    );
    assert.deepEqual(await readdir(fixture.projectRoot), ["Icon\r"]);
  });

  it("previews binary intake without exposing bytes and writes exact bytes", async () => {
    const fixture = await researchSeedFixture({
      initialFiles: [
        {
          destination: "10 Source Materials/20 Core Sources/source.pdf",
          encoding: "binary",
          contentsBase64: "AP8KgEE=",
        },
      ],
    });

    const preview = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "preview",
    );
    assert.deepEqual(
      preview.operations,
      fixture.plan.operations.map(({ kind, path }) => ({ kind, path })),
    );
    assert.deepEqual(
      preview.operations.find(({ path }) => path.endsWith("source.pdf")),
      {
        kind: "file",
        path: "10 Source Materials/20 Core Sources/source.pdf",
      },
    );
    assert.doesNotMatch(JSON.stringify(preview), /AP8KgEE=/u);

    const applied = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );
    assert.equal(applied.outcome, "completed");
    assert.deepEqual(
      await readFile(
        join(
          fixture.projectRoot,
          "10 Source Materials",
          "20 Core Sources",
          "source.pdf",
        ),
      ),
      Buffer.from([0, 255, 10, 128, 65]),
    );
    const journal = await onlyResearchJournal(fixture.stateRoot);
    const startedPlan = journal[0]?.plan as
      | { operations?: Array<{ path?: string; contentsBase64?: string }> }
      | undefined;
    assert.equal(
      startedPlan?.operations?.find(({ path }) => path?.endsWith("source.pdf"))
        ?.contentsBase64,
      "AP8KgEE=",
    );
  });

  it("refuses an intake conflict before creating any planned file", async () => {
    const fixture = await researchSeedFixture({
      initialFiles: [
        {
          destination: "10 Source Materials/20 Core Sources/source.pdf",
          encoding: "binary",
          contentsBase64: "AP8=",
        },
      ],
    });
    const core = join(
      fixture.projectRoot,
      "10 Source Materials",
      "20 Core Sources",
    );
    await mkdir(core, { recursive: true });
    await writeFile(join(core, "source.pdf"), Buffer.from([1, 2, 3]));

    const report = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
    );

    assert.equal(report.outcome, "blocked");
    assert.match(report.evidence.join("\n"), /conflicts with/u);
    await assert.rejects(access(join(fixture.projectRoot, "AGENTS.md")));
    assert.deepEqual(
      await readFile(join(core, "source.pdf")),
      Buffer.from([1, 2, 3]),
    );
  });

  it("binds binary intake bytes into the resumable plan digest", async () => {
    const fixture = await researchSeedFixture({
      initialFiles: [
        {
          destination: "10 Source Materials/20 Core Sources/source.pdf",
          encoding: "binary",
          contentsBase64: "AP8=",
        },
      ],
    });
    let interrupted = false;
    await assert.rejects(
      seedMountedResearchProject(fixture.config, fixture.plan, "apply", {
        checkpoint: async ({ checkpoint }) => {
          if (!interrupted && checkpoint === "before-staging") {
            interrupted = true;
            throw new Error("synthetic intake interruption");
          }
        },
      }),
      /synthetic intake interruption/u,
    );
    const changedPlan = structuredClone(fixture.plan);
    const source = changedPlan.operations.find(({ path }) =>
      path.endsWith("source.pdf"),
    );
    if (source === undefined) assert.fail("fixture lacks initial file");
    source.contentsBase64 = "AQI=";

    const changed = await seedMountedResearchProject(
      fixture.config,
      changedPlan,
      "apply",
      { resume: true },
    );
    assert.equal(changed.outcome, "blocked");
    assert.match(changed.evidence.join("\n"), /approved plan changed/u);

    const resumed = await seedMountedResearchProject(
      fixture.config,
      fixture.plan,
      "apply",
      { resume: true },
    );
    assert.equal(resumed.outcome, "completed");
  });
});

async function researchSeedFixture(
  options: {
    existing?: boolean;
    initialFiles?: Parameters<
      typeof createResearchProjectSeedPlan
    >[0]["initialFiles"];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-research-seed-"));
  temporaryRoots.push(root);
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const researchRoot = join(driveMount, "Modules", "Research");
  const projectRoot = join(researchRoot, "URECA Y2");
  await mkdir(options.existing === false ? researchRoot : projectRoot, {
    recursive: true,
  });
  await mkdir(stateRoot);
  if (options.existing !== false) {
    await writeFile(join(projectRoot, "Icon\r"), "");
  }
  const config: AcademicConfig = {
    driveMount,
    stateRoot,
    activeSemester: "Y2S1",
    semesters: {
      Y2S1: { root: "Modules/Y2S1", status: "active", modules: [] },
    },
    research: {
      root: "Modules/Research",
      projects: {
        "ureca-y2": {
          folder: "URECA Y2",
          status: "active",
          profile: "ureca",
          taskListTitle: "URECA Y2",
        },
      },
    },
  };
  const contract = await loadResearchProjectContract();
  const definition = `contract_version: 1
project:
  key: ureca-y2
  folder: URECA Y2
  title: Example research project
  status: active
profile: ureca
evidence:
  identity: owner-supplied
  confirmation: unresolved
`;
  const plan = createResearchProjectSeedPlan({
    target: {
      key: "ureca-y2",
      root: "Modules/Research",
      folder: "URECA Y2",
      status: "active",
      profile: "ureca",
      taskListTitle: "URECA Y2",
    },
    profile: validResearchProfile(),
    definition,
    contract,
    ...(options.initialFiles === undefined
      ? {}
      : { initialFiles: options.initialFiles }),
  });
  return { config, plan, projectRoot, researchRoot, stateRoot };
}

function validResearchProfile(): string {
  return `# URECA Y2 — Example research project

## Identity

| Field | Value | Evidence |
| --- | --- | --- |
| Project key | ureca-y2 | owner-supplied |
| Folder | URECA Y2 | owner-supplied |
| Title | Example research project | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ureca | official-source |

## Purpose and Questions

No research question is asserted by this fixture.

## Programme

Synthetic URECA-profile coverage only.

## Supervision

| Field | Value | Evidence |
| --- | --- | --- |

## Deliverables

| Deliverable | Requirement | Evidence |
| --- | --- | --- |

## Source Authority

| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |

## Workspaces

| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Research | Disposable fixture | \`70 Research/\` |

## Known Gaps

| Gap | Consequence | Next evidence |
| --- | --- | --- |
| Content accuracy | Outside this structural test | unresolved |
`;
}

async function onlyResearchJournal(stateRoot: string): Promise<JournalEvent[]> {
  const directory = join(stateRoot, "journals", "seeds");
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  return (await readFile(join(directory, entries[0] ?? "missing"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as JournalEvent);
}

interface JournalEvent {
  plan?: unknown;
  target: { kind?: string; projectKey?: string };
  preconditions: { contractVersion: number | "unavailable" };
  outcome?: string;
}
