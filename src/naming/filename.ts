import { isLegacyCuratedFileName } from "./legacy-filename.js";
import { isNumericToken } from "./temporal-tokens.js";
import { isUnicodeCategory, supportsNamingUnicode } from "./unicode.js";

export function isTitleToken(token: string): boolean {
  const [first, ...rest] = [...token];
  if (first === undefined || !isSourceToken(token)) return false;
  return (
    isUnicodeCategory(first, "upper") ||
    (isUnicodeCategory(first, "letter") &&
      !isUnicodeCategory(first, "lower")) ||
    (isUnicodeCategory(first, "lower") &&
      rest.some((scalar) => isUnicodeCategory(scalar, "upper")))
  );
}

export function isSourceToken(token: string): boolean {
  const [first, ...rest] = [...token];
  return (
    first !== undefined &&
    supportsNamingUnicode(token) &&
    (isUnicodeCategory(first, "letter") ||
      isUnicodeCategory(first, "number")) &&
    rest.every(
      (scalar) =>
        isUnicodeCategory(scalar, "letter") ||
        isUnicodeCategory(scalar, "mark") ||
        isUnicodeCategory(scalar, "number") ||
        ["'", "’", "-"].includes(scalar),
    )
  );
}

export function isCuratedFileName(
  name: string,
  moduleCode: string,
  policy:
    | "legacy-curated-name/7"
    | "module-artifact-naming/1" = "legacy-curated-name/7",
): boolean {
  if (policy === "legacy-curated-name/7")
    return isLegacyCuratedFileName(name, moduleCode);
  if (!supportsNamingUnicode(name) || !name.startsWith(`${moduleCode}_`))
    return false;
  const match = /^([^.]+)\.([a-z0-9]+(?:\.[a-z0-9]+)*)$/u.exec(name);
  if (match === null) return false;
  const tokens = (match[1] ?? "").slice(moduleCode.length + 1).split("_");
  let sourceIdentifier = false;
  return (
    tokens.some(isTitleToken) &&
    tokens.every((token) => {
      if (["Source", "Version", "Edition"].includes(token))
        sourceIdentifier = true;
      return (
        isTitleToken(token) ||
        isNumericToken(token) ||
        (sourceIdentifier && isSourceToken(token))
      );
    })
  );
}
