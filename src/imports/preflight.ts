import { isAbsolute, sep } from "node:path";

import type { CohortSelection } from "../cohort/index.js";
import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import {
  type Boundary,
  type CourseObservation,
  type DeclaredRoot,
  type ImportPreflightObservation,
  type ModuleObservation,
  type Observation,
  type PathEvidence,
  type Problem,
  observeImportPreflight,
} from "../mounted/observe-import-preflight.js";
import { OperationalError } from "../operational-error.js";

type Coverage =
  | { kind: "matched"; courses: number[] }
  | { kind: "missing" }
  | { kind: "unobserved"; knownMatches: number[]; problems: Problem[] };

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
    }
  | {
      kind: "declaration-conflict";
      module: ConfiguredModule;
      destinations: [string, string];
      action: string;
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
  const observation = await observeImportPreflight(input);
  return {
    schemaVersion: 1,
    mode: "imports-preflight",
    activeSemester: input.config.activeSemester,
    observedAt: input.observedAt,
    selection: observation.selection,
    ...compareDestinations(observation),
    unverified: [
      "site-to-module-identity",
      "live-provider-visibility",
      "later-sync-safety",
    ],
  };
}

function compareDestinations(
  input: ImportPreflightObservation,
): Pick<
  ImportPreflightReport,
  "modules" | "courses" | "findings" | "problems" | "outcome"
> {
  const rows = input.courses.kind === "observed" ? input.courses.value : [];
  const problems =
    input.courses.kind === "unobserved" ? [...input.courses.problems] : [];
  const findings: Finding[] = [
    ...collisionFindings(rows),
    ...declarationCollisionFindings(input.modules),
  ];
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

function declarationCollisionFindings(modules: ModuleObservation[]): Finding[] {
  const findings: Finding[] = [];
  for (const module of modules) {
    if (module.kind === "unobserved") continue;
    for (const [index, left] of module.roots.entries()) {
      if (left.path.canonical.kind === "unobserved") continue;
      for (const right of module.roots.slice(index + 1)) {
        if (
          right.path.canonical.kind === "observed" &&
          left.path.canonical.value === right.path.canonical.value
        )
          findings.push({
            kind: "declaration-conflict",
            module: module.module,
            destinations: [left.destination, right.destination],
            action:
              "Give each declared importer destination a separate physical directory and corresponding NTULearn route.",
          });
      }
    }
  }
  return findings;
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

function problem(code: string, message: string, action: string): Problem {
  return { code, message, action };
}
