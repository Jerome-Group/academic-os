import {
  assignedRanges,
  categoryRanges,
  fullCaseFold,
} from "./generated/unicode-16.js";

export function supportsNamingUnicode(value: string): boolean {
  return [...value].every((scalar) => {
    const code = scalar.codePointAt(0);
    return (
      code !== undefined &&
      !(code >= 0xd800 && code <= 0xdfff) &&
      containsCodePoint(assignedRanges, code)
    );
  });
}

export function isUnicodeCategory(
  scalar: string,
  category: keyof typeof categoryRanges,
): boolean {
  const code = scalar.codePointAt(0);
  return (
    code !== undefined && containsCodePoint(categoryRanges[category], code)
  );
}

function containsCodePoint(
  ranges: readonly (readonly [number, number])[],
  code: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (range === undefined) return false;
    if (code < range[0]) high = middle - 1;
    else if (code > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

export function namingRuntimeSupported(): boolean {
  return Number(process.versions.unicode?.split(".")[0]) >= 16;
}

export function collisionKey(value: string): string {
  return [...value.normalize("NFKC")]
    .map((scalar) => fullCaseFold[String(scalar.codePointAt(0))] ?? scalar)
    .join("")
    .normalize("NFKC");
}

export function compareNames(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
