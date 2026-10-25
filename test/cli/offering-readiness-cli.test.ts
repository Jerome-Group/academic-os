import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it } from "node:test";

import type { AcademicConfig } from "../../src/config/index.js";
import { moduleControlPaths } from "../../src/conformance/control-paths.js";
import type { ImportStatusReceipt } from "../../src/imports/index.js";
import type { OfferingReadinessReport } from "../../src/offering/readiness.js";
import {
  moduleControlContents,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { runCliWithEnvironment } from "../support/run-cli.js";
import {
  collidingSourceMaps,
  nativeObjectSourceMap,
  nativeObjectPaths,
  nativeObjectLearningUnits,
} from "../fixtures/source-map-identity.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(modules = ["MH2100"]) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-readiness-"));
  temporaryRoots.push(root);
  const config: AcademicConfig = {
    driveMount: join(root, "Drive"),
    stateRoot: join(root, "State"),
    activeSemester: "Y2S1",
    semesters: {
      Y1S2: { root: "Modules/Y1S2", status: "past", modules: ["MH1100"] },
      Y2S1: { root: "Modules/Y2S1", status: "active", modules },
      Y2S2: { root: "Modules/Y2S2", status: "future", modules: ["MH2200"] },
    },
  };
  await mkdir(config.driveMount);
  await mkdir(config.stateRoot);
  await writeFile(
    join(config.stateRoot, "retained-evidence.json"),
    '{"fixture":"must remain unchanged"}\n',
  );
  const configPath = join(root, "academic-os.config.json");
  await writeFile(configPath, JSON.stringify(config));
  const moduleRoot = (code = "MH2100") =>
    join(config.driveMount, "Modules/Y2S1", code);
  for (const code of modules) {
    const controls = validModuleControls();
    controls.taskRegister = "list_id: synthetic-list\ntasks: []\n";
    controls.sourceMap = `units:
  Week 10:
    topics: [Integration]
    lectures: [10 Learning Materials/10 Lecture Materials/${code}_Lecture_10.pdf]
    textbook: []
    tutorials: []
  Week 02:
    topics: [Limits]
    lectures: [10 Learning Materials/10 Lecture Materials/${code}_Lecture_02.pdf]
    textbook: []
    tutorials: []
`;
    for (const [path, source] of moduleControlContents(controls)) {
      await mkdir(dirname(join(moduleRoot(code), path)), { recursive: true });
      await writeFile(
        join(moduleRoot(code), path),
        source.replaceAll("MH2100", code),
      );
    }
    await mkdir(join(moduleRoot(code), "NTULearn"));
    const lectures = join(
      moduleRoot(code),
      "10 Learning Materials/10 Lecture Materials",
    );
    await mkdir(lectures, { recursive: true });
    for (const unit of ["10", "02"])
      await writeFile(
        join(lectures, `${code}_Lecture_${unit}.pdf`),
        "synthetic source",
      );
    await writeFile(
      join(moduleRoot(code), "NTULearn/Sync status.json"),
      JSON.stringify(receipt()),
    );
  }
  return { root, config, configPath, moduleRoot };
}

it("retains invalid learning evidence for colliding identities in readiness", async () => {
  const target = await fixture();
  for (const source of collidingSourceMaps) {
    await writeFile(
      join(target.moduleRoot(), moduleControlPaths.sourceMap),
      source,
    );
    const result = await run(target);
    assert.notEqual(result.exitCode, 0, result.stdout);
    const module = firstModule(JSON.parse(result.stdout));
    assert.notEqual(module.outcome, "ready");
    assert.equal(module.checks.learningMaterials.kind, "observed");
    if (module.checks.learningMaterials.kind === "observed") {
      assert.equal(module.checks.learningMaterials.evidence.outcome, "invalid");
      assert.deepEqual(module.checks.learningMaterials.evidence.units, []);
      assert.match(
        module.checks.learningMaterials.evidence.problems.join(" "),
        /YAML mapping keys/u,
      );
    }
  }
});

