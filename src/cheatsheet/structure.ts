import { texArgumentStart, texEscaped, texGroupEnd } from "./revision.js";

const explanationArguments = { Proof: 1, Worked: 4, QuestionPart: 5 } as const;
const explanationCue =
  /\\(?:KeyTerm|Method|Hypothesis|Result|Conclusion|Pitfall|KeyFormula)(?![A-Za-z@])\*?\s*\{\s*[^}\s]/gu;

export function assertCheatsheetExplanationCues(source: string): void {
  const uncommented = source.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gmu, (comment) =>
    comment.slice(0, comment.indexOf("%")),
  );
  const document = /\\begin\s*\{document\}/u.exec(uncommented);
  if (!document) return;
  const remaining = uncommented.slice(document.index + document[0].length);
  const end = /\\end\s*\{document\}/u.exec(remaining);
  const body = remaining.slice(0, end?.index);

  function argumentsAt(start: number, count: number) {
    const groups: Array<{ start: number; end: number; text: string }> = [];
    let end = start;
    for (let index = 0; index < count; index++) {
      const brace = texArgumentStart(body, end);
      if (body[brace] !== "{") return groups;
      end = texGroupEnd(body, brace);
      groups.push({ start: brace + 1, end: end - 1, text: body.slice(brace + 1, end - 1) });
    }
    return groups;
  }

  const highlights = [
    ...body.matchAll(/\\(HighlightTag|PassageHighlight)(?![A-Za-z@])/gu),
  ].flatMap((match) => {
    if (texEscaped(body, match.index)) return [];
    const [role, content] = argumentsAt(match.index + match[0].length, 2);
    if (!role || !content || !content.text.trim()) return [];
    const prior = body.slice(Math.max(0, match.index - 24), match.index);
    const name = role.text.trim();
    if (
      /^\s*\d+(?:\.\d+)*\.?\s*$/u.test(content.text) &&
      (/^(?:theorem|lemma|exercise|paper)$/u.test(name) ||
        /\b(?:Def|Thm|Lem|Prop|Ex|Eg)\.?\s*$/iu.test(prior))
    ) {
      throw new Error("A highlight contains only the number of a typed item. Tag the complete label, including its type.");
    }
    return name === "paper" || /^\s*(?:Pf|Sol|Proof|Solution)\.?\s*$/iu.test(content.text)
      ? []
      : [{ ...content, passage: match[1] === "PassageHighlight" }];
  });

  for (const match of body.matchAll(/\\(Proof|Worked|QuestionPart)(?![A-Za-z@])/gu)) {
    if (texEscaped(body, match.index)) continue;
    const count = explanationArguments[match[1] as keyof typeof explanationArguments];
    const arguments_ = argumentsAt(match.index + match[0].length, count);
    const explanation = arguments_[count - 1];
    if (!explanation) continue;
    const emphasized = highlights.some((highlight) =>
      (highlight.start >= explanation.start && highlight.end <= explanation.end) ||
      (highlight.passage && highlight.start <= explanation.start && highlight.end >= explanation.end),
    );
    const inline = [...explanation.text.matchAll(explanationCue)].some(
      (cue) => !texEscaped(explanation.text, cue.index),
    );
    if (!emphasized && !inline) {
      const identity = match[1] === "Proof"
        ? explanation.text.trim().replace(/\s+/gu, " ").slice(0, 60)
        : arguments_[0]?.text.trim().slice(0, 60);
      throw new Error(`\\${match[1]} ${identity ?? ""} needs a semantic color cue inside the explanation body.`);
    }
  }
}

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
