import { isNumericToken } from "./temporal-tokens.js";

export function isLegacyCuratedFileName(
  name: string,
  moduleCode: string,
): boolean {
  const match = /^([^.]+)\.([a-z0-9]+)$/u.exec(name);
  if (match === null || !name.startsWith(`${moduleCode}_`)) return false;
  const tokens = (match[1] ?? "").slice(moduleCode.length + 1).split("_");
  const title = (token: string) => /^[A-Z][A-Za-z0-9]*$/u.test(token);
  return (
    tokens.some(title) &&
    tokens.every((token) => title(token) || isNumericToken(token))
  );
}
