import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const preamblePath =
  "seed-templates/70 Learning/templates/mathematics-cheatsheet-preamble.template.tex";
const specimen = String.raw`
\hypertarget{source:S}{}%
\MajorBlock{M}{Major navigation}
\Topic{Navigation}
\Statement*{Theorem}{Pivot}{Selected hypotheses.\\ Selected conclusion.}
\FormalStatement*{Lemma}{Bound}{S}{}{Selected formal statement.}
\Statement{Definition}{Routine}{Normal statement.}
\FormalStatement{Lemma}{Routine}{S}{}{Normal lemma.}
\Proof{Normal proof.\par Proof continues in a second paragraph.}
Ordinary prose resumes.\par
\Worked{A1}{Worked sample}{Normal problem.}{Normal solution.}
\QuestionPart{a}{Sample}{S}{Normal question.}{Normal response.}
\Method{Choose domain.}\par
\KeyTerm{Lookup term.}\par
\Hypothesis{Nonempty domain.}\par
\Result{Unique solution.}\par
\Conclusion{Decisive result.}\par
\Caution{\Pitfall{Sign trap.} Normal warning.}
\Counterexample{B}{Normal counterexample.}
\Correction{Normal correction.}
\[\KeyFormula{x=y}\]
`;

async function render(monochrome: boolean, body = specimen) {
  const preamble = await readFile(preamblePath, "utf8");
  const cwd = await mkdtemp(join(tmpdir(), "cheatsheet-emphasis-"));
  try {
    await writeFile(
      join(cwd, "sheet.tex"),
      String.raw`\documentclass[a4paper]{article}
\newcommand{\ChatGPTLogo}{}
${preamble}
${monochrome ? String.raw`\selectcolormodel{gray}` : ""}
\begin{document}
\SheetBodyFont
${body}
\end{document}
`,
    );
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-no-shell-escape",
        "-halt-on-error",
        "-interaction=nonstopmode",
        "sheet.tex",
      ],
      { cwd },
    );
    await Promise.all([
      run(
        "pdftohtml",
        [
          "-zoom",
          "1",
          "-noroundcoord",
          "-xml",
          "-hidden",
          "sheet.pdf",
          "sheet.xml",
        ],
        { cwd },
      ),
      run("pdftocairo", ["-svg", "sheet.pdf", "sheet.svg"], { cwd }),
    ]);
    return {
      text: await readFile(join(cwd, "sheet.xml"), "utf8"),
      graphics: await readFile(join(cwd, "sheet.svg"), "utf8"),
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function luminance(hex: string) {
  const rgb = [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function closeColor(actual: string, expected: string) {
  return [0, 2, 4].every(
    (i) =>
      Math.abs(
        parseInt(actual.slice(i, i + 2), 16) -
          parseInt(expected.slice(i, i + 2), 16),
      ) <= 1,
  );
}

function renderedFills(graphics: string) {
  return [
    ...graphics.matchAll(/<path fill-rule="nonzero" fill="rgb\(([^)]+)\)"/gu),
  ].map(([, rgb = ""]) =>
    rgb
      .split(", ")
      .map((channel) =>
        Math.round((Number.parseFloat(channel) * 255) / 100)
          .toString(16)
          .padStart(2, "0"),
      )
      .join(""),
  );
}

for (const monochrome of [false, true]) {
  it(`prints semantic emphasis in ${monochrome ? "monochrome" : "color"} at native size`, async () => {
    const { text, graphics } = await render(monochrome);
    const runs = renderedText(text);
    const strokes = [
      ...graphics.matchAll(
        /<path fill="none" stroke-width="([\d.]+)"[^>]* d="M ([-\d.e]+) ([-\d.e]+) L ([-\d.e]+) ([-\d.e]+) " transform="matrix\([^,]+, [^,]+, [^,]+, [^,]+, ([-\d.e]+), ([-\d.e]+)\)"/gu,
      ),
    ].map(([, thickness, x0, y0, x1, y1, left, baseline]) => ({
      thickness: Number(thickness),
      width: Math.abs(Number(x1) - Number(x0)),
      height: Math.abs(Number(y1) - Number(y0)),
      left: Number(left),
      baseline: Number(baseline),
    }));
    const backgrounds = renderedFills(graphics);
    const [majorBackground = ""] = backgrounds;
    assert.equal(backgrounds.length, 1, "only the major section band uses a fill");
    for (const [heading, background, expected] of [
      ["M Major navigation", majorBackground, "233d57"],
      ["Navigation", "ffffff", "ffffff"],
    ] as const) {
      assert.equal(background.length, 6, `${heading} prints on a color band`);
      assert.ok(
        monochrome
          ? /^([\da-f]{2})\1\1$/u.test(background)
          : closeColor(background, expected),
        `${heading} background matches the print mode`,
      );
      const title = runs.find(({ label }) => label === `<b>${heading}</b>`);
      const ink = title?.ink ?? "";
      if (heading === "M Major navigation")
        assert.equal(ink, "ffffff", "white section heading");
      assert.ok(contrast(ink, background) >= 9, `${heading} band contrast`);
    }
    const roles = [
      ["Navigation", "233d57", 1],
      ["Theorem Pivot.", "0037b3", 1],
      ["Lemma Bound", "0037b3", 1],
      ["Definition Routine.", "000000", 1],
      ["Lemma Routine", "000000", 1],
      ["Pf.", "000000", 1],
      ["Sol.", "000000", 2],
      ["Choose domain.", "006343", 1],
      ["Lookup term.", "006343", 1],
      ["Nonempty domain.", "0037b3", 1],
      ["Unique solution.", "0037b3", 1],
      ["Decisive result.", "0037b3", 1],
      ["Sign trap.", "9c2500", 1],
      ["Caution.", "000000", 1],
      ["Counterexample B.", "000000", 1],
      ["Qualification/correction.", "000000", 1],
    ] as const;

    for (const [label, color, count] of roles) {
      const matches = runs.filter((run) => run.label === `<b>${label}</b>`);
      assert.equal(matches.length, count, `${label} prints in bold`);
      for (const run of matches) {
        const ink = run.ink;
        assert.ok(
          monochrome && color !== "000000"
            ? /^([1-7][\da-f])\1\1$/u.test(ink)
            : closeColor(ink, color),
          `${label} prints in its role's ink`,
        );
        assert.ok(contrast(ink, "ffffff") >= 7, `${label} contrasts with white`);
        if (/^(Theorem |Lemma |Definition |Pf\.$|Sol\.$)/u.test(label)) {
          const selected = label === "Theorem Pivot." || label === "Lemma Bound";
          assert.ok(
            strokes.some(
              (stroke) =>
                stroke.thickness >= 0.2 &&
                (stroke.thickness >= 0.35) === selected &&
                stroke.height < 0.02 &&
                stroke.width >= run.width * 0.45 &&
                Math.abs(stroke.left - run.left) < 1 &&
                stroke.baseline >= run.bottom - 0.15 &&
                stroke.baseline < run.bottom + 1.75,
            ),
            `${label} prints with an underline`,
          );
        }
      }
      assert.equal(
        new Set(matches.map(({ font }) => font)).size,
        1,
        `${label} uses one style across wrappers`,
      );
    }

    for (const passage of [
      "Selected hypotheses.",
      "Selected conclusion.",
      "Selected formal statement.",
    ]) {
      const run = runs.find(({ label }) => label.includes(passage));
      const ink = run?.ink ?? "";
      assert.ok(
        monochrome ? /^([1-7][\da-f])\1\1$/u.test(ink) : closeColor(ink, "0037b3"),
        `${passage} prints in its passage ink`,
      );
      assert.ok(
        contrast(ink, "ffffff") >= 7,
        `${passage} contrasts with white`,
      );
      assert.ok(
        !run?.label.includes("<b>"),
        `${passage} prints at regular weight`,
      );
    }
    for (const passage of [
      "Normal statement.",
      "Normal lemma.",
      "Normal proof.",
      "Proof continues in a second paragraph.",
      "Normal solution.",
      "Normal response.",
      "Normal warning.",
      "Normal counterexample.",
      "Normal correction.",
      "Ordinary prose resumes.",
      "Normal problem.",
      "Normal question.",
    ]) {
      const run = runs.find(({ label }) => label.includes(passage));
      assert.equal(run?.ink, "000000", passage);
    }
    const formulaBox = strokes.filter(
      ({ left, thickness }) => left > 250 && thickness > 0.3,
    );
    assert.equal(
      formulaBox.filter(({ width }) => width > 10).length,
      2,
      "key formula has top and bottom rules",
    );
    assert.equal(
      formulaBox.filter(({ height }) => height > 5).length,
      2,
      "key formula has left and right rules",
    );
  });
}

const sampleWithHighlights = String.raw`
Above the claim.\par
\HighlightedStatement{theorem}{Theorem}{Pivot}{First printed claim.\\ Second printed claim. \HighlightTag{term}{Inner term.}}
Below the claim.\par
\HighlightedStatement{lemma}{Lemma}{Bridge}{Supporting claim.}
\PassageHighlight{exercise}{\textbf{Ex. 7.}\ Find the decisive step.}
\HighlightTag{term}{Jacobian}\quad Next to the term.\par
\HighlightTag{paper}{Paper A, Q2}\quad Next to the paper.\par
\TaggedStatement{theorem}{Theorem}{Label}{Plain statement body.}
\PassageHighlight{exercise}{Outer exercise.\PassageHighlight{lemma}{Inner paragraph.}}
`;

const sampleOnWhite = String.raw`
Above the claim.\par
\SheetRunIn[0.40pt]{Theorem Pivot.}\ First printed claim.\\ Second printed claim. \textbf{Inner term.}\par
Below the claim.\par
\SheetRunIn[0.40pt]{Lemma Bridge.}\ Supporting claim.\par
\textbf{Ex. 7.}\ Find the decisive step.\par
\textbf{Jacobian}\quad Next to the term.\par
\textbf{Paper A, Q2}\quad Next to the paper.\par
\KeepBlock{\SheetRunIn[0.40pt]{Theorem Label.}\ Plain statement body.}
Outer exercise.\par Inner paragraph.\par
`;

function renderedText(xml: string) {
  const colors = new Map(
    [...xml.matchAll(/<fontspec id="(\d+)"[^>]* color="#([\da-f]{6})"/gu)]
      .map(([, font, color]) => [font, color]),
  );
  return [...xml.matchAll(
    /<text top="([\d.]+)" left="([\d.]+)" width="([\d.]+)" height="([\d.]+)" font="(\d+)">([^\n]+)<\/text>/gu,
  )].map(([, top, left, width, height, font, label]) => ({
    top: Number(top),
    left: Number(left),
    width: Number(width),
    height: Number(height),
    bottom: Number(top) + Number(height),
    font,
    ink: colors.get(font) ?? "",
    label: label ?? "",
  }));
}

for (const monochrome of [false, true]) {
  it(`prints distinct priority fills at the same footprint in ${monochrome ? "grayscale" : "color"}`, async () => {
    const [highlighted, plain] = await Promise.all([
      render(monochrome, sampleWithHighlights),
      render(monochrome, sampleOnWhite),
    ]);
    const fills = renderedFills(highlighted.graphics);
    const roles = [
      ["First printed claim.", "0037b3", "dceaff"],
      ["Supporting claim.", "4f246e", "ecddff"],
      ["Find the decisive step.", "004c35", "ccf0db"],
      ["Jacobian", "594200", "fff0a8"],
      ["Paper A, Q2", "741943", "f8dae6"],
      ["Theorem Label.", "0037b3", "dceaff"],
      ["Outer exercise.", "004c35", "ccf0db"],
    ] as const;
    assert.equal(fills.length, roles.length);
    assert.deepEqual(renderedFills(plain.graphics), []);

    const runs = renderedText(highlighted.text);
    const plainRuns = renderedText(plain.text);
    const isGray = /^([\da-f]{2})\1\1$/u;
    for (const [i, [label, ink, fill]] of roles.entries()) {
      const run = runs.find((entry) => entry.label.includes(label));
      assert.ok(run, label);
      const printedFill = fills[i] ?? "";
      assert.ok(monochrome ? isGray.test(printedFill) : closeColor(printedFill, fill), label);
      assert.ok(monochrome ? isGray.test(run.ink) : closeColor(run.ink, ink), label);
      assert.ok(contrast(printedFill, "ffffff") > 1.05, `${label} fill shows on white`);
      assert.ok(contrast(run.ink, printedFill) >= 7, `${label} contrasts with its fill`);
    }
    for (const label of [
      "Above the claim.",
      "First printed claim.",
      "Second printed claim.",
      "Inner term.",
      "Below the claim.",
      "Supporting claim.",
      "Find the decisive step.",
      "Jacobian",
      "Next to the term.",
      "Paper A, Q2",
      "Next to the paper.",
      "Theorem Label.",
      "Plain statement body.",
      "Outer exercise.",
      "Inner paragraph.",
    ]) {
      const run = runs.find((entry) => entry.label.includes(label));
      const plainRun = plainRuns.find((entry) => entry.label.includes(label));
      assert.ok(run && plainRun, label);
      assert.deepEqual(
        [run.top, run.left, run.width, run.height],
        [plainRun.top, plainRun.left, plainRun.width, plainRun.height],
        `${label} keeps its bounds`,
      );
    }
    for (const label of ["Below the claim.", "Next to the term.", "Next to the paper.", "Plain statement body."]) {
      assert.equal(runs.find((run) => run.label.includes(label))?.ink, "000000", label);
    }
    const printedClaim = runs.find((run) => run.label.includes("Second printed claim."));
    assert.equal(printedClaim?.ink, runs.find((run) => run.label.includes("First printed claim."))?.ink);
    assert.equal(runs.find((run) => run.label.includes("Inner term."))?.ink, printedClaim?.ink);
    assert.equal(
      runs.find((run) => run.label.includes("Inner paragraph."))?.ink,
      runs.find((run) => run.label.includes("Outer exercise."))?.ink,
    );
  });
}
