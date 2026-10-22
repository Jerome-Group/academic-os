import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { planCohortAudit, type CohortSelection } from "../cohort/index.js";
import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { observeModuleImportDestinations } from "../mounted/observe-module-import-destinations.js";
import { OperationalError } from "../operational-error.js";

interface Problem {
  code: string;
  message: string;
  action: string;
}

type Observation<T> =
  | { kind: "observed"; value: T }
  | { kind: "unobserved"; problems: Problem[] };

interface PathEvidence {
  lexical: string;
  canonical: Observation<string>;
}

interface CourseObservation {
  index: number;
  key: Observation<string>;
  usable: Observation<true>;
  destination: Observation<PathEvidence>;
}

type Coverage =
  | { kind: "matched"; courses: number[] }
  | { kind: "missing" }
  | { kind: "unobserved"; knownMatches: number[]; problems: Problem[] };

interface DeclaredRoot {
  destination: string;
  path: PathEvidence;
  directory: "present" | "absent" | "unobserved";
}

type ModuleObservation = { module: ConfiguredModule } & (
  | { kind: "observed"; roots: DeclaredRoot[] }
  | { kind: "unobserved"; problems: Problem[] }
);

type ModuleCoverage = { module: ConfiguredModule } & (
  | { kind: "observed"; roots: Array<DeclaredRoot & { coverage: Coverage }> }
  | { kind: "unobserved"; roots: []; problems: Problem[] }
);

type RouteScope =
  | { kind: "active"; module: ConfiguredModule }
  | { kind: "excluded"; module: ConfiguredModule; reason: "past" | "future" }
  | { kind: "extra" }
  | { kind: "unresolved"; candidates: ConfiguredModule[]; problems: Problem[] };

type ConflictReason =
  | "duplicate-key"
  | "equal-lexical"
  | "nested-lexical"
  | "equal-physical"
  | "nested-physical";

type Finding =
  | {
      kind: "missing";
      module: ConfiguredModule;
      destination: string;
      action: string;
    }
  | {
      kind: "mismatch";
      course: number;
      module: ConfiguredModule;
      expected: string[];
      action: string;
    }
  | { kind: "extra"; course: number; action: string }
  | {
      kind: "conflict";
      courses: [number, number];
      reasons: ConflictReason[];
      action: string;
    };

type Boundary = {
  module: ConfiguredModule;
  path: PathEvidence;
  selection:
    | { kind: "active" }
    | { kind: "excluded"; reason: "past" | "future" }
    | { kind: "unresolved" };
};

export interface ImportPreflightReport {
  schemaVersion: 1;
  mode: "imports-preflight";
  activeSemester: string;
  observedAt: string;
  outcome: "ready" | "attention" | "unobserved";
  selection: CohortSelection;
  modules: ModuleCoverage[];
  courses: Array<CourseObservation & { scope: RouteScope }>;
  findings: Finding[];
  problems: Problem[];
  unverified: [
    "site-to-module-identity",
    "live-provider-visibility",
    "later-sync-safety",
  ];
}

export async function runImportPreflight(input: {
  config: AcademicConfig;
  ntulearnConfigPath: string;
  ntulearnRoot: string;
  observedAt: string;
}): Promise<ImportPreflightReport> {
  if (!isAbsolute(input.ntulearnRoot)) {
    throw new OperationalError(
      "invalid-arguments",
      "NTULearn checkout root must be absolute.",
    );
  }
  const plan = planCohortAudit(input.config);
  const modules: ModuleObservation[] = [];
  for (const config of plan.targets) {
    const module = { semester: config.semester, module: config.module };
    try {
      const observed = await observeModuleImportDestinations(config);
      modules.push({
        module,
        kind: "observed",
        roots: observed.roots.map(({ destination, physical }) => ({
          destination,
          path: {
            lexical: resolve(modulePath(input.config, module), destination),
            canonical:
              physical.kind === "observed"
                ? { kind: "observed", value: physical.canonicalPath }
                : unavailable(physical.error.code, physical.error.message),
          },
          directory:
            physical.kind === "observed" ? physical.directory : "unobserved",
        })),
      });
    } catch (error) {
      const failure =
        error instanceof OperationalError
          ? error
          : new OperationalError(
              "operational-failure",
              "Module importer declarations could not be observed.",
            );
      const observation = unavailable(failure.code, failure.message);
      modules.push({ module, ...observation });
      plan.selection.unresolved.push({ ...module, reason: failure.code });
    }
  }
  const boundaries = await observeBoundaries(input.config, plan.selection);
  const courses = await observeCourses(
    resolve(input.ntulearnRoot, input.ntulearnConfigPath),
    input.ntulearnRoot,
  );
  return {
    schemaVersion: 1,
    mode: "imports-preflight",
    activeSemester: input.config.activeSemester,
    observedAt: input.observedAt,
    selection: plan.selection,
    ...compareDestinations({
      modules,
      boundaries,
      courses,
      selection: plan.selection,
    }),
    unverified: [
      "site-to-module-identity",
      "live-provider-visibility",
      "later-sync-safety",
    ],
  };
}

