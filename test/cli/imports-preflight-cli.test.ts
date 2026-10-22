import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { AcademicConfig } from "../../src/config/index.js";
import type { ImportPreflightReport } from "../../src/imports/index.js";
import { validModuleControls } from "../fixtures/module-controls.js";

const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const ownedRoots: string[] = [];

interface Fixture {
  root: string;
  checkout: string;
  cwd: string;
  configPath: string;
  coursesPath: string;
  config: AcademicConfig;
  moduleRoot: string;
}

afterEach(async () => {
  for (const root of ownedRoots.splice(0)) await rm(root, { recursive: true });
});

async function fixture(roots = ["NTULearn"]): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-preflight-"));
  ownedRoots.push(root);
  const checkout = join(root, "checkout");
  const cwd = join(root, "unrelated-cwd");
  const configPath = join(root, "academic.json");
  const coursesPath = join(root, "external-config", "courses.json");
  const config: AcademicConfig = {
    driveMount: join(root, "Drive"),
    stateRoot: join(root, "State"),
    activeSemester: "Y2S1",
    semesters: {
      Y1S2: { root: "Modules/Y1S2", status: "past", modules: ["MH1100"] },
      Y2S1: { root: "Modules/Y2S1", status: "active", modules: ["MH2100"] },
      Y2S2: { root: "Modules/Y2S2", status: "future", modules: ["MH2200"] },
    },
    tasks: {
      credentials: {
        scheduledRead: join(root, "no-credentials"),
        interactiveWrite: join(root, "no-credentials"),
      },
    },
  };
  const moduleRoot = join(config.driveMount, "Modules", "Y2S1", "MH2100");
  for (const directory of [
    cwd,
    config.stateRoot,
    join(checkout, "src"),
    join(checkout, "config"),
    join(root, "external-config"),
  ])
    await mkdir(directory, { recursive: true });
  await writeFile(
    join(checkout, "src", "config.mjs"),
    'throw new Error("Supplied checkout code must never execute");\n',
  );
  await writeFile(
    join(config.stateRoot, "retained.bin"),
    Buffer.from([0, 1, 255]),
  );
  await definition(moduleRoot, roots);
  await writeFile(configPath, JSON.stringify(config));
  await writeCourses({ coursesPath }, []);
  return { root, checkout, cwd, configPath, coursesPath, config, moduleRoot };
}

async function definition(
  moduleRoot: string,
  roots = ["NTULearn"],
): Promise<void> {
  await mkdir(join(moduleRoot, "00 Module Admin"), { recursive: true });
  for (const root of roots)
    await mkdir(join(moduleRoot, root), { recursive: true });
  const source = (validModuleControls().definition ?? "")
    .replaceAll("MH2100", moduleRoot.split("/").at(-1) ?? "MH2100")
    .replace(
      "    - {role: primary, destination: NTULearn, evidence: [course-site]}",
      roots
        .map(
          (destination, index) =>
            `    - {role: ${index === 0 ? "primary" : "tutorials"}, destination: ${destination}, evidence: [course-site]}`,
        )
        .join("\n"),
    );
  await writeFile(
    join(moduleRoot, "00 Module Admin", "10 Module Definition.yaml"),
    source,
  );
}

function course(
  destination: string,
  key = "arbitrary-key",
  courseId = "unverified-site",
): object {
  return { key, courseId, destination };
}

async function writeCourses(
  target: Pick<Fixture, "coursesPath">,
  courses: unknown[],
): Promise<void> {
  await writeFile(
    target.coursesPath,
    JSON.stringify({
      courses,
      profilePath: "/never-read-profile",
      statePath: "/never-read-state",
    }),
  );
}

