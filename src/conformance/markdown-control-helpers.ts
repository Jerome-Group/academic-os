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

export function validateHeadingSubsequence(
  source: string,
  expected: string[],
): string[] {
  const actual = source
    .split(/\r?\n/)
    .flatMap((line) => (line.startsWith("## ") ? [line.slice(3)] : []));
  const duplicates = [
    ...new Set(
      actual.filter((heading, index) => actual.indexOf(heading) !== index),
    ),
  ];
  const expectedHeadings = new Set(expected);
  const anchors = actual.filter((heading) => expectedHeadings.has(heading));
  const problems: string[] = [];
  if (duplicates.length > 0) {
    problems.push(
      `Section headings must be unique; repeated ${JSON.stringify(duplicates)}.`,
    );
  }
  if (
    anchors.length !== expected.length ||
    anchors.some((heading, index) => heading !== expected[index])
  ) {
    problems.push(
      `Required section headings appear as ${JSON.stringify(anchors)}; expected ordered anchors ${JSON.stringify(expected)}.`,
    );
  }
  return problems;
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

export function firstDirectTableRows(source: string): string[][] {
  const lines = source.split(/\r?\n/);
  const firstNestedHeading = lines.findIndex((line) => /^#{3,6} /u.test(line));
  const directLines =
    firstNestedHeading === -1 ? lines : lines.slice(0, firstNestedHeading);
  const start = directLines.findIndex((line) => line.trim().startsWith("|"));
  if (start === -1) return [];
  const rows: string[] = [];
  for (const line of directLines.slice(start)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(line);
  }
  return rows.map(splitTableRow);
}

export function namedRowsForTable(rows: string[][]): Map<string, string> {
  return new Map(
    rows
      .slice(2)
      .flatMap((row) =>
        row.length >= 2 ? [[row[0] ?? "", row[1] ?? ""]] : [],
      ),
  );
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
