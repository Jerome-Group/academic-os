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
] as const;

// Every LaTeX template and the preferences file the seeder copies out of this repository, in the
// order a seed plan lists them.
export const learningWorkspaceTemplatePaths = [
  "70 Learning/templates/graded-feedback.tex",
  "70 Learning/templates/lecture-walkthrough.tex",
  "70 Learning/templates/preamble.tex",
  "70 Learning/templates/preferences.md",
  "70 Learning/templates/reference-sheet.tex",
  "70 Learning/templates/revision-notes.tex",
  "70 Learning/templates/tutorial-concepts-consolidation.tex",
  "70 Learning/templates/tutorial-solution-writeup.tex",
] as const;

export const seededSourceMap = "units: {}\n";
