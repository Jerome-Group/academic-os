import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { sha256Bytes } from "../checksum.js";
import type {
  CheatsheetConstraints,
  CheatsheetReleaseVerification,
} from "./types.js";

const run = promisify(execFile);
const fontMeasurementZoom = 3;
const fontMeasurementTolerance = 0.2;

async function command(
  executable: string,
  arguments_: string[],
  cwd: string,
): Promise<string> {
  const result = await run(executable, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

function pagesFrom(pdfinfo: string): number {
  const match = /^Pages:\s+(\d+)$/mu.exec(pdfinfo);
  if (match?.[1] === undefined) {
    throw new Error("pdfinfo did not report a page count.");
  }
  return Number(match[1]);
}

function assertPageLimit(
  pages: number,
  constraints: CheatsheetConstraints,
): void {
  if (
    constraints.pages.exact !== undefined &&
    pages !== constraints.pages.exact
  ) {
    throw new Error(
      `Release has ${pages} pages; expected exactly ${constraints.pages.exact}.`,
    );
  }
  if (
    constraints.pages.maximum !== undefined &&
    pages > constraints.pages.maximum
  ) {
    throw new Error(
      `Release has ${pages} pages; maximum is ${constraints.pages.maximum}.`,
    );
  }
}

function fontsAreEmbedded(pdffonts: string): boolean {
  const resources = pdffonts
    .split(/\r?\n/u)
    .map((line) =>
      /\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/u.exec(line),
    )
    .filter((match): match is RegExpExecArray => match !== null);
  return resources.length > 0 && resources.every((match) => match[1] === "yes");
}

function visibleCharacterCount(xmlText: string): number {
  return xmlText
    .replace(/<[^>]+>/gu, "")
    .replace(/&(?:#x?[0-9A-Fa-f]+|[A-Za-z]+);/gu, "x")
    .replace(/\s/gu, "").length;
}

function dominantBodyPointSize(xml: string): number {
  const weights = new Map<number, number>();
  const pages = xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu);
  for (const pageMatch of pages) {
    const page = pageMatch[1] ?? "";
    const sizes = new Map<string, number>();
    for (const font of page.matchAll(/<fontspec\b([^>]*)\/>/gu)) {
      const attributes = font[1] ?? "";
      const id = /\bid="([^"]+)"/u.exec(attributes)?.[1];
      const scaledSize = Number(/\bsize="([0-9.]+)"/u.exec(attributes)?.[1]);
      if (id !== undefined && Number.isFinite(scaledSize)) {
        sizes.set(id, scaledSize / fontMeasurementZoom);
      }
    }
    for (const text of page.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)) {
      const id = /\bfont="([^"]+)"/u.exec(text[1] ?? "")?.[1];
      const size = id === undefined ? undefined : sizes.get(id);
      const weight = visibleCharacterCount(text[2] ?? "");
      if (size !== undefined && weight > 0) {
        weights.set(size, (weights.get(size) ?? 0) + weight);
      }
    }
  }
  const bodySize = [...weights]
    .sort(
      ([leftSize, leftWeight], [rightSize, rightWeight]) =>
        rightWeight - leftWeight || leftSize - rightSize,
    )
    .at(0)?.[0];
  if (bodySize === undefined) {
    throw new Error("PDF font inspection found no visible text.");
  }
  return bodySize;
}

async function renderedDigests(
  root: string,
  pdf: string,
  prefix: string,
): Promise<string[]> {
  await command("pdftoppm", ["-png", "-r", "180", pdf, prefix], root);
  const names = (await readdir(root))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".png"))
    .sort();
  return Promise.all(
    names.map(async (name) => sha256Bytes(await readFile(join(root, name)))),
  );
}

