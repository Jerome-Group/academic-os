// A mirror is an automated landing zone: the importer writes it, numbers it by position, and
// reorders it whenever NTULearn does. A citation that walks into it therefore records a position,
// and a recorded position cannot be made stable — renumbering the mirror perfectly every night
// would still leave yesterday's citation pointing somewhere else (`docs/adr/0014`).
//
// Three names the importer guarantees are the exception, because they never move: `Course.md` and
// `Last synced.md` at the root, and the `Announcements/` folder.
const importerLandmarks = new Set([
  "",
  "Course.md",
  "Last synced.md",
  "Announcements",
  "Announcements/",
]);

export function citesImporterInterior(
  citation: string,
  importerRoots: readonly string[],
): boolean {
  const separator = citation.indexOf("/");
  if (separator === -1) return false;
  const root = citation.slice(0, separator);
  if (!importerRoots.includes(root)) return false;
  return !importerLandmarks.has(citation.slice(separator + 1));
}
