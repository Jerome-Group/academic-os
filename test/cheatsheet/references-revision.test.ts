import assert from "node:assert/strict";
import { it } from "node:test";
import {
  formatCheatsheetReferences,
  parseCheatsheetReferences,
  renderCheatsheetReference,
} from "../../src/cheatsheet/references.js";
import {
  assertCheatsheetMathematicsPreserved,
  extractCheatsheetMathematics,
} from "../../src/cheatsheet/revision.js";
import { sha256 } from "../../src/checksum.js";

it("renders explicit source kinds, complete ranges and suffixes without guessing note tags", () => {
  assert.deepEqual(
    Object.keys(
      parseCheatsheetReferences({
        gauss: { kind: "named-result", id: "gauss", display: "Gauss" },
      }),
    ),
    ["gauss"],
  );
  assert.throws(
    () => parseCheatsheetReferences({ x: { kind: "unknown", id: "1.1" } }),
    /source kind/u,
  );
  assert.equal(
    renderCheatsheetReference({
      kind: "notes-example",
      id: "2.3(ii)--2.4(iv)",
    }),
    String.raw`\ConceptRef{Eg.~2.3(ii)--2.4(iv)}`,
  );
  assert.equal(
    renderCheatsheetReference({ kind: "exercise", id: "2.3(ii)" }),
    String.raw`\ConceptRef{Ex.~2.3(ii)}`,
  );
  assert.throws(
    () => renderCheatsheetReference({ kind: "exercise", id: "N2.3" }),
    /unambiguous/u,
  );
  assert.throws(
    () =>
      renderCheatsheetReference({
        kind: "named-result",
        id: "gauss",
        display: String.raw`\input{evil}`,
      }),
    /plain/u,
  );
});
it("formats markers only, preserving Gaussian, mathematical and theorem identities and existing wrappers", () => {
  const source = String.raw`Gauss: \SheetRef{gauss}; Gaussian integers; \SheetRef{exercise}.
\label{\SheetRef{gauss}} \Statement{Thm.}{\SheetRef{gauss}}{Use \SheetRef{gauss}.}
\ConceptRef{Gauss} $\SheetRef{gauss}+x$ \(\SheetRef{gauss}\) \[\SheetRef{gauss}\]
\begin{equation}\SheetRef{gauss}\end{equation}
% \SheetRef{gauss}
\verb|\SheetRef{gauss}| \newcommand{\identity}[1]{\SheetRef{gauss}#1}
\begin{verbatim}\SheetRef{gauss}\end{verbatim}`;
  const references = {
    gauss: { kind: "named-result", id: "gauss", display: "Gauss" },
    exercise: { kind: "exercise", id: "4.2(ii)--4.3" },
  } satisfies Parameters<typeof formatCheatsheetReferences>[0]["references"];
  const result = formatCheatsheetReferences({ source, references });
  assert.equal(result.formatted, 3);
  assert.ok(result.source.includes("Gaussian integers"));
  assert.ok(!result.source.includes(String.raw`\ConceptRef{Gauss}ian`));
  assert.ok(result.source.includes(String.raw`\label{\SheetRef{gauss}}`));
  assert.ok(
    result.source.includes(String.raw`\Statement{Thm.}{\SheetRef{gauss}}`),
  );
  assert.deepEqual(
    extractCheatsheetMathematics(result.source).map((x) => x.text),
    extractCheatsheetMathematics(source).map((x) => x.text),
  );
  assert.equal(
    formatCheatsheetReferences({ source: result.source, references }).formatted,
    0,
  );
  assert.throws(
    () =>
      formatCheatsheetReferences({
        source: String.raw`\SheetRef{missing}`,
        references,
      }),
    /Undeclared/u,
  );
});
it("extracts complete math environments and expressions without counting escaped/comment/verbatim delimiters", () => {
  const source = String.raw`cost \$5 % $ignored$
$x+\$y$ $$a=b$$ \(z^2\) \[w^2\]
\begin{align*}a&=b\\c&=d+\begin{matrix}1&2\end{matrix}\end{align*}
\ensuremath{x+{y}} \verb|$ignored$| \begin{verbatim}$ignored$\end{verbatim}`;
  const spans = extractCheatsheetMathematics(source);
  assert.equal(spans.length, 6);
  assert.equal(spans[4]?.kind, "environment");
  assert.ok(spans[4]?.text.includes(String.raw`\begin{matrix}`));
  assert.throws(() => extractCheatsheetMathematics("$missing"), /Unclosed/u);
  assert.throws(
    () => extractCheatsheetMathematics(String.raw`\begin{align}x=y`),
    /Unclosed/u,
  );
  assert.throws(
    () => extractCheatsheetMathematics(String.raw`\ensuremath{x`),
    /Unbalanced/u,
  );
});
it("preserves hypothesis math and complete formulas through text wrappers, rejects lost or reordered math", () => {
  const baseline = String.raw`If $n\ge 1$, then \[a+b=c\]. \begin{equation}x=y\end{equation}`;
  const candidate = String.raw`\textbf{If $n\ge 1$}, then \Key{\[a+b=c\]}. \begin{equation}x=y\end{equation}`;
  assert.equal(
    assertCheatsheetMathematicsPreserved({ baseline, candidate }).expressions,
    3,
  );
  for (const changed of [
    candidate.replace("n\\ge 1", "n>1"),
    candidate.replace("a+b=c", "a-b=c"),
    candidate.replace(String.raw`\begin{equation}x=y\end{equation}`, ""),
  ])
    assert.throws(
      () =>
        assertCheatsheetMathematicsPreserved({ baseline, candidate: changed }),
      /preservation failed/u,
    );
  assert.throws(
    () =>
      assertCheatsheetMathematicsPreserved({
        baseline: "$x$ $y$",
        candidate: "$y$ $x$",
      }),
    /preservation failed/u,
  );
  assert.throws(
    () =>
      assertCheatsheetMathematicsPreserved({
        baseline,
        candidate: `${candidate}$z$`,
      }),
    /adds/u,
  );
  assert.equal(
    assertCheatsheetMathematicsPreserved({
      baseline,
      candidate: `${candidate}$z$`,
      policy: "preserve-existing",
    }).candidateExpressions,
    4,
  );
});
it("cannot bless a changed printed formula by refreshing fingerprints while selected arithmetic code stays green", () => {
  const baseline = String.raw`\[(a^2+b^2)(c^2+d^2)=(ac-bd)^2+(ad+bc)^2\]`;
  const changed = baseline.replace("+(ad+bc)", "-(ad+bc)");
  const selectedCheck = (a: number, b: number, c: number, d: number) =>
    (a * a + b * b) * (c * c + d * d) ===
    (a * c - b * d) ** 2 + (a * d + b * c) ** 2;
  assert.equal(selectedCheck(1, 1, 1, 1), true);
  const refreshedFingerprint = sha256(changed);
  assert.equal(refreshedFingerprint, sha256(changed));
  assert.notEqual(refreshedFingerprint, sha256(baseline));
  const left = (1 ** 2 + 1 ** 2) * (1 ** 2 + 1 ** 2);
  const printedWrong = (1 * 1 - 1 * 1) ** 2 - (1 * 1 + 1 * 1) ** 2;
  assert.notEqual(left, printedWrong);
  assert.throws(
    () =>
      assertCheatsheetMathematicsPreserved({ baseline, candidate: changed }),
    /preservation failed/u,
  );
});