async function drive(
  target: Fixture,
  options: { args?: string[]; configPath?: string; human: true },
): Promise<{ stdout: string; exitCode: number }>;
async function drive(
  target: Fixture,
  options?: { args?: string[]; configPath?: string; human?: false },
): Promise<{ report: ImportPreflightReport; stdout: string; exitCode: number }>;
async function drive(
  target: Fixture,
  options: { args?: string[]; configPath?: string; human?: boolean } = {},
): Promise<{
  report?: ImportPreflightReport;
  stdout: string;
  exitCode: number;
}> {
  const before = await snapshot(target.root);
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "imports",
      "preflight",
      "--config",
      target.configPath,
      "--ntulearn-config",
      options.configPath ?? target.coursesPath,
      "--ntulearn-root",
      target.checkout,
      ...(options.human ? [] : ["--json"]),
      ...(options.args ?? []),
    ],
    {
      cwd: target.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GOOGLE_APPLICATION_CREDENTIALS: join(target.root, "no-credentials"),
      },
    },
  );
  assert.equal(result.stderr, "");
  assert.equal(result.error, undefined);
  assert.deepEqual(
    await snapshot(target.root),
    before,
    "configuration, checkout, mount and private-state bytes stay unchanged",
  );
  const resultText = { stdout: result.stdout, exitCode: result.status ?? -1 };
  if (options.human) return resultText;
  const report: ImportPreflightReport = JSON.parse(result.stdout);
  return { ...resultText, report };
}

async function snapshot(root: string): Promise<Array<[string, string]>> {
  const entries: Array<[string, string]> = [];
  async function visit(path: string): Promise<void> {
    const metadata = await lstat(path);
    const name = relative(root, path);
    if (metadata.isSymbolicLink())
      entries.push([name, `link:${await readlink(path)}`]);
    else if (metadata.isDirectory()) {
      entries.push([name, "directory"]);
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child));
    } else entries.push([name, (await readFile(path)).toString("base64")]);
  }
  await visit(root);
  return entries;
}

it("covers primary/tutorial roots from relative or external configs without inferring identity or reading other controls", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  const sibling = join(target.config.driveMount, "Modules", "Y2S1", "MH2101");
  target.config.semesters.Y2S1?.modules.push("MH2101");
  await definition(sibling);
  await writeFile(target.configPath, JSON.stringify(target.config));
  await mkdir(join(target.moduleRoot, "AGENTS.md"));
  await symlink(
    join(target.root, "absent-control"),
    join(target.moduleRoot, "00 Module Admin", "20 Module Profile.md"),
  );
  const rows = [
    course(
      `./${relative(target.checkout, join(target.moduleRoot, "NTULearn"))}/../NTULearn/`,
      "not-a-module",
      "site-for-other-module",
    ),
    course(
      relative(target.checkout, join(target.moduleRoot, "NTULearn_Tutorial")),
      "another-random-key",
      "tutorial-site",
    ),
    course(join(sibling, "NTULearn"), "unrelated", "site-for-first-module"),
    course(
      join(target.config.driveMount, "Modules", "Y1S2", "MH1100", "NTULearn"),
      "old",
    ),
    course(
      join(target.config.driveMount, "Modules", "Y2S2", "MH2200", "NTULearn"),
      "future",
    ),
  ];
  await writeCourses(target, rows);
  const external = await drive(target);
  assert.equal(external.exitCode, 0, external.stdout);
  assert.equal(external.report.outcome, "ready");
  assert.deepEqual(
    external.report.modules[0]?.roots.map(({ coverage }) => coverage),
    [
      { kind: "matched", courses: [0] },
      { kind: "matched", courses: [1] },
    ],
  );
  assert.deepEqual(
    external.report.courses.slice(3).map(({ scope }) => scope.kind),
    ["excluded", "excluded"],
  );
  assert.deepEqual(
    external.report.selection.excluded.map(({ reason }) => reason),
    ["past", "future"],
  );
  assert.deepEqual(external.report.unverified, [
    "site-to-module-identity",
    "live-provider-visibility",
    "later-sync-safety",
  ]);
  const relativeConfig = join(target.checkout, "config", "courses.json");
  await writeFile(relativeConfig, await readFile(target.coursesPath));
  const relativeResult = await drive(target, {
    configPath: "config/courses.json",
  });
  assert.equal(relativeResult.exitCode, 0, relativeResult.stdout);
  assert.deepEqual(relativeResult.report.modules, external.report.modules);
  const human = await drive(target, { human: true });
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, /NTULearn_Tutorial: matched/u);
  assert.match(human.stdout, /site-to-module-identity/u);
  assert.match(human.stdout, /Y1S2\/MH1100 \(past\)/u);
});

