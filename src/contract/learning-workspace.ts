export const learningWorkspaceRoot = "70 Learning";

// The interior MF-LEARNING-001 enforces. Enforcement stops here: what a Lecture-unit, tutorial,
// revision-topic or past-paper folder holds below an activity area is the seeded Teaching
// procedure's business, so no path below one appears in this table.
export const learningWorkspacePaths = [
  ["70 Learning/10 Lectures", "directory"],
  ["70 Learning/10 Lectures/records", "directory"],
  ["70 Learning/20 Tutorials", "directory"],
  ["70 Learning/20 Tutorials/records", "directory"],
  ["70 Learning/30 Revision", "directory"],
  ["70 Learning/30 Revision/records", "directory"],
  ["70 Learning/40 Past Papers", "directory"],
  ["70 Learning/40 Past Papers/records", "directory"],
  ["70 Learning/GLOSSARY.md", "file"],
  ["70 Learning/RESOURCES.md", "file"],
  ["70 Learning/REVISIT.md", "file"],
  ["70 Learning/templates", "directory"],
] as const satisfies ReadonlyArray<readonly [string, "directory" | "file"]>;

// What seeding writes into the workspace, keyed by the module path each body goes to.
export type LearningWorkspaceFiles = Readonly<Record<string, string>>;
