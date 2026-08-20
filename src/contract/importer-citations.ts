// The `NN ` a name inside an importer root opens with is that importer's ordering, and an insert
// upstream renumbers every later name while nothing on disk moves. So a citation carrying the
// number goes wrong whenever the course reorders, and goes wrong invisibly: by then the number
// names real but unrelated material (`docs/adr/0013`).
//
// Numbers outside an importer root are the contract's own and never shift, which is why the root a
// citation opens with is what decides whether its numbers are ordering or spelling.
const orderingPrefix = /^\d+ /u;

export function withoutImporterOrdering(
  citation: string,
  importerRoots: readonly string[],
): string {
  const [root, ...rest] = citation.split("/");
  if (root === undefined || !importerRoots.includes(root)) return citation;
  return [
    root,
    ...rest.map((segment) => segment.replace(orderingPrefix, "")),
  ].join("/");
}

// The importer guarantees three names and reorders everything else: `Course.md` and
// `Last synced.md` at the root, and the `Announcements/` folder. A citation reaching past them is
// in the interior the importer owns, which is the weakest place a citation can point — stable
// against renumbering once unnumbered, and still not stable against NTULearn renaming the item.
// So it is the last form to reach for, behind an official URL and behind those landmarks.
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