it("reports missing, interior/curated mismatches and extra routes independently", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn", "nested"), "inside"),
    course(join(target.moduleRoot, "10 Lectures"), "curated"),
    course(join(target.root, "unmapped"), "extra"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 1, result.stdout);
  assert.deepEqual(result.report.findings.map(({ kind }) => kind).sort(), [
    "extra",
    "mismatch",
    "mismatch",
    "missing",
    "missing",
  ]);
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ coverage }) => coverage.kind),
    ["missing", "missing"],
  );
  const human = await drive(target, { human: true });
  for (const kind of ["missing", "mismatch", "extra"])
    assert.match(human.stdout, new RegExp(`${kind}:`, "u"));
});

it("certifies complete canonical aliases and projected missing final roots without creating them", async () => {
  const target = await fixture();
  const alias = join(target.root, "alias");
  await symlink(target.moduleRoot, alias);
  await writeCourses(target, [course(join(alias, "NTULearn"))]);
  assert.equal((await drive(target)).exitCode, 0);
  await rm(join(target.moduleRoot, "NTULearn"), { recursive: true });
  const projected = await drive(target);
  assert.equal(projected.exitCode, 0, projected.stdout);
  assert.equal(projected.report.modules[0]?.roots[0]?.directory, "absent");
  assert.equal(projected.report.modules[0]?.roots[0]?.coverage.kind, "matched");
});

it("rejects declared roots sharing one physical directory without hiding known coverage", async (context) => {
  const destinations = ["NTULearn", "ntulearn"];
  const target = await fixture(destinations);
  const directories = await Promise.all(
    destinations.map(async (destination) => {
      const path = join(target.moduleRoot, destination);
      const metadata = await lstat(path);
      assert.ok(metadata.isDirectory());
      return {
        canonical: await realpath(path),
        device: metadata.dev,
        inode: metadata.ino,
      };
    }),
  );
  await writeCourses(target, [course(join(target.moduleRoot, "NTULearn"))]);
  if (directories[0]?.canonical !== directories[1]?.canonical) {
    context.diagnostic(
      "Canonical coalescence unavailable on this filesystem; distinct declared roots must retain matched/missing coverage.",
    );
    assert.notDeepEqual(directories[0], directories[1]);
    const distinct = await drive(target);
    assert.equal(distinct.exitCode, 1, distinct.stdout);
    assert.deepEqual(
      distinct.report.modules[0]?.roots.map(({ coverage }) => coverage),
      [{ kind: "matched", courses: [0] }, { kind: "missing" }],
    );
    assert.deepEqual(
      distinct.report.findings.map(({ kind }) => kind),
      ["missing"],
    );
    return;
  }
  assert.deepEqual(directories[0], directories[1]);
  context.diagnostic(
    `Canonical coalescence observed with identical directory device/inode: ${JSON.stringify(directories)}.`,
  );
  const result = await drive(target);
  assert.equal(result.exitCode, 1, result.stdout);
  assert.equal(result.report.outcome, "attention");
  const conflicts = [
    {
      kind: "declaration-conflict",
      module: { semester: "Y2S1", module: "MH2100" },
      destinations,
      action:
        "Give each declared importer destination a separate physical directory and corresponding NTULearn route.",
    },
  ];
  assert.deepEqual(result.report.findings, conflicts);
  assert.deepEqual(result.report.problems, []);
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ coverage }) => coverage),
    [
      { kind: "matched", courses: [0] },
      { kind: "matched", courses: [0] },
    ],
  );
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ path }) => path.canonical),
    directories.map(({ canonical }) => ({
      kind: "observed",
      value: canonical,
    })),
  );
  const human = await drive(target, { human: true });
  assert.equal(human.exitCode, 1, human.stdout);
  assert.match(
    human.stdout,
    /declaration-conflict: Y2S1\/MH2100.*NTULearn.*ntulearn/u,
  );
  assert.doesNotMatch(human.stdout, /course row undefined/u);
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn")),
    null,
  ]);
  const unknown = await drive(target);
  assert.equal(unknown.exitCode, 2, unknown.stdout);
  assert.equal(unknown.report.outcome, "unobserved");
  assert.deepEqual(unknown.report.findings, conflicts);
  assert.deepEqual(
    unknown.report.courses.map(({ index }) => index),
    [0, 1],
  );
  for (const root of unknown.report.modules[0]?.roots ?? []) {
    assert.equal(root.coverage.kind, "unobserved");
    if (root.coverage.kind === "unobserved")
      assert.deepEqual(root.coverage.knownMatches, [0]);
  }
});