it("retains both complete Date-merge and raw-alias payloads in compiled readiness evidence", async () => {
  const target = await fixture();
  await writeFile(
    join(target.moduleRoot(), moduleControlPaths.sourceMap),
    nativeObjectSourceMap,
  );
  for (const path of nativeObjectPaths)
    await writeFile(join(target.moduleRoot(), path), `synthetic ${path}`);
  const result = await run(target);
  assert.equal(result.exitCode, 1, result.stdout + result.stderr);
  const learning = firstModule(JSON.parse(result.stdout)).checks
    .learningMaterials;
  assert.equal(learning.kind, "observed");
  if (learning.kind === "observed") {
    assert.equal(learning.evidence.outcome, "gaps");
    assert.deepEqual(learning.evidence.units, nativeObjectLearningUnits);
    assert.deepEqual(learning.evidence.missingFiles, []);
    assert.equal(learning.evidence.summary.references, 14);
    assert.equal(learning.evidence.summary.declaredMissing, 2);
  }
});

function receipt(
  status: ImportStatusReceipt["status"] = "complete",
  ageHours = 1,
): ImportStatusReceipt {
  const finishedAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();
  return {
    schemaVersion: 1,
    producer: "ntulearn",
    status,
    startedAt: new Date(Date.parse(finishedAt) - 60_000).toISOString(),
    finishedAt: status === "running" ? null : finishedAt,
    lastSuccessfulAt: status === "complete" ? finishedAt : null,
    counts: {
      downloaded: 0,
      skipped: 0,
      markdown: 0,
      uncopied: 0,
      failures: status === "partial" || status === "failed" ? 1 : 0,
    },
    unread: [],
  };
}

async function snapshot(root: string, prefix = ""): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    const metadata = await lstat(path);
    const kind = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isDirectory()
        ? "directory"
        : "file";
    entries.push({
      path: relative,
      kind,
      mode: metadata.mode,
      modifiedAt: metadata.mtimeMs,
      contents:
        kind === "file"
          ? createHash("sha256")
              .update(await readFile(path))
              .digest("hex")
          : kind === "symlink"
            ? await readlink(path)
            : null,
    });
    if (kind === "directory") entries.push(...(await snapshot(path, relative)));
  }
  return entries;
}

async function run(
  target: Awaited<ReturnType<typeof fixture>>,
  options: string[] = ["--json"],
) {
  const before = await snapshot(target.root);
  const result = await runCliWithEnvironment(
    {
      GOOGLE_APPLICATION_CREDENTIALS: join(
        target.root,
        "no-google-credentials.json",
      ),
    },
    "offering",
    "readiness",
    "--config",
    target.configPath,
    ...options,
  );
  assert.deepEqual(
    await snapshot(target.root),
    before,
    "mounted files, private state and configuration remain unchanged",
  );
  return result;
}

function firstModule(report: OfferingReadinessReport) {
  const module = report.modules[0];
  assert.ok(module);
  return module;
}

it("groups ready local evidence without Google credentials and preserves selection and unit order", async () => {
  const target = await fixture();
  const result = await run(target);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const report: OfferingReadinessReport = JSON.parse(result.stdout);
  assert.equal(report.outcome, "ready");
  assert.equal(report.maxAgeHours, 36);
  assert.equal(report.evidence, "local-only");
  assert.deepEqual(report.unverified, [
    "live Google access",
    "task freshness",
    "destination preflight",
    "learning mastery",
  ]);
  assert.deepEqual(report.groups, {
    ready: [{ semester: "Y2S1", module: "MH2100" }],
    attention: [],
    unobserved: [],
  });
  assert.deepEqual(report.selection.excluded, [
    { semester: "Y1S2", module: "MH1100", reason: "past" },
    { semester: "Y2S2", module: "MH2200", reason: "future" },
  ]);
  const module = firstModule(report);
  assert.deepEqual(
    Object.values(module.checks).map(({ status }) => status),
    ["ready", "ready", "ready", "ready"],
  );
  assert.equal(module.checks.tasks.kind, "observed");
  if (module.checks.tasks.kind === "observed")
    assert.deepEqual(module.checks.tasks.evidence.binding, "bound");
  assert.equal(module.checks.learningMaterials.kind, "observed");
  if (module.checks.learningMaterials.kind === "observed")
    assert.deepEqual(
      module.checks.learningMaterials.evidence.units.map(({ unit }) => unit),
      ["Week 10", "Week 02"],
    );
  const human = await run(target, []);
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, /ready: Y2S1\/MH2100/u);
  assert.match(
    human.stdout,
    /unverified: live Google access, task freshness, destination preflight, learning mastery/u,
  );
});

