import { sha256 } from "../checksum.js";

export interface CheatsheetMathematicsSpan {
  start: number;
  end: number;
  text: string;
  kind: "expression" | "environment";
}
const environments = new Set([
  "math",
  "displaymath",
  "equation",
  "align",
  "alignat",
  "gather",
  "multline",
  "eqnarray",
  "flalign",
  "split",
  "aligned",
  "alignedat",
  "gathered",
  "cases",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);
export function texEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (
    let previous = index - 1;
    previous >= 0 && source[previous] === "\\";
    previous--
  )
    slashes++;
  return slashes % 2 === 1;
}
export function texGroupEnd(source: string, start: number): number {
  if (source[start] !== "{")
    throw new Error("Expected a balanced TeX argument.");
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "%" && !texEscaped(source, index)) {
      index = source.indexOf("\n", index);
      if (index < 0) break;
    }
    if (!texEscaped(source, index)) {
      if (source[index] === "{") depth++;
      if (source[index] === "}" && --depth === 0) return index + 1;
    }
  }
  throw new Error("Unbalanced TeX argument.");
}
function delimiterEnd(
  source: string,
  start: number,
  opener: string,
  closer: string,
): number {
  for (let index = start + opener.length; index < source.length; index++) {
    if (source[index] === "%" && !texEscaped(source, index)) {
      index = source.indexOf("\n", index);
      if (index < 0) break;
    }
    if (source.startsWith(closer, index) && !texEscaped(source, index))
      return index + closer.length;
  }
  throw new Error(`Unclosed mathematics delimiter ${opener}.`);
}

export function extractCheatsheetMathematics(
  source: string,
): CheatsheetMathematicsSpan[] {
  const spans: CheatsheetMathematicsSpan[] = [];
  for (let index = 0; index < source.length; ) {
    if (source[index] === "%" && !texEscaped(source, index)) {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("\\verb", index) && !texEscaped(source, index)) {
      const match = /^\\verb\*?([^A-Za-z\s])/u.exec(source.slice(index));
      if (match?.[1]) {
        const end = source.indexOf(match[1], index + match[0].length);
        if (end < 0) throw new Error("Unclosed TeX verbatim token.");
        index = end + 1;
        continue;
      }
    }
    const begin = /^\\begin\{([^{}]+)\}/u.exec(source.slice(index));
    const environment = begin?.[1];
    if (
      begin !== null &&
      environment !== undefined &&
      !texEscaped(source, index)
    ) {
      if (
        ["verbatim", "verbatim*", "lstlisting", "minted"].includes(environment)
      ) {
        const end = source.indexOf(
          `\\end{${environment}}`,
          index + begin[0].length,
        );
        if (end < 0)
          throw new Error(`Unclosed verbatim environment ${environment}.`);
        index = end + environment.length + 6;
        continue;
      }
      if (environments.has(environment.replace(/\*$/u, ""))) {
        const end = delimiterEnd(
          source,
          index,
          begin[0],
          `\\end{${environment}}`,
        );
        spans.push({
          start: index,
          end,
          text: source.slice(index, end),
          kind: "environment",
        });
        index = end;
        continue;
      }
    }
    let opener: string | undefined;
    let closer: string | undefined;
    if (!texEscaped(source, index)) {
      if (source[index] === "$")
        opener = closer = source.startsWith("$$", index) ? "$$" : "$";
      else if (source.startsWith("\\(", index)) {
        opener = "\\(";
        closer = "\\)";
      } else if (source.startsWith("\\[", index)) {
        opener = "\\[";
        closer = "\\]";
      } else if (source.startsWith("\\ensuremath{", index)) {
        const end = texGroupEnd(source, index + "\\ensuremath".length);
        spans.push({
          start: index,
          end,
          text: source.slice(index, end),
          kind: "expression",
        });
        index = end;
        continue;
      }
    }
    if (opener !== undefined && closer !== undefined) {
      const end = delimiterEnd(source, index, opener, closer);
      spans.push({
        start: index,
        end,
        text: source.slice(index, end),
        kind: "expression",
      });
      index = end;
    } else index++;
  }
  return spans;
}

export function assertCheatsheetMathematicsPreserved(input: {
  baseline: string;
  candidate: string;
  policy?: "exact" | "preserve-existing";
}): {
  expressions: number;
  candidateExpressions: number;
  mathematicsSha256: string;
  scope: string;
} {
  const baseline = extractCheatsheetMathematics(input.baseline).map(
    (span) => span.text,
  );
  const candidate = extractCheatsheetMathematics(input.candidate).map(
    (span) => span.text,
  );
  let position = 0;
  for (const [index, expression] of baseline.entries()) {
    if (input.policy === "preserve-existing") {
      while (position < candidate.length && candidate[position] !== expression)
        position++;
    }
    if (candidate[position] !== expression)
      throw new Error(
        `Mathematics preservation failed at expression ${index + 1}: a complete source expression changed, disappeared or moved.`,
      );
    position++;
  }
  if (input.policy !== "preserve-existing" && position !== candidate.length)
    throw new Error(
      "Mathematics preservation failed: candidate adds source expressions under the exact policy.",
    );
  return {
    expressions: baseline.length,
    candidateExpressions: candidate.length,
    mathematicsSha256: sha256(JSON.stringify(baseline)),
    scope:
      "Exact ordered source mathematics only; macro meanings, hypotheses and semantic proof validity require independent review. Selected solver fingerprints do not repair semantic drift.",
  };
}
