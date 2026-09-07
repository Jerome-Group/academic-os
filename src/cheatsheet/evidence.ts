import { readFile } from "node:fs/promises";

import { sha256Bytes } from "../checksum.js";
import { buildCheatsheetReleaseSource } from "./authoring.js";
import { parseCheatsheetCoverage } from "./coverage.js";
import { parseCheatsheetManifest } from "./manifest.js";
import { resolveModuleFile } from "./module-path.js";
import type { CheatsheetCoverageItem, CheatsheetManifest } from "./types.js";

export interface CheatsheetEvidence {
  manifest: CheatsheetManifest;
  coverage: CheatsheetCoverageItem[];
  manifestText: string;
  coverageText: string;
  releaseSource: string;
  releasedPdf: Uint8Array;
}

export async function loadCheatsheetEvidence(input: {
  moduleRoot: string;
  manifestPath: string;
}): Promise<CheatsheetEvidence> {
  const manifestText = await readFile(
    resolveModuleFile(input.moduleRoot, input.manifestPath),
    "utf8",
  );
  const manifest = parseCheatsheetManifest(manifestText);
  const expectedManifestPath = `${manifest.artifact.support}/manifest.yaml`;
  if (input.manifestPath !== expectedManifestPath) {
    throw new Error(`Manifest path must be ${expectedManifestPath}.`);
  }
  const coverageText = await readFile(
    resolveModuleFile(input.moduleRoot, manifest.coverage),
    "utf8",
  );
  const coverage = parseCheatsheetCoverage({
    csv: coverageText,
    sourceIds: new Set(manifest.sources.map(({ id }) => id)),
  });
  for (const source of manifest.sources) {
    const bytes = await readFile(
      resolveModuleFile(input.moduleRoot, source.path),
    );
    if (sha256Bytes(bytes) !== source.sha256) {
      throw new Error(`${source.path} no longer matches its declared SHA-256.`);
    }
  }
  const built = await buildCheatsheetReleaseSource({
    moduleRoot: input.moduleRoot,
    authoring: manifest.authoring,
  });
  const releaseSource = await readFile(
    resolveModuleFile(input.moduleRoot, manifest.artifact.releaseTex),
    "utf8",
  );
  if (releaseSource !== built.source) {
    throw new Error(
      "Release TeX is stale against its declared authoring authority.",
    );
  }
  if (manifest.release.texSha256 !== built.sha256) {
    throw new Error("Release TeX digest does not describe the current source.");
  }
  const releasedPdf = await readFile(
    resolveModuleFile(input.moduleRoot, manifest.artifact.releasePdf),
  );
  if (manifest.release.pdfSha256 !== sha256Bytes(releasedPdf)) {
    throw new Error("Release PDF digest does not describe the current PDF.");
  }
  return {
    manifest,
    coverage,
    manifestText,
    coverageText,
    releaseSource,
    releasedPdf,
  };
}
