export function validateHeadingOrder(
  source: string,
  expected: string[],
): string[] {
  const actual = source
    .split(/\r?\n/)
    .flatMap((line) => (line.startsWith("## ") ? [line.slice(3)] : []));
  return actual.length === expected.length &&
    actual.every((heading, index) => heading === expected[index])
    ? []
    : [
        `Section headings are ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`,
      ];
}

export function sectionBody(source: string, heading: string): string {
  const match = new RegExp(
    `(?:^|\\n)## ${escapeRegex(heading)}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`,
    "u",
  ).exec(source);
  return match?.[1] ?? "";
}

export function tableRows(source: string): string[][] {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map(splitTableRow);
}

export function rowsForTable(source: string): Map<string, string> {
  return new Map(
    tableRows(source)
      .slice(2)
      .flatMap((row) =>
        row.length >= 2 ? [[row[0] ?? "", row[1] ?? ""]] : [],
      ),
  );
}

export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function renderColumns(columns: string[] | undefined): string {
  return columns === undefined ? "<missing>" : columns.join(" | ");
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
