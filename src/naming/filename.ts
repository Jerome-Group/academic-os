import { isUnicodeCategory, supportsNamingUnicode } from "./unicode.js";

export function isCalendarDay(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0)
  );
}

export function isAcademicYear(value: string): boolean {
  if (/^[0-9]{4}$/u.test(value)) return Number(value) >= 1;
  const match = /^([0-9]{4})-([0-9]{4})$/u.exec(value);
  return (
    match !== null &&
    Number(match[1]) >= 1 &&
    Number(match[2]) === Number(match[1]) + 1
  );
}

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

export function isNumericToken(token: string): boolean {
  return (
    /^[0-9]{1,2}$/u.test(token) || isAcademicYear(token) || isCalendarDay(token)
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

function isLegacyCuratedFileName(name: string, moduleCode: string): boolean {
  const match = /^([^.]+)\.([a-z0-9]+)$/u.exec(name);
  if (match === null || !name.startsWith(`${moduleCode}_`)) return false;
  const tokens = (match[1] ?? "").slice(moduleCode.length + 1).split("_");
  const title = (token: string) => /^[A-Z][A-Za-z0-9]*$/u.test(token);
  return (
    tokens.some(title) &&
    tokens.every((token) => title(token) || isNumericToken(token))
  );
}
