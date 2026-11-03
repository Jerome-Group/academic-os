import {
  extractCheatsheetMathematics,
  texEscaped,
  texGroupEnd,
} from "./revision.js";

const prefixes = {
  "notes-example": "Eg.",
  exercise: "Ex.",
  definition: "Def.",
  theorem: "Thm.",
  proposition: "Prop.",
  lemma: "Lem.",
  corollary: "Cor.",
  remark: "Rem.",
};
export type CheatsheetReference =
  | { kind: keyof typeof prefixes; id: string; display?: string }
  | { kind: "named-result"; id: string; display: string };
function isNumberedKind(value: unknown): value is keyof typeof prefixes {
  return typeof value === "string" && Object.hasOwn(prefixes, value);
}
export function parseCheatsheetReferences(
  value: unknown,
): Record<string, CheatsheetReference> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("References must be a mapping of explicit identities.");
  const references: Record<string, CheatsheetReference> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(key) ||
      typeof item !== "object" ||
      item === null ||
      !("kind" in item) ||
      !("id" in item) ||
      typeof item.id !== "string"
    )
      throw new Error(`Invalid structured reference ${key}.`);
    if (item.kind === "named-result") {
      if (!("display" in item) || typeof item.display !== "string")
        throw new Error(`Named reference ${key} requires explicit display.`);
      references[key] = { kind: item.kind, id: item.id, display: item.display };
    } else if (isNumberedKind(item.kind)) {
      const display = "display" in item ? item.display : undefined;
      if (display !== undefined && typeof display !== "string")
        throw new Error(`Reference ${key} display must be plain text.`);
      references[key] = {
        kind: item.kind,
        id: item.id,
        ...(display === undefined ? {} : { display }),
      };
    } else
      throw new Error(`Reference ${key} requires an explicit source kind.`);
    renderCheatsheetReference(references[key]);
  }
  return references;
}
function text(value: string): string {
  if (!value.trim() || /[\\{}$%#&_^~\r\n]/u.test(value))
    throw new Error(
      "Reference display must be plain nonempty text without TeX control characters.",
    );
  return value;
}
export function renderCheatsheetReference(
  reference: CheatsheetReference,
): string {
  if (reference.kind === "named-result") {
    if (!/^[a-z][a-z0-9-]*$/u.test(reference.id))
      throw new Error("Named reference id must be a stable identity.");
    return `\\ConceptRef{${text(reference.display)}}`;
  }
  if (
    !/^\d+(?:\.\d+)*(?:\([a-z0-9]+\))*(?:(?:--|–)\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)?$/u.test(
      reference.id,
    )
  )
    throw new Error(
      "Numbered reference requires an unambiguous complete id, range and suffix.",
    );
  return `\\ConceptRef{${text(reference.display ?? prefixes[reference.kind])}~${reference.id}}`;
}
const identityArguments: Record<string, number> = {
  label: 1,
  ref: 1,
  eqref: 1,
  SourceRef: 1,
  ConceptRef: 1,
  Statement: 2,
  FormalStatement: 4,
  Example: 1,
  Question: 2,
  QuestionPart: 3,
  Topic: 1,
  Worked: 2,
  CE: 2,
  hypertarget: 1,
  hyperlink: 1,
};

// Only explicit markers change. Ordinary prose (including Gaussian), mathematics,
// comments and stable identity arguments never undergo heuristic replacement.
export function formatCheatsheetReferences(input: {
  source: string;
  references: Readonly<Record<string, CheatsheetReference>>;
}): { source: string; formatted: number } {
  const mathematics = new Map(
    extractCheatsheetMathematics(input.source).map((span) => [
      span.start,
      span,
    ]),
  );
  let source = "";
  let formatted = 0;
  for (let index = 0; index < input.source.length; ) {
    const math = mathematics.get(index);
    if (math !== undefined) {
      source += math.text;
      index = math.end;
      continue;
    }
    if (input.source[index] === "%" && !texEscaped(input.source, index)) {
      const newline = input.source.indexOf("\n", index);
      const end = newline < 0 ? input.source.length : newline + 1;
      source += input.source.slice(index, end);
      index = end;
      continue;
    }
    const match = /^\\([A-Za-z]+)\*?/u.exec(input.source.slice(index));
    const command = match?.[1];
    if (
      match === null ||
      command === undefined ||
      texEscaped(input.source, index)
    ) {
      source += input.source[index];
      index++;
      continue;
    }
    let end = index + match[0].length;
    if (command === "verb") {
      const delimiter = input.source[end];
      if (delimiter !== undefined && !/\s/u.test(delimiter)) {
        const closing = input.source.indexOf(delimiter, end + 1);
        if (closing < 0)
          throw new Error("Unclosed verbatim reference context.");
        source += input.source.slice(index, closing + 1);
        index = closing + 1;
        continue;
      }
    }
    if (
      [
        "newcommand",
        "renewcommand",
        "providecommand",
        "DeclareMathOperator",
        "def",
        "gdef",
        "edef",
        "xdef",
      ].includes(command)
    ) {
      while (end < input.source.length && input.source[end] !== "{") end++;
      if (end < input.source.length) {
        end = texGroupEnd(input.source, end);
        if (
          [
            "newcommand",
            "renewcommand",
            "providecommand",
            "DeclareMathOperator",
          ].includes(command)
        ) {
          while (
            end < input.source.length &&
            /\s/u.test(input.source[end] ?? "")
          )
            end++;
          while (input.source[end] === "[") {
            const closing = input.source.indexOf("]", end + 1);
            if (closing < 0)
              throw new Error("Unclosed macro argument specification.");
            end = closing + 1;
            while (
              end < input.source.length &&
              /\s/u.test(input.source[end] ?? "")
            )
              end++;
          }
          if (input.source[end] === "{") end = texGroupEnd(input.source, end);
        }
        source += input.source.slice(index, end);
        index = end;
        continue;
      }
    }
    if (command === "begin") {
      const environment = /^\{(verbatim\*?|lstlisting|minted)\}/u.exec(
        input.source.slice(end),
      )?.[1];
      if (environment !== undefined) {
        const closing = input.source.indexOf(`\\end{${environment}}`, end);
        if (closing < 0)
          throw new Error("Unclosed verbatim reference environment.");
        end = closing + environment.length + 6;
        source += input.source.slice(index, end);
        index = end;
        continue;
      }
    }

    if (command === "SheetRef") {
      while (/\s/u.test(input.source[end] ?? "") && end < input.source.length)
        end++;
      const groupEnd = texGroupEnd(input.source, end);
      const key = input.source.slice(end + 1, groupEnd - 1);
      const reference = Object.hasOwn(input.references, key)
        ? input.references[key]
        : undefined;
      if (reference === undefined)
        throw new Error(`Undeclared structured reference ${key}.`);
      source += renderCheatsheetReference(reference);
      formatted++;
      index = groupEnd;
      continue;
    }
    if (command === "Topic") {
      while (end < input.source.length && /\s/u.test(input.source[end] ?? ""))
        end++;
      if (input.source[end] === "[") {
        const closing = input.source.indexOf("]", end + 1);
        if (closing < 0) throw new Error("Unclosed topic identity.");
        end = closing + 1;
      }
    }
    for (
      let remaining = identityArguments[command] ?? 0;
      remaining > 0;
      remaining--
    ) {
      while (/\s/u.test(input.source[end] ?? "") && end < input.source.length)
        end++;
      if (input.source[end] !== "{") break;
      end = texGroupEnd(input.source, end);
    }
    source += input.source.slice(index, end);
    index = end;
  }
  return { source, formatted };
}