async function observeBoundaries(
  config: AcademicConfig,
  selection: CohortSelection,
): Promise<Boundary[]> {
  let mount: Observation<true>;
  try {
    const metadata = await lstat(await realpath(config.driveMount));
    mount = metadata.isDirectory()
      ? observed(true)
      : unavailable(
          "unobserved-mount",
          "The configured Drive mount is not a directory.",
        );
  } catch {
    mount = unavailable(
      "unobserved-mount",
      "The configured Drive mount cannot be observed.",
    );
  }
  const boundaries: Boundary[] = [];
  for (const [semester, semesterConfig] of Object.entries(config.semesters)) {
    for (const module of new Set(semesterConfig.modules)) {
      const identity = { semester, module };
      const excluded = selection.excluded.find((entry) =>
        sameModule(entry, identity),
      );
      const lexical = modulePath(config, identity);
      boundaries.push({
        module: identity,
        path: {
          lexical,
          canonical:
            mount.kind === "observed"
              ? await physicalDestination(lexical)
              : mount,
        },
        selection: selection.included.some((entry) =>
          sameModule(entry, identity),
        )
          ? { kind: "active" }
          : excluded === undefined
            ? { kind: "unresolved" }
            : { kind: "excluded", reason: excluded.reason },
      });
    }
  }
  return boundaries;
}

function modulePath(config: AcademicConfig, module: ConfiguredModule): string {
  return resolve(
    config.driveMount,
    config.semesters[module.semester]?.root ?? "",
    module.module,
  );
}

async function observeCourses(
  configPath: string,
  root: string,
): Promise<Observation<CourseObservation[]>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return unavailable(
      "unreadable-ntulearn-config",
      "NTULearn configuration cannot be read as JSON.",
      "Repair the supplied NTULearn configuration file.",
    );
  }
  if (
    !isRecord(value) ||
    (value.courses != null && !Array.isArray(value.courses))
  ) {
    return unavailable(
      "invalid-ntulearn-config",
      "NTULearn configuration requires an object with a courses array.",
      "Repair the supplied NTULearn configuration shape.",
    );
  }
  const courses: unknown[] = value.courses ?? [];
  const rows: CourseObservation[] = [];
  for (const [index, value] of courses.entries()) {
    const row = isRecord(value) ? value : {};
    const key = nonEmptyString(row.key)
      ? observed(row.key)
      : unavailable(
          "invalid-course-key",
          `Course row ${index} has no usable key.`,
        );
    const destination = nonEmptyString(row.destination)
      ? observed({
          lexical: resolve(root, row.destination),
          canonical: await physicalDestination(resolve(root, row.destination)),
        })
      : unavailable(
          "invalid-course-destination",
          `Course row ${index} has no usable destination.`,
        );
    const problems = [
      ...(key.kind === "unobserved" ? key.problems : []),
      ...(destination.kind === "unobserved" ? destination.problems : []),
      ...(!row.courseId
        ? [
            problem(
              "invalid-course-id",
              `Course row ${index} has no courseId.`,
              "Supply the NTULearn site ID without inferring Module identity.",
            ),
          ]
        : []),
    ];
    rows.push({
      index,
      key,
      destination,
      usable: problems.length
        ? { kind: "unobserved", problems }
        : observed(true),
    });
  }
  return observed(rows);
}

