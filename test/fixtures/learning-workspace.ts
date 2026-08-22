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
  ["70 Learning/templates/graded-feedback.tex", "file"],
  ["70 Learning/templates/lecture-walkthrough.tex", "file"],
  ["70 Learning/templates/preamble.tex", "file"],
  ["70 Learning/templates/preferences.md", "file"],
  ["70 Learning/templates/reference-sheet.tex", "file"],
  ["70 Learning/templates/revision-notes.tex", "file"],
  ["70 Learning/templates/tutorial-concepts-consolidation.tex", "file"],
  ["70 Learning/templates/tutorial-solution-writeup.tex", "file"],
] as const;

// Every LaTeX template and the preferences file the seeder copies out of this repository, in the
// order a seed plan lists them.
export const learningWorkspaceTemplatePaths = learningWorkspacePaths
  .filter(
    ([path, kind]) =>
      kind === "file" && path.startsWith("70 Learning/templates/"),
  )
  .map(([path]) => path);

export const seededSourceMap = "units: {}\n";