export async function verifyPortableCheatsheetRelease(input: {
  source: string;
  releasedPdf: Uint8Array;
  filename: string;
  constraints: CheatsheetConstraints;
}): Promise<CheatsheetReleaseVerification> {
  if (/\\(?:resizebox|scalebox)\b/u.test(input.source)) {
    throw new Error("Release source uses hidden geometric scaling.");
  }
  const workspace = await mkdtemp(join(tmpdir(), "cheatsheet-portable-"));
  try {
    const buildRoot = join(workspace, "build");
    const referenceRoot = join(workspace, "reference");
    const renderRoot = join(workspace, "renders");
    const texName = basename(input.filename);
    if (!texName.endsWith(".tex")) {
      throw new Error("Release filename must end in .tex.");
    }
    const builtPdfName = texName.replace(/\.tex$/u, ".pdf");
    await Promise.all([
      mkdir(join(buildRoot, "aux"), { recursive: true }),
      mkdir(referenceRoot),
      mkdir(renderRoot),
    ]);
    const referencePdf = join(referenceRoot, "released.pdf");
    await Promise.all([
      writeFile(join(buildRoot, texName), input.source, "utf8"),
      writeFile(referencePdf, input.releasedPdf),
    ]);
    await command(
      "latexmk",
      [
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-auxdir=aux",
        texName,
      ],
      buildRoot,
    );
    const latexLog = await readFile(
      join(buildRoot, "aux", texName.replace(/\.tex$/u, ".log")),
      "utf8",
    );
    if (/Overfull \\[hv]box|Missing character:/u.test(latexLog)) {
      throw new Error(
        "Isolated build reports an overfull box or missing glyph.",
      );
    }
    const declaredBodyPointSize =
      /^CHEATSHEET-BODY-PT=([0-9]+(?:\.[0-9]+)?)$/mu.exec(latexLog)?.[1];
    const builtPdf = join(buildRoot, builtPdfName);
    const bodyPointSize = dominantBodyPointSize(
      await command(
        "pdftohtml",
        [
          "-xml",
          "-hidden",
          "-i",
          "-q",
          "-zoom",
          String(fontMeasurementZoom),
          "-noroundcoord",
          "-stdout",
          builtPdf,
        ],
        buildRoot,
      ),
    );
    if (
      declaredBodyPointSize !== undefined &&
      Math.abs(bodyPointSize - Number(declaredBodyPointSize)) >
        fontMeasurementTolerance
    ) {
      throw new Error(
        `Declared body size ${declaredBodyPointSize}pt does not match the PDF's dominant text size ${bodyPointSize}pt.`,
      );
    }
    if (
      bodyPointSize + fontMeasurementTolerance <
      input.constraints.bodyPt.floor
    ) {
      throw new Error(
        `Release body size ${bodyPointSize}pt is below the ${input.constraints.bodyPt.floor}pt floor.`,
      );
    }
    const pdfinfo = await command("pdfinfo", [builtPdf], buildRoot);
    if (!/^Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)$/mu.test(pdfinfo)) {
      throw new Error("Release is not portrait A4.");
    }
    const pageCount = pagesFrom(pdfinfo);
    assertPageLimit(pageCount, input.constraints);
    const fontsEmbedded = fontsAreEmbedded(
      await command("pdffonts", [builtPdf], buildRoot),
    );
    if (!fontsEmbedded) {
      throw new Error("The isolated PDF has an unembedded font.");
    }
    const [builtText, releasedText] = await Promise.all([
      command("pdftotext", ["-layout", builtPdf, "-"], buildRoot),
      command("pdftotext", ["-layout", referencePdf, "-"], referenceRoot),
    ]);
    const [builtRenders, releasedRenders] = await Promise.all([
      renderedDigests(renderRoot, builtPdf, "built"),
      renderedDigests(renderRoot, referencePdf, "released"),
    ]);
    const textMatches = builtText === releasedText;
    const rendersMatch =
      builtRenders.length === releasedRenders.length &&
      builtRenders.every((digest, index) => digest === releasedRenders[index]);
    if (!textMatches || !rendersMatch) {
      throw new Error("Released PDF does not match the isolated source build.");
    }
    const builtPdfBytes = await readFile(builtPdf);
    return {
      texSha256: sha256Bytes(Buffer.from(input.source, "utf8")),
      pdfSha256: sha256Bytes(input.releasedPdf),
      pageCount,
      fontsEmbedded,
      textMatches,
      rendersMatch,
      isolatedBuild: true,
      evidence: [
        `isolated ${texName} compiled`,
        `${pageCount} portrait A4 page${pageCount === 1 ? "" : "s"}`,
        "all fonts embedded",
        declaredBodyPointSize === undefined
          ? `PDF dominant text size ${bodyPointSize}pt (measurement tolerance ${fontMeasurementTolerance}pt)`
          : `PDF dominant text size ${bodyPointSize}pt corroborates declared body size ${declaredBodyPointSize}pt`,
        "extracted text and 180 dpi renders match released PDF",
        `rebuilt PDF bytes ${sha256Bytes(builtPdfBytes)}`,
      ],
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
