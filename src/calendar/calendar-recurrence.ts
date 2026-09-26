export function trimCalendarRecurrence(
  recurrence: string[],
  splitInstant: string,
): string[] {
  const previous = new Date(Date.parse(splitInstant) - 1_000).toISOString();
  const until = /^\d{4}-\d{2}-\d{2}$/u.test(splitInstant)
    ? previous.slice(0, 10).replaceAll("-", "")
    : previous.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return recurrence.map((line) =>
    line.startsWith("RRULE:")
      ? `${line.replace(/;(?:UNTIL|COUNT)=[^;]+/gu, "")};UNTIL=${until}`
      : line,
  );
}

export function futureCalendarRecurrence(
  recurrence: string[],
  priorOccurrenceCount: number,
): string[] {
  return recurrence.map((line) => {
    if (!line.startsWith("RRULE:")) return line;
    const count = line.match(/;COUNT=(\d+)/u)?.[1];
    if (count === undefined) return line;
    const remaining = Number.parseInt(count, 10) - priorOccurrenceCount;
    if (remaining < 1)
      throw new Error("Recurring split has no future occurrences.");
    return line.replace(/;COUNT=\d+/u, `;COUNT=${remaining}`);
  });
}
