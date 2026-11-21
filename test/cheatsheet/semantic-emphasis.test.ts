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
\Statement{Theorem}{Pivot}{Normal statement.}
\FormalStatement{Lemma}{Bound}{S}{}{Normal lemma.}
\Proof{Normal proof.}
\Worked{A1}{Worked sample}{Normal problem.}{Normal solution.}
\QuestionPart{a}{Sample}{S}{Normal question.}{Normal response.}
\Method{Choose domain.}\par
\Hypothesis{Nonempty domain.}\par
\Result{Unique solution.}\par
\Conclusion{Decisive result.}\par
\Caution{Normal warning.}
\Counterexample{B}{Normal counterexample.}
\Correction{Normal correction.}
\[\KeyFormula{x=y}\]
`;

async function render(monochrome: boolean) {
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
${specimen}
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

function closeColor(actual: string, expected: string) {
  return [0, 2, 4].every(
    (i) =>
      Math.abs(
        parseInt(actual.slice(i, i + 2), 16) -
          parseInt(expected.slice(i, i + 2), 16),
      ) <= 1,
  );
}

for (const monochrome of [false, true]) {
  it(`prints semantic emphasis in ${monochrome ? "monochrome" : "color"} at native size`, async () => {
    const { text, graphics } = await render(monochrome);
    const inks = new Map(
      [
        ...text.matchAll(/<fontspec id="(\d+)"[^>]* color="#([\da-f]{6})"/gu),
      ].map(([, id, color]) => [id, color]),
    );
    const runs = [
      ...text.matchAll(
        /<text top="([\d.]+)" left="([\d.]+)" width="([\d.]+)" height="([\d.]+)" font="(\d+)">([^\n]+)<\/text>/gu,
      ),
    ].map(([, top, left, width, height, font, label]) => ({
      top: Number(top),
      left: Number(left),
      width: Number(width),
      bottom: Number(top) + Number(height),
      font,
      label,
    }));
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
    const barInk = /<path fill-rule="nonzero" fill="rgb\(([^)]+)\)"/u.exec(
      graphics,
    )?.[1];
    assert.ok(barInk, "major section prints a filled bar");
    const channels = barInk
      .split(", ")
      .map((channel) => Number.parseFloat(channel));
    assert.equal(channels.length, 3);
    assert.ok(
      channels.every((channel) => channel < 40),
      "section bar remains dark",
    );
    assert.equal(new Set(channels).size, monochrome ? 1 : 3);
    const title = runs.find(
      ({ label }) => label === "<b>M Major navigation</b>",
    );
    assert.equal(
      inks.get(title?.font ?? ""),
      "ffffff",
      "white section heading",
    );
    const roles = [
      ["Navigation", "233d57", 1],
      ["Theorem Pivot.", "005b57", 1],
      ["Lemma Bound", "005b57", 1],
      ["Pf.", "5a316d", 1],
      ["Sol.", "5a316d", 2],
      ["Choose domain.", "5a316d", 1],
      ["Nonempty domain.", "005b57", 1],
      ["Unique solution.", "005b57", 1],
      ["Decisive result.", "005b57", 1],
      ["Caution.", "853b23", 1],
      ["Counterexample B.", "853b23", 1],
      ["Qualification/correction.", "853b23", 1],
    ] as const;

    for (const [label, color, count] of roles) {
      const matches = runs.filter((run) => run.label === `<b>${label}</b>`);
      assert.equal(matches.length, count, `${label} prints in bold`);
      for (const run of matches) {
        assert.ok(
          monochrome
            ? /^([0-7][\da-f])\1\1$/u.test(inks.get(run.font) ?? "")
            : closeColor(inks.get(run.font) ?? "", color),
          `${label} prints in its role's ink`,
        );
        if (["Theorem Pivot.", "Lemma Bound", "Pf.", "Sol."].includes(label)) {
          assert.ok(
            strokes.some(
              (stroke) =>
                stroke.thickness >= 0.2 &&
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

    const ordinary = runs.find(({ label }) => label === "Normal statement.");
    assert.equal(inks.get(ordinary?.font ?? ""), "000000");
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
