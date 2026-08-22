// Where two texts stop agreeing, in the words a reader can act on: a line number and both lines.
// Shared so the auditor's finding and a rewrite's preview describe one difference identically.
export function firstDifference(copy: string, expected: string): string {
  const copyLines = copy.split("\n");
  const expectedLines = expected.split("\n");
  const index = expectedLines.findIndex(
    (line, position) => copyLines[position] !== line,
  );
  return index < 0
    ? `line ${expectedLines.length + 1}, where the copy continues past the template`
    : `line ${index + 1}, which reads ${JSON.stringify(copyLines[index] ?? "<end of copy>")} rather than ${JSON.stringify(expectedLines[index] ?? "")}`;
}
