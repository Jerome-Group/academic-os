import { isAbsolute, normalize } from "node:path";

import { OperationalError } from "../operational-error.js";
import type {
  AcademicConfig,
  ResearchProjectConfig,
  ResolvedResearchProject,
} from "./types.js";

export function resolveConfiguredResearchProject(
  config: AcademicConfig,
  key: string,
): ResolvedResearchProject {
  const projects = resolveConfiguredResearchProjects(config);
  const project = projects.find(({ key: candidate }) => candidate === key);
  if (project === undefined) {
    throw new OperationalError(
      "invalid-config",
      `Research project ${key} is not configured.`,
    );
  }
  return project;
}

export function resolveConfiguredResearchProjects(
  config: AcademicConfig,
): ResolvedResearchProject[] {
  const research: unknown = config.research;
  if (research === undefined) {
    return [];
  }
  if (!isRecord(research) || !isRecord(research.projects)) {
    throw new OperationalError(
      "invalid-config",
      "research must declare a root and a projects mapping.",
    );
  }
  if (
    typeof research.root !== "string" ||
    research.root.length === 0 ||
    isAbsolute(research.root) ||
    research.root.includes("\\") ||
    normalize(research.root) !== research.root ||
    research.root.split("/").some((part) => part.length === 0 || part === "..")
  ) {
    throw new OperationalError(
      "invalid-config",
      "Research root must be a relative path inside the Drive mount.",
    );
  }
  const entries = Object.entries(research.projects);
  if (entries.some(([projectKey]) => !isStableKey(projectKey))) {
    throw new OperationalError(
      "invalid-config",
      "Research project keys must be lowercase stable slugs.",
    );
  }
  const projects = entries.map(([key, value]) => ({
    key,
    root: research.root as string,
    ...validateProject(key, value),
  }));
  const folders = projects.map(({ folder }) => caseFold(folder));
  if (new Set(folders).size !== folders.length) {
    throw new OperationalError(
      "invalid-config",
      "Research project folders must be case-insensitively unique within the research root.",
    );
  }
  const taskListTitles = projects.map(
    ({ folder, taskListTitle }) => taskListTitle ?? folder,
  );
  if (new Set(taskListTitles).size !== taskListTitles.length) {
    throw new OperationalError(
      "invalid-config",
      "Research projects must have unique effective Task-list titles.",
    );
  }
  const moduleTaskListTitles = new Set(
    Object.values(config.semesters).flatMap(({ modules }) => modules),
  );
  const moduleCollision = taskListTitles.find((title) =>
    moduleTaskListTitles.has(title),
  );
  if (moduleCollision !== undefined) {
    throw new OperationalError(
      "invalid-config",
      `Research Task-list title ${moduleCollision} collides with a configured Module list.`,
    );
  }
  return projects.sort((left, right) => left.key.localeCompare(right.key));
}

export function requireActiveResearchProject(
  project: ResolvedResearchProject,
): ResolvedResearchProject {
  if (project.status !== "active") {
    throw new OperationalError(
      "invalid-target",
      `Research project ${project.key} is inactive and read-only.`,
    );
  }
  return project;
}

function validateProject(key: string, value: unknown): ResearchProjectConfig {
  if (!isRecord(value)) invalidProject(key);
  const keys = Object.keys(value);
  if (
    keys.some(
      (name) =>
        !["folder", "status", "profile", "taskListTitle"].includes(name),
    ) ||
    typeof value.folder !== "string" ||
    value.folder.trim() !== value.folder ||
    value.folder.length === 0 ||
    value.folder === "." ||
    value.folder === ".." ||
    value.folder.includes("/") ||
    value.folder.includes("\\") ||
    (value.status !== "active" && value.status !== "inactive") ||
    (value.profile !== undefined && value.profile !== "ureca") ||
    (value.taskListTitle !== undefined &&
      (typeof value.taskListTitle !== "string" ||
        value.taskListTitle.trim() !== value.taskListTitle ||
        value.taskListTitle.length === 0))
  ) {
    invalidProject(key);
  }
  return {
    folder: value.folder,
    status: value.status,
    ...(value.profile === undefined ? {} : { profile: value.profile }),
    ...(value.taskListTitle === undefined
      ? {}
      : { taskListTitle: value.taskListTitle }),
  };
}

function invalidProject(key: string): never {
  throw new OperationalError(
    "invalid-config",
    `Research project ${key} has an invalid declaration.`,
  );
}

function isStableKey(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function caseFold(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
