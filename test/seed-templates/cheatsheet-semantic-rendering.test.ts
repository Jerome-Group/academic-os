import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
let available = true;
try {
  await run("latexmk", ["-norc", "-version"]);
  await run("pdftotext", ["-v"]);
} catch {
  available = false;
}

async function render(
  body: string,
  options = "",
): Promise<{
  text: string;
  positions: string;
  log: string;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "cheatsheet-semantics-"));
  try {
    const preamble = await readFile(
      "seed-templates/70 Learning/templates/mathematics-cheatsheet-preamble.template.tex",
      "utf8",
    );
    const source = String.raw`\documentclass[a4paper]{article}
\newcommand{\ChatGPTLogo}{}
\newcommand{\SheetColumns}{1}
${options}
${preamble}
\SheetSetup{title={},credit={},disclaimer={},publisher={},logo={}}
\begin{document}
\begin{CheatSheet}
${body}
\end{CheatSheet}
\end{document}`;
    await writeFile(join(workspace, "sheet.tex"), source);
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-no-shell-escape",
        "sheet.tex",
      ],
      { cwd: workspace },
    );
    const [text, positions, log] = await Promise.all([
      run("pdftotext", ["-layout", "sheet.pdf", "-"], { cwd: workspace }),
      run("pdftotext", ["-bbox", "sheet.pdf", "-"], { cwd: workspace }),
      readFile(join(workspace, "sheet.log"), "utf8"),
    ]);
    return { text: text.stdout, positions: positions.stdout, log };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

it("nested KeepBlock preserves the same printed baselines without empty paragraphs", {
  skip: !available,
}, async () => {
  const body = String.raw`\KeepBlock{Alpha opening.}\KeepBlock{Beta conclusion.}`;
  const flat = await render(body);
  const nested = await render(
    String.raw`\KeepBlock{\KeepBlock{Alpha opening.}}\KeepBlock{\KeepBlock{Beta conclusion.}}`,
  );
  const baselines = (xml: string) =>
    [
      ...xml.matchAll(/<word[^>]*yMin="([^"]+)"[^>]*>(Alpha|Beta)<\/word>/gu),
    ].map((match) => [match[2], match[1]]);
  assert.equal(baselines(flat.positions).length, 2);
  assert.deepEqual(baselines(nested.positions), baselines(flat.positions));
  assert.doesNotMatch(nested.log, /Overfull \\[hv]box/u);
});

it("prints typed item references and keeps long staged proofs breakable at configured native size", {
  skip: !available,
}, async () => {
  const options = String.raw`\newcommand{\SheetBodyPointSize}{7}
\newcommand{\SheetBodyLeading}{8}
\newcommand{\SheetTopMargin}{100mm}
\newcommand{\SheetBottomMargin}{100mm}
\newcommand{\SheetHeaderBaseline}{12mm}
\newcommand{\SheetFooterBaseline}{12mm}
\newcommand{\SheetNavigationGap}{4mm}`;
  const reasoning =
    "A quantified hypothesis supplies the premise, and the stated inference supplies the conclusion. ".repeat(
      130,
    );
  const rendered = await render(
    String.raw`\SheetSetup{top-navigation={TOP-NAV},bottom-navigation={BOTTOM-NAV}}
\Example{2.1}{\label{example-two}Synthetic example.}
\Exercise{2.1}{\label{exercise-two}Synthetic exercise.}
\SourceItemRef{Eg.}{2.1}{example-two}; \SourceItemRef{Ex.}{2.1}{exercise-two}.
\Proof{\ProofStep{Construction}{\Hypothesis{Assume a finite nonempty set.} ${reasoning}}
\ProofStep{Conclusion}{END-OF-PROOF.}}
\Counterexample{C1}{An explicitly identified failing case.}
\Correction{An independently justified qualification.}`,
    options,
  );
  assert.match(rendered.text, /Eg\.\s*2\.1/u);
  assert.match(rendered.text, /Ex\.\s*2\.1/u);
  assert.match(rendered.text, /Pf\./u);
  assert.match(rendered.text, /END-OF-PROOF/u);
  const pageCount = [...rendered.positions.matchAll(/<page\b/gu)].length;
  assert.ok(pageCount > 1, "the long proof must cross a physical page");
  assert.equal([...rendered.text.matchAll(/TOP-NAV/gu)].length, pageCount);
  assert.equal([...rendered.text.matchAll(/BOTTOM-NAV/gu)].length, pageCount);
  assert.match(rendered.log, /CHEATSHEET-BODY-PT=7/u);
  assert.doesNotMatch(rendered.log, /Overfull \\[hv]box/u);
});