it("keeps simultaneous control, import, material and binding findings with existing action IDs", async () => {
  const target = await fixture();
  await writeFile(
    join(target.moduleRoot(), "AGENTS.md"),
    "stale pinned copy\n",
  );
  await writeFile(
    join(target.moduleRoot(), moduleControlPaths.taskRegister),
    "tasks: []\n",
  );
  await writeFile(
    join(target.moduleRoot(), "NTULearn/Sync status.json"),
    JSON.stringify(receipt("complete", 48)),
  );
  await rm(
    join(
      target.moduleRoot(),
      "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_02.pdf",
    ),
  );
  const result = await run(target);
  assert.equal(result.exitCode, 1, result.stdout);
  const report: OfferingReadinessReport = JSON.parse(result.stdout);
  const module = firstModule(report);
  assert.equal(report.outcome, "attention");
  assert.ok(
    Object.values(module.checks).every(({ status }) => status === "attention"),
  );
  assert.deepEqual(
    module.nextActions.map(({ command }) => command),
    [
      "audit",
      "pinned refresh",
      "imports status",
      "learning materials",
      "tasks provision",
    ],
  );
  assert.equal(module.checks.imports.kind, "observed");
  if (module.checks.imports.kind === "observed")
    assert.equal(module.checks.imports.evidence[0]?.status, "stale");
  assert.equal(module.checks.learningMaterials.kind, "observed");
  if (module.checks.learningMaterials.kind === "observed")
    assert.deepEqual(module.checks.learningMaterials.evidence.missingFiles, [
      "10 Learning Materials/10 Lecture Materials/MH2100_Lecture_02.pdf",
    ]);
  const human = await run(target, []);
  assert.equal(human.exitCode, 1);
  for (const expression of [
    /controls: attention/u,
    /NTULearn: stale/u,
    /Week 02: gaps/u,
    /Tasks unbound/u,
    /Suggested tasks provision/u,
  ])
    assert.match(human.stdout, expression);
});

it("retains healthy siblings when missing or unreadable Modules are unobserved", async () => {
  const target = await fixture();
  const active = target.config.semesters.Y2S1;
  assert.ok(active);
  active.modules.push("MH2101");
  await writeFile(target.configPath, JSON.stringify(target.config));
  const result = await run(target);
  assert.equal(result.exitCode, 2);
  const report: OfferingReadinessReport = JSON.parse(result.stdout);
  assert.deepEqual(
    report.modules.map(({ outcome }) => outcome),
    ["ready", "unobserved"],
  );
  assert.equal(report.groups.ready[0]?.module, "MH2100");
  assert.equal(report.groups.unobserved[0]?.module, "MH2101");
  await writeFile(
    join(target.moduleRoot(), moduleControlPaths.sourceMap),
    Buffer.from([0xff]),
  );
  const unreadable: OfferingReadinessReport = JSON.parse(
    (await run(target)).stdout,
  );
  const module = firstModule(unreadable);
  assert.equal(module.checks.controls.kind, "unavailable");
  assert.equal(module.checks.learningMaterials.kind, "unavailable");
  assert.equal(module.checks.tasks.kind, "unavailable");
  assert.equal(module.checks.imports.status, "ready");
});

