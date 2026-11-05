import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Bytes } from "../checksum.js";
import { cheatsheetBuildEvidenceId } from "./measurements.js";
import type {
  CheatsheetArtifactEvidence,
  CheatsheetBuildEvidence,
} from "./types.js";

export async function retainCheatsheetBuild(input: {
  destination: string;
  source: string;
  pdf: string;
  releasedPdf: string;
  aux: string;
  log: string;
  pdfInfo: string;
  fontXml: string;
  fullXml: string;
  renders: string[];
  releasedRenders: string[];
}): Promise<CheatsheetBuildEvidence> {
  const copy = async (
    from: string,
    path: string,
  ): Promise<CheatsheetArtifactEvidence> => {
    await copyFile(from, join(input.destination, path));
    return {
      path,
      sha256: sha256Bytes(await readFile(join(input.destination, path))),
    };
  };
  const save = async (
    body: string,
    path: string,
  ): Promise<CheatsheetArtifactEvidence> => {
    await writeFile(join(input.destination, path), body, { flag: "wx" });
    return { path, sha256: sha256Bytes(Buffer.from(body, "utf8")) };
  };
  const artifacts = {
    source: await copy(input.source, "source.tex"),
    pdf: await copy(input.pdf, "built.pdf"),
    releasedPdf: await copy(input.releasedPdf, "released.pdf"),
    aux: await copy(input.aux, "build.aux"),
    log: await copy(input.log, "build.log"),
    pdfInfo: await save(input.pdfInfo, "pdfinfo.txt"),
    fontXml: await save(input.fontXml, "fonts.xml"),
    fullXml: await save(input.fullXml, "full.xml"),
    renders: await Promise.all(
      input.renders.map(async (path, index) => ({
        ...(await copy(path, `built-page-${index + 1}.png`)),
        page: index + 1,
      })),
    ),
    releasedRenders: await Promise.all(
      input.releasedRenders.map(async (path, index) => ({
        ...(await copy(path, `released-page-${index + 1}.png`)),
        page: index + 1,
      })),
    ),
  };
  const build = { id: cheatsheetBuildEvidenceId(artifacts), ...artifacts };
  await save(`${JSON.stringify(build, null, 2)}\n`, "build-identity.json");
  return build;
}
