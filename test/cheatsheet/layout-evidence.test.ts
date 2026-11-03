import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { inspectPdfBoundaries } from "../../src/cheatsheet/pdf-inspection.js";
import { verifyPortableCheatsheetRelease } from "../../src/cheatsheet/portable-release.js";
import { assertCheatsheetParagraphStructure } from "../../src/cheatsheet/structure.js";
import { findCheatsheetExecutable } from "../../src/cheatsheet/toolchain.js";

const run = promisify(execFile);
let toolchainAvailable = true;
try {
  for (const name of [
    "latexmk",
    "kpsewhich",
    "pdfinfo",
    "pdffonts",
    "pdftotext",
    "pdftoppm",
    "pdftohtml",
  ])
    await run(
      name,
      name === "latexmk"
        ? ["-norc", "-version"]
        : name === "kpsewhich"
          ? ["--version"]
          : ["-v"],
    );
} catch {
  toolchainAvailable = false;
}

const constraints = {
  paper: "A4",
  pages: { exact: 1 },
  color: "monochrome",
  columns: 1,
  bodyPt: { preferred: 10, floor: 9 },
} as const;
const source = String.raw`\documentclass[a4paper]{article}
\usepackage{lmodern,eso-pic}
\pagestyle{empty}
\begin{document}
\fontsize{10}{12}\selectfont
Visible synthetic mathematics: $x^2\ge0$ for every real $x$.
\end{document}
`;

it("identifies the nested noindent paragraph cause before proposing smaller type", () => {
  const unsafe = String.raw`\newcommand{\KeepBlock}[1]{\par\noindent#1\par}
\KeepBlock{\label{one}\KeepBlock{A statement.}}`;
  assert.throws(
    () => assertCheatsheetParagraphStructure(unsafe),
    /empty paragraph before fitting/u,
  );
  assert.doesNotThrow(() =>
    assertCheatsheetParagraphStructure(
      unsafe.replace("\\par\\noindent", "\\par"),
    ),
  );
});

it("checks full XML for off-page text and declared furniture clearances", () => {
  const xml = (top: number, left = 30, width = 90) =>
    `<pdf2xml><page width="1785" height="2526"><text top="${top}" left="${left}" width="${width}" height="30">Synthetic</text></page></pdf2xml>`;
  assert.throws(() => inspectPdfBoundaries(xml(2540)), /Off-page/u);
  assert.throws(() => inspectPdfBoundaries(xml(20, -40)), /Off-page/u);
  const layout = {
    marginsMm: { left: 5, right: 5, top: 10, bottom: 10 },
    headerBottomMm: 8,
    footerTopMm: 289,
  };
  assert.throws(
    () => inspectPdfBoundaries(xml(60), layout),
    /header\/footer clearance/u,
  );
  assert.throws(
    () => inspectPdfBoundaries(xml(90, 0), layout),
    /body text crosses/u,
  );
  assert.equal(
    inspectPdfBoundaries(xml(120, 60), layout).furnitureChecked,
    true,
  );
  assert.equal(inspectPdfBoundaries(xml(120)).furnitureChecked, false);
});

it("honors an explicitly incomplete toolchain instead of silently finding host tools", () => {
  assert.equal(
    findCheatsheetExecutable("pdfinfo", {
      PATH: process.env.PATH,
      ACADEMIC_OS_TOOL_PATH: "/nonexistent/synthetic-toolchain",
    }),
    undefined,
  );
});

it("retains the selected build's AUX, XML, logs and renders exclusively", {
  skip: !toolchainAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-build-retention-"));
  try {
    await writeFile(join(root, "sheet.tex"), source);
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "sheet.tex",
      ],
      { cwd: root },
    );
    const input = {
      source,
      releasedPdf: await readFile(join(root, "sheet.pdf")),
      filename: "sheet.tex",
      constraints,
      evidenceDestination: join(root, "evidence"),
    };
    const result = await verifyPortableCheatsheetRelease(input);
    assert.ok(result.buildEvidence);
    assert.match(
      await readFile(join(input.evidenceDestination, "full.xml"), "utf8"),
      /<text\b/u,
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(input.evidenceDestination, "build-identity.json"),
          "utf8",
        ),
      ).id,
      result.buildEvidence.id,
    );
    const before = await readFile(
      join(input.evidenceDestination, "verification.json"),
    );
    await assert.rejects(verifyPortableCheatsheetRelease(input), /EEXIST/u);
    assert.deepEqual(
      await readFile(join(input.evidenceDestination, "verification.json")),
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects fully off-page text from the actual compiled PDF XML", {
  skip: !toolchainAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-offpage-"));
  try {
    const offpage = source.replace(
      "\\begin{document}",
      String.raw`\AddToShipoutPictureFG{\AtPageUpperLeft{\put(30,-900){\fontsize{10}{12}\selectfont Offpage sentinel}}}
\begin{document}`,
    );
    await writeFile(join(root, "sheet.tex"), offpage);
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "sheet.tex",
      ],
      { cwd: root },
    );
    await assert.rejects(
      verifyPortableCheatsheetRelease({
        source: offpage,
        releasedPdf: await readFile(join(root, "sheet.pdf")),
        filename: "sheet.tex",
        constraints,
      }),
      /Off-page PDF text/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a compiled unresolved reference for its actual destination warning", {
  skip: !toolchainAvailable,
}, async () => {
  const root = await mkdtemp(
    join(tmpdir(), "cheatsheet-unresolved-reference-"),
  );
  try {
    const changed = source.replace(
      "\\end{document}",
      "See \\ref{missing-result}.\\end{document}",
    );
    await writeFile(join(root, "sheet.tex"), changed);
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "sheet.tex",
      ],
      { cwd: root },
    );
    await assert.rejects(
      verifyPortableCheatsheetRelease({
        source: changed,
        releasedPdf: await readFile(join(root, "sheet.pdf")),
        filename: "sheet.tex",
        constraints,
      }),
      /unresolved references or PDF destinations/u,
    );
    await writeFile(join(root, "sheet.tex"), source);
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "sheet.tex",
      ],
      { cwd: root },
    );
    assert.equal(
      (
        await verifyPortableCheatsheetRelease({
          source,
          releasedPdf: await readFile(join(root, "sheet.pdf")),
          filename: "sheet.tex",
          constraints,
        })
      ).isolatedBuild,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
