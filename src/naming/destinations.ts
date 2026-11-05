import {
  artifactHomes,
  workspaceChildren,
} from "../contract/artifact-homes.js";
import { collisionKey, isUnicodeCategory } from "./unicode.js";
import type { NamingArtifact } from "./types.js";

const categoryHomes = {
  lecture: {
    home: artifactHomes.lecture,
    token: "Lecture",
    nested: true,
  },
  "personal-note": {
    home: artifactHomes["personal-note"],
    token: "Notes",
    nested: true,
  },
  tutorial: {
    home: artifactHomes.tutorial,
    token: "Tutorial",
    nested: true,
  },
  quiz: { home: artifactHomes.quiz, token: "Quiz", nested: false },
  test: { home: artifactHomes.test, token: "Test", nested: false },
  midterm: {
    home: artifactHomes.midterm,
    token: "Midterm",
    nested: false,
  },
  final: { home: artifactHomes.final, token: "Final", nested: false },
  assignment: {
    home: artifactHomes.assignment,
    token: "Assignment",
    nested: false,
  },
  project: {
    home: artifactHomes.project,
    token: "Project",
    nested: true,
  },
  lab: { home: artifactHomes.lab, token: "Lab", nested: true },
  resource: {
    home: artifactHomes.resource,
    token: "Resource",
    nested: true,
  },
} satisfies Record<
  NamingArtifact["destination"]["category"],
  { home: string; token: string; nested: boolean }
>;

const workspaceChildSet = new Set<string>(workspaceChildren);

export function categoryToken(artifact: NamingArtifact): string {
  return categoryHomes[artifact.destination.category].token;
}

export function isSafeRelativePath(path: string): boolean {
  return (
    !/[\\:*?"<>|]/u.test(path) &&
    ![...path].some((scalar) => isUnicodeCategory(scalar, "forbidden")) &&
    path
      .split("/")
      .every(
        (segment) =>
          segment !== "" &&
          segment !== "." &&
          segment !== ".." &&
          !/[. ]$/u.test(segment),
      )
  );
}

export function isArtifactDestination(artifact: NamingArtifact): boolean {
  const { directory, category } = artifact.destination;
  if (!isSafeRelativePath(directory)) return false;
  const { home, nested } = categoryHomes[category];
  if (directory !== home && (!nested || !directory.startsWith(`${home}/`)))
    return false;
  const relative = directory.slice(home.length).replace(/^\//u, "");
  const segments = relative === "" ? [] : relative.split("/");
  if (
    segments.some(
      (segment) =>
        ["unclassified", "misc", "miscellaneous"].includes(
          collisionKey(segment).replace(/^[0-9]+ /u, ""),
        ) ||
        segment === "build" ||
        segment.startsWith("."),
    )
  )
    return false;
  if (category === "resource")
    return (
      /^[0-9]{2} /u.test(segments[0] ?? "") &&
      isUnicodeCategory([...(segments[0] ?? "")][3] ?? "", "upper")
    );
  if (category === "project" || category === "lab")
    return workspaceChildSet.has(segments[0] ?? "");
  if (category === "personal-note" && segments[0] === "support") return false;
  if (category === "tutorial" && segments.length > 1) return false;
  return true;
}
