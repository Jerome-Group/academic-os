// A mirror folder's `NN ` prefix is the importer's ordering, and it shifts whenever material is
// inserted or renumbered upstream. The name behind it is what stays, so contract-v4 identity is the
// source path with that prefix stripped from every segment.
const orderingPrefix = /^\d{2} /u;

export function unnumberedSourcePath(sourcePath: string): string {
  return sourcePath
    .split("/")
    .map((segment) => segment.replace(orderingPrefix, ""))
    .join("/");
}
