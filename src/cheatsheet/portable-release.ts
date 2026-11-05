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
import { assertCheatsheetParagraphStructure } from "./structure.js";
import { retainCheatsheetBuild } from "./retained-build.js";
import { compilePortableSource } from "./portable-build.js";
import type {
  CheatsheetConstraints,
  CheatsheetReleaseVerification,
} from "./types.js";

const run = promisify(execFile);
import {
  dominantBodyPointSize,
  fontMeasurementZoom,
  fontMeasurementTolerance,
  inspectPdfBoundaries,
} from "./pdf-inspection.js";
import {
  cheatsheetExecutablePath,
  requireCheatsheetExecutable,
} from "./toolchain.js";

async function command(
  executable: string,
  arguments_: string[],
  cwd: string,
): Promise<string> {
  const result = await run(
    requireCheatsheetExecutable(executable),
    arguments_,
    {
      env: { ...process.env, PATH: cheatsheetExecutablePath() },
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return result.stdout;
}

function pagesFrom(pdfinfo: string): number {
  const match = /^Pages:\s+(\d+)$/mu.exec(pdfinfo);
  if (match?.[1] === undefined) {
    throw new Error("pdfinfo did not report a page count.");
  }
  return Number(match[1]);
}

async function portraitA4Info({
  pdf,
  cwd,
  label,
}: {
  pdf: string;
  cwd: string;
  label: "Rebuilt PDF" | "Released PDF";
}): Promise<{ pdfinfo: string; pageCount: number }> {
  const pageCount = pagesFrom(await command("pdfinfo", [pdf], cwd));
  if (pageCount < 1) throw new Error(`${label} has no pages.`);
  const pdfinfo = await command(
    "pdfinfo",
    ["-f", "1", "-l", String(pageCount), "-box", pdf],
    cwd,
  );
  const sizes = [...pdfinfo.matchAll(/^Page\s+(\d+) size:\s+(.+)$/gmu)];
  const rotations = [...pdfinfo.matchAll(/^Page\s+(\d+) rot:\s+(-?\d+)$/gmu)];
  if (sizes.length !== pageCount || rotations.length !== pageCount)
    throw new Error(`${label} has incomplete per-page geometry evidence.`);
  for (let index = 0; index < pageCount; index += 1) {
    const page = String(index + 1);
    if (
      sizes[index]?.[1] !== page ||
      rotations[index]?.[1] !== page ||
      !/^595\.\d+ x 841\.\d+ pts \(A4\)$/u.test(sizes[index]?.[2] ?? "") ||
      Number(rotations[index]?.[2]) % 180 !== 0
    )
      throw new Error(`${label} page ${page} is not portrait A4.`);
  }
  return { pdfinfo, pageCount };
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
  requiredLabels?: string[];
  evidenceDestination?: string;
}): Promise<CheatsheetReleaseVerification> {
  assertCheatsheetParagraphStructure(input.source);
  if (/\\(?:resizebox|scalebox)\b/u.test(input.source)) {
    throw new Error("Release source uses hidden geometric scaling.");
  }
  if (input.evidenceDestination !== undefined)
    await mkdir(input.evidenceDestination);
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
    const recordedInputs = await compilePortableSource(buildRoot, texName);
    const latexLog = await readFile(
      join(buildRoot, "aux", texName.replace(/\.tex$/u, ".log")),
      "utf8",
    );
    if ((input.requiredLabels?.length ?? 0) > 0) {
      const auxiliary = await readFile(
        join(buildRoot, "aux", texName.replace(/\.tex$/u, ".aux")),
        "utf8",
      );
      const compiledLabels = new Set(
        [...auxiliary.matchAll(/\\newlabel\{([^{}]+)\}/gu)].map(
          (match) => match[1],
        ),
      );
      for (const label of input.requiredLabels ?? []) {
        if (!compiledLabels.has(label))
          throw new Error(
            `Included artifact label ${label} is absent from compiled auxiliary evidence.`,
          );
      }
    }
    if (/Overfull \\[hv]box|Missing character:/u.test(latexLog)) {
      throw new Error(
        "Isolated build reports an overfull box or missing glyph.",
      );
    }
    if (
      /undefined references|Reference .+ undefined|pdfTeX warning \(dest\):/u.test(
        latexLog.replace(/\s+/gu, " "),
      )
    )
      throw new Error(
        "Isolated build has unresolved references or PDF destinations.",
      );
    const declaredBodyPointSize =
      /^CHEATSHEET-BODY-PT=([0-9]+(?:\.[0-9]+)?)$/mu.exec(latexLog)?.[1];
    const builtPdf = join(buildRoot, builtPdfName);
    const fontXml = await command(
      "pdftohtml",
      [
        "-xml",
        "-i",
        "-q",
        "-zoom",
        String(fontMeasurementZoom),
        "-noroundcoord",
        "-stdout",
        builtPdf,
      ],
      buildRoot,
    );
    const bodyPointSize = dominantBodyPointSize(fontXml);
    const mathFontLines = [
      ...latexLog.matchAll(
        /^CHEATSHEET-(TEXT|SCRIPT|SCRIPTSCRIPT)FONT3=(.+)$/gmu,
      ),
    ];
    const mathSizes = mathFontLines
      .slice(-3)
      .map((match) =>
        Number(/ at ([0-9.]+)pt$/u.exec(match[2] ?? "")?.[1] ?? 10),
      );
    if (
      mathFontLines.length > 0 &&
      (mathSizes.length !== 3 ||
        Math.abs((mathSizes[0] ?? 0) - bodyPointSize) >
          fontMeasurementTolerance ||
        (mathSizes[1] ?? 0) > (mathSizes[0] ?? 0) ||
        (mathSizes[2] ?? 0) > (mathSizes[1] ?? 0) ||
        mathSizes.some((size) => !Number.isFinite(size) || size <= 0))
    )
      throw new Error(
        "Reported native mathematics extension fonts do not match body/script sizing.",
      );

    const fullXml = await command(
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
    );
    const boundaries = inspectPdfBoundaries(fullXml, input.constraints.layout);
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
    const { pdfinfo, pageCount } = await portraitA4Info({
      pdf: builtPdf,
      cwd: buildRoot,
      label: "Rebuilt PDF",
    });
    assertPageLimit(pageCount, input.constraints);
    const releasedGeometry = await portraitA4Info({
      pdf: referencePdf,
      cwd: referenceRoot,
      label: "Released PDF",
    });
    if (releasedGeometry.pageCount !== pageCount)
      throw new Error("Released PDF does not match the isolated source build.");
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
    const renderPaths = async (prefix: string) =>
      (await readdir(renderRoot))
        .filter(
          (name) => name.startsWith(`${prefix}-`) && name.endsWith(".png"),
        )
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => join(renderRoot, name));
    const buildEvidence =
      input.evidenceDestination === undefined
        ? undefined
        : await retainCheatsheetBuild({
            destination: input.evidenceDestination,
            source: join(buildRoot, texName),
            pdf: builtPdf,
            releasedPdf: referencePdf,
            aux: join(buildRoot, "aux", texName.replace(/\.tex$/u, ".aux")),
            log: join(buildRoot, "aux", texName.replace(/\.tex$/u, ".log")),
            pdfInfo: pdfinfo,
            fontXml,
            fullXml,
            renders: await renderPaths("built"),
            releasedRenders: await renderPaths("released"),
          });
    const verification: CheatsheetReleaseVerification = {
      ...(buildEvidence === undefined ? {} : { buildEvidence }),
      texSha256: sha256Bytes(Buffer.from(input.source, "utf8")),
      pdfSha256: sha256Bytes(input.releasedPdf),
      pageCount,
      fontsEmbedded,
      textMatches,
      rendersMatch,
      isolatedBuild: true,
      evidence: [
        `isolated ${texName} compiled`,
        `${recordedInputs} recorded inputs confined to the release workspace and installed TeX distribution`,
        `${pageCount} portrait A4 page${pageCount === 1 ? "" : "s"}`,
        "all fonts embedded",
        mathFontLines.length === 0
          ? "Native mathematics extension-font diagnostics absent; requires font/visual inspection"
          : mathFontLines.map((match) => match[0]).join("; "),
        `${boundaries.textBoxes} full XML text boxes checked against page bounds; header/footer geometry ${boundaries.furnitureChecked ? "checked" : "not declared, requires visual review"}`,
        `${input.requiredLabels?.length ?? 0} declared included labels checked against compiled auxiliary evidence`,
        declaredBodyPointSize === undefined
          ? `PDF dominant text size ${bodyPointSize}pt (measurement tolerance ${fontMeasurementTolerance}pt)`
          : `PDF dominant text size ${bodyPointSize}pt corroborates declared body size ${declaredBodyPointSize}pt`,
        "extracted text and 180 dpi renders match released PDF",
        `rebuilt PDF bytes ${sha256Bytes(builtPdfBytes)}`,
      ],
    };
    if (input.evidenceDestination !== undefined)
      await writeFile(
        join(input.evidenceDestination, "verification.json"),
        `${JSON.stringify(verification, null, 2)}\n`,
        { flag: "wx" },
      );
    return verification;
  } catch (error) {
    if (input.evidenceDestination !== undefined)
      await writeFile(
        join(input.evidenceDestination, "failure.json"),
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        { flag: "wx" },
      );
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