it("retains a known declaration conflict beside an unsafe sibling root", async (context) => {
  const target = await fixture(["NTULearn", "ntulearn", "NTULearn_Unsafe"]);
  const canonical = await Promise.all(
    ["NTULearn", "ntulearn"].map((destination) =>
      realpath(join(target.moduleRoot, destination)),
    ),
  );
  await rm(join(target.moduleRoot, "NTULearn_Unsafe"), { recursive: true });
  await symlink(target.cwd, join(target.moduleRoot, "NTULearn_Unsafe"));
  await writeCourses(target, [course(join(target.moduleRoot, "NTULearn"))]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.equal(result.report.outcome, "unobserved");
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ coverage }) => coverage.kind),
    canonical[0] === canonical[1]
      ? ["matched", "matched", "unobserved"]
      : ["matched", "missing", "unobserved"],
  );
  assert.ok(
    result.report.problems.some(({ code }) => code === "symlink-target"),
  );
  if (canonical[0] !== canonical[1]) {
    context.diagnostic(
      "Canonical coalescence unavailable on this filesystem; unsafe sibling retains distinct-root matched/missing evidence.",
    );
    assert.deepEqual(
      result.report.findings.map(({ kind }) => kind),
      ["missing"],
    );
    return;
  }
  assert.deepEqual(result.report.findings, [
    {
      kind: "declaration-conflict",
      module: { semester: "Y2S1", module: "MH2100" },
      destinations: ["NTULearn", "ntulearn"],
      action:
        "Give each declared importer destination a separate physical directory and corresponding NTULearn route.",
    },
  ]);
  assert.deepEqual(
    result.report.modules[0]?.roots.slice(0, 2).map(({ coverage }) => coverage),
    [
      { kind: "matched", courses: [0] },
      { kind: "matched", courses: [0] },
    ],
  );
});

it("reports every pair of declarations sharing a physical directory", async (context) => {
  const destinations = ["NTULearn", "ntulearn", "NTULEARN"];
  const target = await fixture(destinations);
  const canonical = await Promise.all(
    destinations.map((destination) =>
      realpath(join(target.moduleRoot, destination)),
    ),
  );
  await writeCourses(target, [course(join(target.moduleRoot, "NTULearn"))]);
  const result = await drive(target);
  assert.equal(result.exitCode, 1, result.stdout);
  if (new Set(canonical).size === destinations.length) {
    context.diagnostic(
      "Canonical coalescence unavailable on this filesystem; all three declaration directories are physically distinct.",
    );
    assert.deepEqual(
      result.report.findings.map(({ kind }) => kind),
      ["missing", "missing"],
    );
    assert.deepEqual(
      result.report.modules[0]?.roots.map(({ coverage }) => coverage.kind),
      ["matched", "missing", "missing"],
    );
    return;
  }
  assert.equal(new Set(canonical).size, 1);
  assert.deepEqual(
    result.report.findings,
    [
      ["NTULearn", "ntulearn"],
      ["NTULearn", "NTULEARN"],
      ["ntulearn", "NTULEARN"],
    ].map((destinations) => ({
      kind: "declaration-conflict",
      module: { semester: "Y2S1", module: "MH2100" },
      destinations,
      action:
        "Give each declared importer destination a separate physical directory and corresponding NTULearn route.",
    })),
  );
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ coverage }) => coverage),
    destinations.map(() => ({ kind: "matched", courses: [0] })),
  );
});

it("retains all pairwise key, lexical and physical collisions including excluded routes", async () => {
  const target = await fixture();
  const alias = join(target.root, "alias");
  const oldRoot = join(target.config.driveMount, "Modules", "Y1S2", "MH1100");
  const oldAlias = join(target.root, "old-alias");
  await symlink(target.moduleRoot, alias);
  await mkdir(oldRoot, { recursive: true });
  await symlink(oldRoot, oldAlias);
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn"), "SAME"),
    course(`${join(target.moduleRoot, "NTULearn")}/../NTULearn/`, "same"),
    course(join(alias, "NTULearn"), "alias"),
    course(join(alias, "NTULearn", "child"), "nested"),
    course(join(oldRoot, "NTULearn"), "old"),
    course(join(oldAlias, "NTULearn", "child"), "old-child"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 1, result.stdout);
  const conflicts = result.report.findings.filter(
    (finding) => finding.kind === "conflict",
  );
  assert.deepEqual(
    conflicts.map(({ courses }) => courses),
    [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
      [4, 5],
    ],
  );
  assert.deepEqual(conflicts[0]?.reasons, [
    "duplicate-key",
    "equal-lexical",
    "equal-physical",
  ]);
  assert.deepEqual(conflicts[1]?.reasons, ["equal-physical"]);
  assert.deepEqual(conflicts.at(-1)?.reasons, ["nested-physical"]);
  assert.deepEqual(result.report.modules[0]?.roots[0]?.coverage, {
    kind: "matched",
    courses: [0, 1, 2],
  });
  assert.deepEqual(
    result.report.courses.slice(4).map(({ scope }) => scope.kind),
    ["excluded", "excluded"],
  );
});

