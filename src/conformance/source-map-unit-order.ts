import { parseDocument } from "yaml";

export function sourceMapUnitOrder(sourceMap: string): string[] {
  const root: unknown = parseDocument(sourceMap, { uniqueKeys: true }).toJS({
    mapAsMap: true,
  });
  if (!(root instanceof Map)) return [];
  const units: unknown = root.get("units");
  return units instanceof Map ? [...units.keys()].map(String) : [];
}
