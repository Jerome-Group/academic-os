import { isAbsolute, normalize } from "node:path";

import { OperationalError } from "../operational-error.js";
import type { AcademicConfig, ResolvedResearchProject } from "./types.js";

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
  const research = config.research;
  if (research === undefined) {
    return [];
  }
  if (
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
  const projects = entries.map(([key, value]) => ({
    key,
    root: research.root,
    ...value,
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

function caseFold(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}
