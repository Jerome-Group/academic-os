import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { planCohortAudit, type CohortSelection } from "../cohort/index.js";
import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { observeModuleImportDestinations } from "./observe-module-import-destinations.js";

export interface Problem {
  code: string;
  message: string;
  action: string;
}

export type Observation<T> =
  | { kind: "observed"; value: T }
  | { kind: "unobserved"; problems: Problem[] };

export interface PathEvidence {
  lexical: string;
  canonical: Observation<string>;
}

export interface CourseObservation {
  index: number;
  key: Observation<string>;
  usable: Observation<true>;
  destination: Observation<PathEvidence>;
}

export interface DeclaredRoot {
  destination: string;
  path: PathEvidence;
  directory: "present" | "absent" | "unobserved";
}

export type ModuleObservation = { module: ConfiguredModule } & (
  | { kind: "observed"; roots: DeclaredRoot[] }
  | { kind: "unobserved"; problems: Problem[] }
);

export type Boundary = {
  module: ConfiguredModule;
  path: PathEvidence;
  selection:
    | { kind: "active" }
    | { kind: "excluded"; reason: "past" | "future" }
    | { kind: "unresolved" };
};

export interface ImportPreflightObservation {
  selection: CohortSelection;
  modules: ModuleObservation[];
  boundaries: Boundary[];
  courses: Observation<CourseObservation[]>;
}

export async function observeImportPreflight(input: {
  config: AcademicConfig;
  ntulearnConfigPath: string;
  ntulearnRoot: string;
}): Promise<ImportPreflightObservation> {
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
  return { selection: plan.selection, modules, boundaries, courses };
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