async function physicalDestination(
  destination: string,
): Promise<Observation<string>> {
  try {
    let ancestor = destination;
    while (true) {
      const metadata = await lstat(ancestor).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (metadata)
        return observed(
          resolve(await realpath(ancestor), relative(ancestor, destination)),
        );
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error("No accessible filesystem.");
      ancestor = parent;
    }
  } catch {
    return unavailable(
      "unresolved-physical-path",
      "A configured path cannot be resolved physically.",
      "Restore the mounted folder or repair its configured directory or alias before syncing.",
    );
  }
}

function compareDestinations(input: {
  selection: CohortSelection;
  modules: ModuleObservation[];
  boundaries: Boundary[];
  courses: Observation<CourseObservation[]>;
}): Pick<
  ImportPreflightReport,
  "modules" | "courses" | "findings" | "problems" | "outcome"
> {
  const rows = input.courses.kind === "observed" ? input.courses.value : [];
  const problems =
    input.courses.kind === "unobserved" ? [...input.courses.problems] : [];
  const findings: Finding[] = collisionFindings(rows);
  if (input.selection.included.length === 0)
    problems.push(
      problem(
        "empty-active-scope",
        "The active Module cohort contains no resolved Modules.",
        "Configure at least one uniquely mapped active Module.",
      ),
    );
  const modules = input.modules.map((module): ModuleCoverage => {
    if (module.kind === "unobserved") {
      problems.push(...module.problems);
      return { ...module, roots: [] };
    }
    return {
      ...module,
      roots: module.roots.map((root) => {
        const coverage = rootCoverage(root, input.courses);
        if (coverage.kind === "missing")
          findings.push({
            kind: "missing",
            module: module.module,
            destination: root.destination,
            action: `Configure exactly one NTULearn course destination at ${root.path.lexical}.`,
          });
        if (coverage.kind === "unobserved") problems.push(...coverage.problems);
        return { ...root, coverage };
      }),
    };
  });
  const courses = rows.map((row) => {
    if (row.usable.kind === "unobserved") problems.push(...row.usable.problems);
    if (
      row.destination.kind === "observed" &&
      row.destination.value.canonical.kind === "unobserved"
    ) {
      problems.push(...row.destination.value.canonical.problems);
    }
    const scope = routeScope(row.destination, input.boundaries);
    if (scope.kind === "unresolved") problems.push(...scope.problems);
    if (scope.kind === "extra")
      findings.push({
        kind: "extra",
        course: row.index,
        action:
          "Remove the route from this cohort configuration or configure its Module boundary explicitly.",
      });
    if (scope.kind === "active" && row.destination.kind === "observed") {
      const module = input.modules.find((entry) =>
        sameModule(entry.module, scope.module),
      );
      if (module?.kind === "observed") {
        const path = row.destination.value;
        const relations = module.roots.map((root) =>
          compareRoots(root.path, path),
        );
        if (relations.every((relation) => relation === "different"))
          findings.push({
            kind: "mismatch",
            course: row.index,
            module: scope.module,
            expected: module.roots.map(({ path }) => path.lexical),
            action:
              "Point the course at a complete declared importer root. Interior and curated destinations are not importer roots.",
          });
      }
    }
    return { ...row, scope };
  });
  const unknown =
    input.selection.included.length === 0 ||
    input.selection.unresolved.length > 0 ||
    problems.length > 0;
  return {
    modules,
    courses,
    findings,
    problems,
    outcome: unknown ? "unobserved" : findings.length ? "attention" : "ready",
  };
}

function rootCoverage(
  root: DeclaredRoot,
  courses: Observation<CourseObservation[]>,
): Coverage {
  const matches: number[] = [];
  const knownMatches: number[] = [];
  const problems: Problem[] =
    root.path.canonical.kind === "unobserved"
      ? [...root.path.canonical.problems]
      : [];
  if (courses.kind === "unobserved") problems.push(...courses.problems);
  else
    for (const row of courses.value) {
      if (row.destination.kind === "unobserved") {
        problems.push(...row.destination.problems);
        continue;
      }
      const path = row.destination.value;
      const relation = compareRoots(root.path, path);
      if (relation === "matched") matches.push(row.index);
      if (relation === "matched" || root.path.lexical === path.lexical)
        knownMatches.push(row.index);
      if (relation === "unobserved")
        problems.push(
          problem(
            "unobserved-coverage",
            `Course row ${row.index} cannot be ruled in or out for ${root.destination}.`,
            "Resolve physical path evidence before certifying route coverage.",
          ),
        );
    }
  if (problems.length) return { kind: "unobserved", knownMatches, problems };
  return matches.length
    ? { kind: "matched", courses: matches }
    : { kind: "missing" };
}

