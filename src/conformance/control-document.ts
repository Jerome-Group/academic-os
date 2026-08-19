import { parseDocument } from "yaml";

// Every YAML control is read the same way — one parse, unique keys enforced, and the parser's own
// words when the file cannot be read as YAML at all — so each validator carries only the shape its
// own rule fixes.
export function readControlDocument(
  source: string,
): { problems: string[] } | { value: unknown } {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  return document.errors.length > 0
    ? {
        problems: document.errors.map(
          ({ message }) =>
            `YAML parser reported: ${message.replace(/\s+/gu, " ").trim()}`,
        ),
      }
    : { value: document.toJS() };
}
