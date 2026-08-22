// A mirror is an automated landing zone: the importer writes it, numbers it by position, and
// reorders it whenever NTULearn does. A citation that walks into it therefore records a position,
// and a recorded position cannot be made stable — renumbering the mirror perfectly every night
// would still leave yesterday's citation pointing somewhere else (`docs/adr/0014`).
//
// Three names the importer guarantees are the exception, because they never move: `Course.md` and
// `Last synced.md` at the root, and the `Announcements/` folder.
const importerLandmarks = new Set([
  "Course.md",
  "Last synced.md",
  "Announcements",
]);

export function citesImporterInterior(
  citation: string,
  importerRoots: readonly string[],
): boolean {
  const [root, landmark] = citation.split("/");
  if (root === undefined || !importerRoots.includes(root)) return false;
  if (landmark === undefined || landmark === "") return false;
  return !importerLandmarks.has(landmark);
}