function compareRoots(
  expected: PathEvidence,
  actual: PathEvidence,
): "matched" | "different" | "unobserved" {
  if (
    expected.canonical.kind === "unobserved" ||
    actual.canonical.kind === "unobserved"
  )
    return "unobserved";
  return expected.canonical.value === actual.canonical.value
    ? "matched"
    : "different";
}

function routeScope(
  destination: Observation<PathEvidence>,
  boundaries: Boundary[],
): RouteScope {
  if (destination.kind === "unobserved")
    return {
      kind: "unresolved",
      candidates: [],
      problems: destination.problems,
    };
  const path = destination.value;
  const candidates = boundaries.filter(
    (boundary) =>
      within(boundary.path.lexical, path.lexical) ||
      (boundary.path.canonical.kind === "observed" &&
        path.canonical.kind === "observed" &&
        within(boundary.path.canonical.value, path.canonical.value)),
  );
  const unknown = boundaries.filter(
    (boundary) =>
      !candidates.includes(boundary) &&
      (boundary.path.canonical.kind === "unobserved" ||
        path.canonical.kind === "unobserved"),
  );
  const boundary = candidates[0];
  if (
    candidates.length !== 1 ||
    unknown.length > 0 ||
    boundary?.selection.kind === "unresolved"
  ) {
    if (candidates.length === 0 && unknown.length === 0)
      return { kind: "extra" };
    return {
      kind: "unresolved",
      candidates: [...candidates, ...unknown].map(({ module }) => module),
      problems: [
        problem(
          "unresolved-route-scope",
          "The route cannot be assigned uniquely to a configured Module boundary.",
          "Resolve the Module mapping and physical boundary evidence.",
        ),
      ],
    };
  }
  if (boundary === undefined) return { kind: "extra" };
  return boundary.selection.kind === "excluded"
    ? {
        kind: "excluded",
        module: boundary.module,
        reason: boundary.selection.reason,
      }
    : { kind: "active", module: boundary.module };
}

function collisionFindings(rows: CourseObservation[]): Finding[] {
  const findings: Finding[] = [];
  for (const [index, left] of rows.entries()) {
    for (const right of rows.slice(index + 1)) {
      const reasons: ConflictReason[] = [];
      if (
        left.key.kind === "observed" &&
        right.key.kind === "observed" &&
        left.key.value.toLowerCase() === right.key.value.toLowerCase()
      )
        reasons.push("duplicate-key");
      if (
        left.destination.kind === "observed" &&
        right.destination.kind === "observed"
      ) {
        const leftPath = left.destination.value;
        const rightPath = right.destination.value;
        const lexical = collision(leftPath.lexical, rightPath.lexical);
        if (lexical !== null)
          reasons.push(
            lexical === "equal" ? "equal-lexical" : "nested-lexical",
          );
        if (
          leftPath.canonical.kind === "observed" &&
          rightPath.canonical.kind === "observed"
        ) {
          const physical = collision(
            leftPath.canonical.value,
            rightPath.canonical.value,
          );
          if (physical !== null)
            reasons.push(
              physical === "equal" ? "equal-physical" : "nested-physical",
            );
        }
      }
      if (reasons.length)
        findings.push({
          kind: "conflict",
          courses: [left.index, right.index],
          reasons,
          action:
            "Give each NTULearn site a unique key and a separate, non-nested destination.",
        });
    }
  }
  return findings;
}

function collision(left: string, right: string): "equal" | "nested" | null {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return "equal";
  return within(a, b) || within(b, a) ? "nested" : null;
}

function within(root: string, path: string): boolean {
  return (
    root === path ||
    path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  );
}

function sameModule(left: ConfiguredModule, right: ConfiguredModule): boolean {
  return left.semester === right.semester && left.module === right.module;
}

function observed<T>(value: T): Observation<T> {
  return { kind: "observed", value };
}

function unavailable(
  code: string,
  message: string,
  action = "Repair the reported configuration or mounted target before retrying.",
): { kind: "unobserved"; problems: Problem[] } {
  return { kind: "unobserved", problems: [problem(code, message, action)] };
}

function problem(code: string, message: string, action: string): Problem {
  return { code, message, action };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