it("reports known control decisions as attention while retaining the other ready checks", async () => {
  const target = await fixture();
  const profilePath = join(target.moduleRoot(), moduleControlPaths.profile);
  const profile = await readFile(profilePath, "utf8");
  await writeFile(
    profilePath,
    profile.replace(
      "| Semester | 1 | Definition |",
      "| Semester | 2 | Definition |",
    ),
  );
  const result = await run(target);
  assert.equal(result.exitCode, 1, result.stdout);
  const module = firstModule(JSON.parse(result.stdout));
  assert.equal(module.outcome, "attention");
  assert.equal(module.checks.controls.status, "attention");
  assert.equal(module.checks.controls.kind, "observed");
  if (module.checks.controls.kind === "observed")
    assert.ok(
      module.checks.controls.evidence.findings.some(
        ({ ruleId, status }) =>
          ruleId === "MF-PROFILE-003" && status === "requires-decision",
      ),
    );
  assert.equal(module.checks.imports.status, "ready");
  assert.equal(module.checks.learningMaterials.status, "ready");
  assert.equal(module.checks.tasks.status, "ready");
});

it("keeps malformed Source Maps independent of unbound Tasks and failed imports", async () => {
  const target = await fixture();
  await writeFile(
    join(target.moduleRoot(), moduleControlPaths.sourceMap),
    "units: [\n",
  );
  await writeFile(
    join(target.moduleRoot(), moduleControlPaths.taskRegister),
    "list_id: null\ntasks: []\n",
  );
  await writeFile(
    join(target.moduleRoot(), "NTULearn/Sync status.json"),
    JSON.stringify(receipt("failed")),
  );
  const result = await run(target);
  assert.equal(result.exitCode, 2);
  const module = firstModule(JSON.parse(result.stdout));
  assert.equal(module.outcome, "unobserved");
  assert.equal(module.checks.learningMaterials.status, "unobserved");
  assert.equal(module.checks.tasks.status, "attention");
  assert.equal(module.checks.imports.status, "attention");
  assert.ok(
    module.nextActions.some(({ command }) => command === "tasks provision"),
  );
});

it("validates the complete Task Register before accepting a local list ID", async () => {
  const target = await fixture();
  for (const source of [
    "list_id: synthetic-list\n",
    "list_id: synthetic-list\ntasks: [{title: invalid, status: invented}]\n",
    "list_id: '  '\ntasks: []\n",
    "list_id: 42\ntasks: []\n",
  ]) {
    await writeFile(
      join(target.moduleRoot(), moduleControlPaths.taskRegister),
      source,
    );
    const result = await run(target);
    assert.equal(result.exitCode, 2, source);
    const module = firstModule(JSON.parse(result.stdout));
    assert.equal(module.checks.tasks.status, "unobserved");
    assert.equal(module.checks.tasks.kind, "observed");
    if (module.checks.tasks.kind === "observed") {
      assert.equal(module.checks.tasks.evidence.binding, "invalid");
      assert.equal(module.checks.tasks.evidence.validation.status, "fail");
    }
    assert.equal(module.checks.imports.status, "ready");
    assert.equal(module.checks.learningMaterials.status, "ready");
  }
  await rm(join(target.moduleRoot(), moduleControlPaths.taskRegister));
  assert.equal(
    firstModule(JSON.parse((await run(target)).stdout)).checks.tasks.status,
    "unobserved",
  );
});

it("classifies incomplete receipts as attention and invalid evidence as unobserved", async () => {
  const target = await fixture();
  const receiptPath = join(target.moduleRoot(), "NTULearn/Sync status.json");
  for (const status of ["running", "partial", "failed"] as const) {
    await writeFile(receiptPath, JSON.stringify(receipt(status)));
    const result = await run(target);
    assert.equal(result.exitCode, 1, result.stdout);
    const module = firstModule(JSON.parse(result.stdout));
    assert.equal(module.checks.imports.status, "attention");
    if (module.checks.imports.kind === "observed")
      assert.equal(module.checks.imports.evidence[0]?.status, status);
  }
  await rm(receiptPath);
  assert.equal((await run(target)).exitCode, 1);
  await writeFile(receiptPath, "not JSON");
  assert.equal((await run(target)).exitCode, 2);
  await writeFile(receiptPath, JSON.stringify(receipt("complete", 12)));
  assert.equal((await run(target)).exitCode, 0);
  const stale = await run(target, ["--max-age-hours", "1", "--json"]);
  assert.equal(stale.exitCode, 1);
  assert.equal(JSON.parse(stale.stdout).maxAgeHours, 1);
});

