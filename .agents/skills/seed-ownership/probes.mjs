import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const pause = "seed ownership probe interruption";
const stageFaults = [
  "unclaimed-link",
  "unclaimed-directory",
  "stage-link",
  "stage-replacement",
  "foreign-child",
  "changed-bytes",
  "missing-stage",
];
const liveFaults = [
  "nested-link",
  "nested-replacement",
  "cleanup-foreign-child",
];
const checkpoints = [
  "before-staging",
  "during-staging",
  "before-publication",
  "during-publication",
  "after-publication",
];

export async function runSchedules(
  productRoot,
  evidenceRoot,
  select = () => true,
) {
  await mkdir(evidenceRoot, { recursive: true });
  evidenceRoot = await realpath(evidenceRoot);
  const api = await loadApi(productRoot);
  const results = [];
  for (const adapter of ["module", "research"]) {
    const cases = [
      ...stageFaults.map((fault) => [
        fault,
        (fixture) => stageFault(fixture, fault),
      ]),
      ...liveFaults.map((fault) => [
        fault,
        (fixture) => liveFault(fixture, fault),
      ]),
      ...checkpoints.map((checkpoint) => [
        `resume-${checkpoint}`,
        (fixture) => resume(fixture, checkpoint),
      ]),
      ["approved-partial", approvedPartial],
      ["completed-repeat", completedRepeat],
    ];
    for (const [name, run] of cases) {
      const id = `${adapter}/${name}`;
      if (!select(id)) continue;
      const fixture = await makeFixture(api, adapter, evidenceRoot, name);
      try {
        await run(fixture);
        results.push({ id, outcome: "passed", root: fixture.root });
      } catch (error) {
        results.push({
          id,
          outcome: "failed",
          root: fixture.root,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await writeJson(join(evidenceRoot, "results.json"), results);
    }
  }
  await writeJson(join(evidenceRoot, "results.json"), results);
  return results;
}

async function loadApi(root) {
  const load = (path) => import(pathToFileURL(join(root, "dist", path)).href);
  const [mounted, seed, controls, contract, researchContract] =
    await Promise.all([
      load("src/mounted/index.js"),
      load("src/seed/index.js"),
      load("test/fixtures/module-controls.js"),
      load("test/fixtures/module-contract.js"),
      load("src/contract/load-research-project-contract.js"),
    ]);
  return { ...mounted, ...seed, ...controls, ...contract, ...researchContract };
}

async function makeFixture(api, adapter, evidenceRoot, name) {
  const root = await mkdtemp(join(evidenceRoot, `${adapter}-${name}-`));
  const driveMount = join(root, "SyntheticMount");
  const stateRoot = join(root, "State");
  const outside = join(root, "outside");
  await mkdir(stateRoot);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "unrelated outside bytes\n");
  const research = adapter === "research";
  const parent = join(driveMount, research ? "Research" : "Modules/Y2S1");
  const target = join(parent, research ? "URECA Y2" : "MH2100");
  await mkdir(parent, { recursive: true });
  let plan;
  let config;
  if (research) {
    const identity = {
      key: "ureca-y2",
      root: "Research",
      folder: "URECA Y2",
      status: "active",
      profile: "ureca",
      taskListTitle: "URECA Y2",
    };
    config = {
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      semesters: {
        Y2S1: { root: "Modules/Y2S1", status: "active", modules: [] },
      },
      research: {
        root: "Research",
        projects: {
          "ureca-y2": {
            folder: identity.folder,
            status: identity.status,
            profile: identity.profile,
            taskListTitle: identity.taskListTitle,
          },
        },
      },
    };
    plan = api.createResearchProjectSeedPlan({
      target: identity,
      profile: researchProfile,
      definition:
        "contract_version: 3\nproject:\n  key: ureca-y2\n  folder: URECA Y2\n  title: Example research project\n  status: active\nprofile: ureca\nevidence:\n  identity: owner-supplied\n  confirmation: unresolved\n",
      contract: await api.loadResearchProjectContract(),
    });
  } else {
    const controls = api.validModuleControls();
    plan = api.createModuleSeedPlan({
      module: "MH2100",
      semester: "Y2S1",
      profile: controls.profile ?? "",
      definition: (controls.definition ?? "").replace(
        "quizzes: {enabled: true, evidence: [assessment-profile]}",
        "quizzes: {enabled: false}",
      ),
      contract: api.testModuleContract,
    });
    config = {
      driveMount,
      stateRoot,
      semester: "Y2S1",
      module: "MH2100",
      semesterRoots: { Y2S1: "Modules/Y2S1" },
    };
  }
  assert.deepEqual(
    plan.blockers,
    [],
    "synthetic approved plan has no blockers",
  );
  const seed = research
    ? api.seedMountedResearchProject
    : api.seedMountedModule;
  return {
    root,
    outside,
    parent,
    target,
    stateRoot,
    plan,
    call: async (options = {}) => {
      const report = await seed(config, plan, "apply", options);
      await writeJson(join(root, "latest-report.json"), report);
      return report;
    },
  };
}

async function stageRoot(fixture) {
  const directory = join(fixture.stateRoot, "journals", "seeds");
  const files = await readdir(directory);
  assert.equal(files.length, 1, "one target-keyed journal");
  const source = await readFile(join(directory, files[0]), "utf8");
  const first = JSON.parse(source.split("\n")[0]);
  assert.equal(typeof first.stagingRoot, "string");
  assert.equal(
    resolve(first.stagingRoot, ".."),
    fixture.parent,
    "stage stays in disposable parent",
  );
  return first.stagingRoot;
}

async function interrupt(fixture, checkpoint) {
  let hit = false;
  await assert.rejects(
    fixture.call({
      checkpoint: async (event) => {
        if (!hit && event.checkpoint === checkpoint) {
          hit = true;
          throw new Error(pause);
        }
      },
    }),
    new RegExp(pause),
  );
  assert.ok(hit, `public checkpoint ${checkpoint} reached`);
}

async function stageFault(fixture, fault) {
  await interrupt(
    fixture,
    fault.startsWith("unclaimed") ? "before-staging" : "before-publication",
  );
  const stage = await stageRoot(fixture);
  const protectedRoots = [fixture.outside];
  if (fault.endsWith("link")) {
    if (!fault.startsWith("unclaimed"))
      await rename(stage, join(fixture.root, "original-stage"));
    await symlink(fixture.outside, stage, "dir");
    protectedRoots.push(stage);
  } else if (fault === "unclaimed-directory" || fault === "stage-replacement") {
    if (fault === "stage-replacement")
      await rename(stage, join(fixture.root, "original-stage"));
    await mkdir(stage);
    await writeFile(join(stage, "sentinel.txt"), "foreign directory bytes\n");
    protectedRoots.push(stage);
  } else if (fault === "foreign-child") {
    await writeFile(
      join(stage, "sentinel.txt"),
      "foreign child in unchanged stage\n",
    );
    protectedRoots.push(stage);
  } else if (fault === "changed-bytes") {
    const file = fixture.plan.operations.find(
      (operation) => operation.kind === "file",
    );
    assert.ok(file);
    await writeFile(
      join(stage, file.path),
      "replaced bytes in the original file inode\n",
    );
    protectedRoots.push(stage);
  } else if (fault === "missing-stage") {
    await rename(stage, join(fixture.root, "original-stage"));
    protectedRoots.push(stage, join(fixture.root, "original-stage"));
  }
  const before = await capture(fixture, protectedRoots, "before");
  const report = await fixture.call({ resume: true });
  await assertPreserved(fixture, protectedRoots, before, report);
}

async function liveFault(fixture, fault) {
  let before;
  let protectedRoots;
  let changed = false;
  const directory = fixture.plan.operations.find(
    (operation) =>
      operation.kind === "directory" &&
      !operation.path.includes("/") &&
      fixture.plan.operations.some(
        (child) =>
          child.kind === "file" && child.path.startsWith(`${operation.path}/`),
      ),
  );
  assert.ok(directory, "plan has a top-level directory followed by children");
  const report = await fixture.call({
    checkpoint: async (event) => {
      const checkpoint =
        fault === "cleanup-foreign-child"
          ? "after-publication"
          : "during-publication";
      if (changed || event.checkpoint !== checkpoint) return;
      if (
        fault !== "cleanup-foreign-child" &&
        event.operation?.path !== directory.path
      )
        return;
      changed = true;
      if (fault === "cleanup-foreign-child") {
        const stage = await stageRoot(fixture);
        await writeFile(
          join(stage, "sentinel.txt"),
          "foreign child before cleanup\n",
        );
        protectedRoots = [stage, fixture.outside];
      } else {
        const live = join(fixture.target, directory.path);
        const saved = join(fixture.root, "original-ancestor");
        await rename(live, saved);
        if (fault === "nested-link")
          await symlink(fixture.outside, live, "dir");
        else {
          await mkdir(live);
          await writeFile(
            join(live, "sentinel.txt"),
            "foreign replacement ancestor\n",
          );
        }
        protectedRoots = [live, saved, fixture.outside];
      }
      before = await capture(fixture, protectedRoots, "before");
    },
  });
  assert.ok(changed, "scheduled substitution checkpoint reached");
  await assertPreserved(fixture, protectedRoots, before, report);
}

async function resume(fixture, checkpoint) {
  await interrupt(fixture, checkpoint);
  const result = await fixture.call({ resume: true });
  await writeJson(join(fixture.root, "report.json"), result);
  assert.equal(
    result.outcome,
    "completed",
    `explicit resume after ${checkpoint}`,
  );
  await completedRepeat(fixture);
}

async function approvedPartial(fixture) {
  const file = fixture.plan.operations.find(
    (operation) => operation.kind === "file",
  );
  assert.ok(file && typeof file.contents === "string");
  const path = join(fixture.target, file.path);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, file.contents);
  const before = await readFile(path);
  const report = await fixture.call();
  await writeJson(join(fixture.root, "report.json"), report);
  assert.equal(
    report.outcome,
    "completed",
    "approved partial target completes",
  );
  assert.deepEqual(
    await readFile(path),
    before,
    "matching preexisting bytes preserved",
  );
  await completedRepeat(fixture);
}

async function completedRepeat(fixture) {
  const initial = await fixture.call({ resume: true });
  assert.equal(initial.outcome, "completed");
  const before = await manifest(fixture.target);
  const repeated = await fixture.call({ resume: true });
  assert.equal(repeated.outcome, "completed");
  assert.deepEqual(repeated.operations, []);
  assert.deepEqual(
    await manifest(fixture.target),
    before,
    "completed repeat leaves bytes unchanged",
  );
}

async function assertPreserved(fixture, paths, before, report) {
  const after = await capture(fixture, paths, "after");
  await writeJson(join(fixture.root, "report.json"), report);
  assert.deepEqual(after, before, "protected artifact manifest changed");
  assert.ok(
    ["blocked", "partially-completed"].includes(report.outcome),
    `unsafe substitution refuses, got ${report.outcome}`,
  );
  assert.ok(
    report.evidence.length > 0,
    "refusal explains retained ownership evidence",
  );
}

async function capture(fixture, paths, label) {
  const records = [];
  for (const path of paths)
    records.push({ path, entries: await manifest(path) });
  await writeJson(join(fixture.root, `${label}.json`), records);
  return records;
}

async function manifest(root) {
  const entries = [];
  async function visit(path, relative) {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") {
        entries.push({ path: relative, kind: "absent" });
        return;
      }
      throw error;
    }
    if (metadata.isSymbolicLink())
      entries.push({
        path: relative,
        kind: "link",
        target: await readlink(path),
      });
    else if (metadata.isDirectory()) {
      entries.push({
        path: relative,
        kind: "directory",
        device: String(metadata.dev),
        inode: String(metadata.ino),
      });
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else
      entries.push({
        path: relative,
        kind: "file",
        device: String(metadata.dev),
        inode: String(metadata.ino),
        size: metadata.size,
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      });
  }
  await visit(root, "");
  return entries;
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const researchProfile = `# URECA Y2 \u2014 Example research project

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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [root, evidence, selected] = process.argv.slice(2);
  assert.ok(
    root && evidence,
    "usage: node probes.mjs PRODUCT_ROOT EVIDENCE_ROOT [CASE]",
  );
  const results = await runSchedules(
    resolve(root),
    resolve(evidence),
    (id) => selected === undefined || id.endsWith(`/${selected}`),
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  process.exitCode = results.some(({ outcome }) => outcome !== "passed")
    ? 1
    : 0;
}
