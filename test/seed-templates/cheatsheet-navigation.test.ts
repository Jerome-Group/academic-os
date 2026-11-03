import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { inspectPdfBoundaries } from "../../src/cheatsheet/pdf-inspection.js";
const run = promisify(execFile);

it("prints accurate orientation and continuation guides at all eight specimen column starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-navigation-"));
  try {
    for (const name of [
      "mathematics-cheatsheet",
      "mathematics-cheatsheet-preamble",
      "chatgpt-logo",
    ])
      await writeFile(
        join(root, `${name}.tex`),
        await readFile(
          `seed-templates/70 Learning/templates/${name}.template.tex`,
        ),
      );
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-no-shell-escape",
        "mathematics-cheatsheet.tex",
      ],
      { cwd: root },
    );
    const xml = (
      await run(
        "pdftohtml",
        [
          "-xml",
          "-hidden",
          "-i",
          "-q",
          "-zoom",
          "3",
          "-noroundcoord",
          "-stdout",
          "mathematics-cheatsheet.pdf",
        ],
        { cwd: root, maxBuffer: 8 * 1024 * 1024 },
      )
    ).stdout;
    assert.equal(inspectPdfBoundaries(xml).pages, 2);
    const expected = [
      [
        /Map:/u,
        /ALG-B linear algebra/u,
        /CAL-C integration/u,
        /ANA-D topology and measure/u,
      ],
      [
        /Q5\(b\).*ANA-D/u,
        /Conditional expectation/u,
        /Q8 \[DSP-F\] continued/u,
        /final checks continued/u,
      ],
    ];
    let pageIndex = 0;
    for (const page of xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu)) {
      const texts = [
        ...(page[1] ?? "").matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu),
      ].map((match) => {
        const mm = (name: string) =>
          ((Number(
            new RegExp(`\\b${name}="(-?[0-9.]+)"`, "u").exec(
              match[1] ?? "",
            )?.[1],
          ) /
            3) *
            25.4) /
          72;
        return {
          left: mm("left"),
          top: mm("top"),
          text: (match[2] ?? "").replace(/<[^>]+>/gu, ""),
        };
      });
      assert.match(
        texts
          .filter(({ top }) => top < 5)
          .map(({ text }) => text)
          .join(" "),
        new RegExp(`p\\.${pageIndex + 1}: c1`, "u"),
      );
      for (let column = 0; column < 4; column++) {
        const left = 1.8 + column * 51.75;
        const body = texts
          .filter(
            (box) =>
              box.top >= 5 &&
              box.top < 290 &&
              box.left >= left - 0.2 &&
              box.left < left + 51.2,
          )
          .sort((a, b) => a.top - b.top || a.left - b.left);
        const firstTop = body[0]?.top ?? Infinity;
        const start = body
          .filter(({ top }) => top <= firstTop + 0.7)
          .sort((a, b) => a.left - b.left)
          .map(({ text }) => text)
          .join(" ");
        assert.match(
          start,
          expected[pageIndex]?.[column] ?? /invalid/u,
          `page ${pageIndex + 1}, column ${column + 1}: ${start}`,
        );
      }
      pageIndex++;
    }
    assert.doesNotMatch(
      xml,
      /Q8\(b\).*continued\.|PRB-E2 conditional expectation continued/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
