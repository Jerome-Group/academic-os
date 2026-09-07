import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it } from "node:test";

import { verifyPortableCheatsheetRelease } from "../../src/cheatsheet/index.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const run = promisify(execFile);
let latexAvailable = true;
try {
  await run("latexmk", ["-version"]);
  await run("pdftoppm", ["-v"]);
} catch {
  latexAvailable = false;
}

const constraints = {
  paper: "A4" as const,
  pages: { exact: 1 },
  color: "monochrome" as const,
  columns: 1,
  bodyPt: { preferred: 10, floor: 9 },
};
const source = String.raw`\documentclass[a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\pagestyle{empty}
\begin{document}
\typeout{CHEATSHEET-BODY-PT=10}
{\fontsize{14}{16}\selectfont Heading}\par
\fontsize{10}{12}\selectfont Portable mathematical source: $a^2+b^2=c^2$.
\end{document}
`;

it("rebuilds a self-contained release and matches its extracted text and renders", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "portable-release-fixture-"));
  try {
    await writeFile(join(root, "sheet.tex"), source);
    await run(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "sheet.tex"],
      { cwd: root },
    );
    const releasedPdf = await readFile(join(root, "sheet.pdf"));
    const result = await verifyPortableCheatsheetRelease({
      source,
      releasedPdf,
      filename: "sheet.tex",
      constraints,
    });
    assert.equal(result.isolatedBuild, true);
    assert.equal(result.pageCount, 1);
    assert.ok(
      result.evidence.includes(
        "PDF dominant text size 10pt corroborates declared body size 10pt",
      ),
    );
    recordBehaviorEvidence("MF-CHEATSHEET-001", () => {
      assert.equal(result.isolatedBuild, true);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects hidden scaling before compilation", async () => {
  await assert.rejects(
    verifyPortableCheatsheetRelease({
      source: `${source}\n\\scalebox{.8}{hidden}`,
      releasedPdf: Buffer.from("unused"),
      filename: "sheet.tex",
      constraints,
    }),
    /hidden geometric scaling/u,
  );
});

it("preserves the released PDF reference when the release is named released.tex", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "portable-release-reference-"));
  try {
    const oldSource = source.replace(
      "Portable mathematical source",
      "Obsolete mathematical source",
    );
    await writeFile(join(root, "old.tex"), oldSource);
    await run(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "old.tex"],
      { cwd: root },
    );
    await assert.rejects(
      verifyPortableCheatsheetRelease({
        source,
        releasedPdf: await readFile(join(root, "old.pdf")),
        filename: "released.tex",
        constraints,
      }),
      /does not match/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a body-size marker that overstates the rendered body font", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "portable-release-font-floor-"));
  try {
    const undersized = source.replace(
      "\\fontsize{10}{12}",
      "\\fontsize{2}{2.4}",
    );
    await writeFile(join(root, "sheet.tex"), undersized);
    await run(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "sheet.tex"],
      { cwd: root },
    );
    await assert.rejects(
      verifyPortableCheatsheetRelease({
        source: undersized,
        releasedPdf: await readFile(join(root, "sheet.pdf")),
        filename: "sheet.tex",
        constraints,
      }),
      /does not match the PDF's dominant text size/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("ignores invisible text when enforcing the rendered body font floor", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "portable-release-hidden-font-"));
  try {
    const lyingSource = source.replace(
      "{\\fontsize{14}{16}\\selectfont Heading}\\par\n\\fontsize{10}{12}\\selectfont Portable mathematical source: $a^2+b^2=c^2$.",
      "\\pdfliteral direct {3 Tr}{\\fontsize{10}{12}\\selectfont Invisible body repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated repeated.}\\pdfliteral direct {0 Tr}\\par\n{\\fontsize{2}{2.4}\\selectfont Visible mathematical source: $a^2+b^2=c^2$.}",
    );
    await writeFile(join(root, "sheet.tex"), lyingSource);
    await run(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "sheet.tex"],
      { cwd: root },
    );
    await assert.rejects(
      verifyPortableCheatsheetRelease({
        source: lyingSource,
        releasedPdf: await readFile(join(root, "sheet.pdf")),
        filename: "sheet.tex",
        constraints,
      }),
      /does not match the PDF's dominant text size/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects vertical overflow from an isolated build", {
  skip: !latexAvailable,
}, async () => {
  await assert.rejects(
    verifyPortableCheatsheetRelease({
      source: source.replace(
        "Portable mathematical source",
        "\\vbox to 1pt{\\vskip 20pt} Portable mathematical source",
      ),
      releasedPdf: Buffer.from("unused"),
      filename: "sheet.tex",
      constraints,
    }),
    /overfull box/u,
  );
});