it("separates case-folded collisions from exact projected-root coverage", async () => {
  const target = await fixture();
  await rm(join(target.moduleRoot, "NTULearn"), { recursive: true });
  await writeCourses(target, [
    course(join(target.moduleRoot, "ntulearn"), "lower"),
  ]);
  const wrongCase = await drive(target);
  assert.equal(wrongCase.exitCode, 1, wrongCase.stdout);
  assert.equal(wrongCase.report.modules[0]?.roots[0]?.coverage.kind, "missing");
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn"), "upper"),
    course(join(target.moduleRoot, "ntulearn"), "lower"),
  ]);
  const collided = await drive(target);
  assert.equal(collided.exitCode, 1, collided.stdout);
  assert.deepEqual(collided.report.modules[0]?.roots[0]?.coverage, {
    kind: "matched",
    courses: [0],
  });
  assert.ok(
    collided.report.findings.some(
      (finding) =>
        finding.kind === "conflict" &&
        finding.reasons.includes("equal-lexical"),
    ),
  );
});

it("retains usable destinations, known matches and actionable findings beside malformed rows", async () => {
  const target = await fixture();
  await writeCourses(target, [
    null,
    {
      key: null,
      courseId: "site",
      destination: join(target.moduleRoot, "NTULearn"),
    },
    { key: "no-id", destination: join(target.moduleRoot, "NTULearn") },
    course(join(target.moduleRoot, "10 Lectures"), "curated"),
    course(join(target.root, "extra"), "extra"),
    { key: "extra", courseId: "site", destination: 55 },
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(
    result.report.courses.map(({ index }) => index),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(result.report.courses[1]?.destination.kind, "observed");
  const coverage = result.report.modules[0]?.roots[0]?.coverage;
  assert.equal(coverage?.kind, "unobserved");
  if (coverage?.kind === "unobserved")
    assert.deepEqual(coverage.knownMatches, [1, 2]);
  assert.deepEqual(result.report.findings.map(({ kind }) => kind).sort(), [
    "conflict",
    "conflict",
    "extra",
    "mismatch",
  ]);
  assert.ok(
    result.report.problems.some(({ code }) => code === "invalid-course-key"),
  );
  assert.ok(
    result.report.problems.some(({ code }) => code === "invalid-course-id"),
  );
});

it("keeps producer-wide malformed evidence unobserved rather than inventing missing routes", async () => {
  const target = await fixture();
  for (const source of ["not JSON", "[]", '{"courses":{}}']) {
    await writeFile(target.coursesPath, source);
    const result = await drive(target);
    assert.equal(result.exitCode, 2, result.stdout);
    assert.equal(
      result.report.modules[0]?.roots[0]?.coverage.kind,
      "unobserved",
    );
    assert.deepEqual(result.report.findings, []);
  }
  await rm(target.coursesPath);
  assert.equal((await drive(target)).exitCode, 2);
  await writeCourses(target, []);
  const empty = await drive(target);
  assert.equal(empty.exitCode, 1, empty.stdout);
  assert.equal(empty.report.modules[0]?.roots[0]?.coverage.kind, "missing");
});

it("preserves healthy Module findings beside invalid Definitions and unresolved targets", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  target.config.semesters.Y2S1?.modules.push("MH2101", "MH2102");
  const invalidRoot = join(
    target.config.driveMount,
    "Modules",
    "Y2S1",
    "MH2101",
  );
  await definition(invalidRoot);
  await writeFile(
    join(invalidRoot, "00 Module Admin", "10 Module Definition.yaml"),
    "sources: {ntulearn: [{destination: ../unsafe}]}\n",
  );
  await writeFile(target.configPath, JSON.stringify(target.config));
  await writeCourses(target, [course(join(target.moduleRoot, "10 Lectures"))]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(
    result.report.modules.map(({ kind }) => kind),
    ["observed", "unobserved", "unobserved"],
  );
  assert.deepEqual(result.report.findings.map(({ kind }) => kind).sort(), [
    "mismatch",
    "missing",
    "missing",
  ]);
  assert.deepEqual(
    result.report.selection.unresolved.map(({ module }) => module),
    ["MH2101", "MH2102"],
  );
});

it("does not certify unsafe declared roots or lose safe sibling roots", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  await rm(join(target.moduleRoot, "NTULearn"), { recursive: true });
  await mkdir(join(target.root, "outside"));
  await symlink(
    join(target.root, "outside"),
    join(target.moduleRoot, "NTULearn"),
  );
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn"), "unsafe"),
    course(join(target.moduleRoot, "NTULearn_Tutorial"), "safe"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(
    result.report.modules[0]?.roots.map(({ coverage }) => coverage.kind),
    ["unobserved", "matched"],
  );
  const coverage = result.report.modules[0]?.roots[0]?.coverage;
  if (coverage?.kind === "unobserved")
    assert.deepEqual(coverage.knownMatches, [0]);
  assert.ok(
    result.report.problems.some(({ code }) => code === "symlink-target"),
  );
});

it("withholds missing coverage for unknown physical destinations while retaining collisions and extras", async () => {
  const target = await fixture(["NTULearn", "NTULearn_Tutorial"]);
  const dangling = join(target.root, "dangling");
  await symlink(join(target.root, "not-mounted"), dangling);
  await writeCourses(target, [
    course(join(dangling, "NTULearn"), "unobserved"),
    course(join(target.moduleRoot, "NTULearn"), "first"),
    course(join(target.moduleRoot, "NTULearn"), "second"),
    course(join(target.root, "extra"), "extra"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(result.report.findings.map(({ kind }) => kind).sort(), [
    "conflict",
    "extra",
  ]);
  const coverage = result.report.modules[0]?.roots[0]?.coverage;
  assert.equal(coverage?.kind, "unobserved");
  if (coverage?.kind === "unobserved")
    assert.deepEqual(coverage.knownMatches, [1, 2]);
  assert.equal(result.report.modules[0]?.roots[1]?.coverage.kind, "unobserved");
});

it("withholds extra scope where an unobserved configured boundary could own an alias", async () => {
  const target = await fixture();
  target.config.semesters.Y2S1?.modules.push("MH2101");
  const unknownModule = join(
    target.config.driveMount,
    "Modules",
    "Y2S1",
    "MH2101",
  );
  await symlink(join(target.root, "not-mounted"), unknownModule);
  await writeFile(target.configPath, JSON.stringify(target.config));
  await writeCourses(target, [
    course(join(target.root, "elsewhere"), "one"),
    course(join(target.root, "elsewhere"), "two"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(result.report.findings.map(({ kind }) => kind).sort(), [
    "conflict",
    "missing",
  ]);
  assert.deepEqual(
    result.report.courses.map(({ scope }) => scope.kind),
    ["unresolved", "unresolved"],
  );
});

it("retains duplicate mappings and empty active scope as unobserved", async () => {
  const target = await fixture();
  target.config.semesters.Y1S2?.modules.push("MH2100");
  await writeFile(target.configPath, JSON.stringify(target.config));
  await writeCourses(target, [course(join(target.moduleRoot, "NTULearn"))]);
  const duplicated = await drive(target);
  assert.equal(duplicated.exitCode, 2, duplicated.stdout);
  assert.deepEqual(duplicated.report.modules, []);
  assert.deepEqual(
    duplicated.report.selection.unresolved.map(({ reason }) => reason),
    ["duplicated-module", "duplicated-module"],
  );
  assert.equal(duplicated.report.courses[0]?.scope.kind, "unresolved");
  const active = target.config.semesters.Y2S1;
  if (active) active.modules = [];
  const past = target.config.semesters.Y1S2;
  if (past) past.modules = ["MH1100"];
  await writeFile(target.configPath, JSON.stringify(target.config));
  await writeCourses(target, []);
  const empty = await drive(target);
  assert.equal(empty.exitCode, 2, empty.stdout);
  assert.ok(
    empty.report.problems.some(({ code }) => code === "empty-active-scope"),
  );
});

it("withholds missing and extra findings for an unavailable mount while preserving producer conflicts", async () => {
  const target = await fixture();
  await writeCourses(target, [
    course(join(target.moduleRoot, "NTULearn"), "same"),
    course(join(target.moduleRoot, "NTULearn"), "SAME"),
    course(join(target.root, "elsewhere"), "outside"),
  ]);
  await rm(target.config.driveMount, { recursive: true });
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.deepEqual(
    result.report.findings.map(({ kind }) => kind),
    ["conflict"],
  );
  assert.deepEqual(
    result.report.courses.map(({ scope }) => scope.kind),
    ["unresolved", "unresolved", "unresolved"],
  );
  assert.equal(result.report.modules[0]?.kind, "unobserved");
});

it("preserves the existing private state-root prerequisite without creating state", async () => {
  const target = await fixture();
  await rm(target.config.stateRoot, { recursive: true });
  await writeCourses(target, [course(join(target.moduleRoot, "NTULearn"))]);
  const result = await drive(target);
  assert.equal(result.exitCode, 2, result.stdout);
  assert.equal(result.report.modules[0]?.kind, "unobserved");
  assert.ok(
    result.report.problems.some(({ code }) => code === "invalid-config"),
  );
});

it("refuses symlinked Definition components and non-file controls", async () => {
  for (const component of [
    "definition",
    "admin",
    "directory",
    "invalid-utf8",
  ]) {
    const target = await fixture();
    const admin = join(target.moduleRoot, "00 Module Admin");
    const path = join(admin, "10 Module Definition.yaml");
    if (component === "admin") {
      const outside = join(target.root, "outside-admin");
      await mkdir(outside);
      await writeFile(
        join(outside, "10 Module Definition.yaml"),
        await readFile(path),
      );
      await rm(admin, { recursive: true });
      await symlink(outside, admin);
    } else {
      await rm(path);
      if (component === "definition") {
        const outside = join(target.root, "Definition.yaml");
        await writeFile(outside, validModuleControls().definition ?? "");
        await symlink(outside, path);
      } else if (component === "directory") await mkdir(path);
      else await writeFile(path, Buffer.from([255]));
    }
    const result = await drive(target);
    assert.equal(result.exitCode, 2, result.stdout);
    assert.equal(result.report.modules[0]?.kind, "unobserved");
    assert.deepEqual(result.report.findings, []);
  }
});

it("finds nested producer collisions at the filesystem root", async () => {
  const target = await fixture();
  await writeCourses(target, [
    course("/", "root"),
    course(join(target.moduleRoot, "NTULearn"), "nested"),
  ]);
  const result = await drive(target);
  assert.equal(result.exitCode, 1, result.stdout);
  assert.ok(
    result.report.findings.some(
      (finding) =>
        finding.kind === "conflict" &&
        finding.reasons.includes("nested-lexical") &&
        finding.reasons.includes("nested-physical"),
    ),
  );
});

it("strictly refuses unsupported, repeated, positional, missing and relative-root arguments", async () => {
  const target = await fixture();
  for (const args of [
    ["--apply"],
    ["--semester", "Y1S2"],
    ["--module", "MH2100"],
    ["--unknown"],
    ["positional"],
    ["--json"],
    ["--config", target.configPath],
    ["--ntulearn-root", target.checkout],
    ["--ntulearn-config"],
  ]) {
    const result = await drive(target, { args });
    assert.equal(result.exitCode, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
  }
  for (const args of [
    [],
    ["--config", target.configPath],
    ["--config", target.configPath, "--ntulearn-config", target.coursesPath],
    [
      "--config",
      target.configPath,
      "--ntulearn-config",
      target.coursesPath,
      "--ntulearn-root",
      "relative-checkout",
    ],
  ]) {
    const before = await snapshot(target.root);
    const result = spawnSync(
      process.execPath,
      [cliPath, "imports", "preflight", ...args, "--json"],
      { cwd: target.cwd, encoding: "utf8" },
    );
    assert.equal(result.status, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, "invalid-arguments");
    assert.deepEqual(await snapshot(target.root), before);
  }
});