it("never calls an empty cohort or duplicated mapping ready", async () => {
  const target = await fixture([]);
  const empty = await run(target);
  assert.equal(empty.exitCode, 2);
  assert.equal(JSON.parse(empty.stdout).outcome, "unobserved");
  const active = target.config.semesters.Y2S1;
  const future = target.config.semesters.Y2S2;
  assert.ok(active && future);
  active.modules = ["MH2100"];
  future.modules.push("MH2100");
  await writeFile(target.configPath, JSON.stringify(target.config));
  const duplicate = await run(target);
  assert.equal(duplicate.exitCode, 2);
  const report: OfferingReadinessReport = JSON.parse(duplicate.stdout);
  assert.equal(report.modules.length, 0);
  assert.deepEqual(report.selection.unresolved, [
    { semester: "Y2S1", module: "MH2100", reason: "duplicated-module" },
    { semester: "Y2S2", module: "MH2100", reason: "duplicated-module" },
  ]);
});

it("refuses unsafe Module, Source Map and receipt symlinks without following them", async () => {
  const target = await fixture(["MH2100", "MH2101"]);
  const outside = join(target.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "outside must survive");
  await rm(target.moduleRoot("MH2101"), { recursive: true });
  await symlink(outside, target.moduleRoot("MH2101"));
  const missing: OfferingReadinessReport = JSON.parse(
    (await run(target)).stdout,
  );
  assert.deepEqual(
    missing.modules.map(({ outcome }) => outcome),
    ["ready", "unobserved"],
  );
  const sourceMap = join(target.moduleRoot(), moduleControlPaths.sourceMap);
  await rm(sourceMap);
  await symlink(join(outside, "sentinel"), sourceMap);
  assert.equal(
    firstModule(JSON.parse((await run(target)).stdout)).checks.learningMaterials
      .status,
    "unobserved",
  );
  const receiptPath = join(target.moduleRoot(), "NTULearn/Sync status.json");
  await rm(receiptPath);
  await symlink(join(outside, "sentinel"), receiptPath);
  const module = firstModule(JSON.parse((await run(target)).stdout));
  assert.equal(module.checks.imports.status, "unobserved");
  if (module.checks.imports.kind === "observed")
    assert.match(
      module.checks.imports.evidence[0]?.error ?? "",
      /symbolic link/u,
    );
});

it("refuses unknown, duplicate, missing and nonpositive options before loading config", async () => {
  for (const options of [
    ["--wat"],
    ["--apply"],
    ["--max-age-hours", "0"],
    ["--max-age-hours", "-1"],
    ["--max-age-hours", "NaN"],
    ["--max-age-hours", "Infinity"],
    ["--max-age-hours", ""],
    ["--max-age-hours"],
    ["--json", "--json"],
    ["--max-age-hours", "1", "--max-age-hours", "2"],
    ["--config", "again"],
  ]) {
    const result = await runCliWithEnvironment(
      {},
      "offering",
      "readiness",
      "--config",
      "/missing-config",
      "--json",
      ...options,
    );
    assert.equal(result.exitCode, 2);
    assert.equal(
      JSON.parse(result.stdout).error.code,
      "invalid-arguments",
      options.join(" "),
    );
  }
  const missingConfig = await runCliWithEnvironment(
    {},
    "offering",
    "readiness",
    "--json",
  );
  assert.equal(
    JSON.parse(missingConfig.stdout).error.code,
    "invalid-arguments",
  );
});
