export function assertCheatsheetParagraphStructure(source: string): void {
  const definition =
    /\\(?:re)?newcommand\s*\{\\KeepBlock\}\s*\[1\]\s*\{\s*\\par\s*\\noindent\b/u;
  if (!definition.test(source)) return;
  for (const match of source.matchAll(/\\KeepBlock\s*\{/gu)) {
    let depth = 1;
    const start = (match.index ?? 0) + match[0].length;
    for (let index = start; index < source.length && depth > 0; index += 1) {
      if (source[index] === "\\") {
        index += 1;
        continue;
      }
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0 && /\\KeepBlock\s*\{/u.test(source.slice(start, index)))
        throw new Error(
          "Nested KeepBlock uses a paragraph-opening noindent. Remove that wrapper's empty paragraph before fitting or reducing font size.",
        );
    }
  }
}
