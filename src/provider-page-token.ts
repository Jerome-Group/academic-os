// An incomplete or cycling provider walk supplies no authority to replace a local mirror.
export function checkedNextPageToken(
  value: unknown,
  seen: Set<string>,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
    throw new Error(
      "Provider returned an invalid or repeated pagination token.",
    );
  }
  seen.add(value);
  return value;
}
