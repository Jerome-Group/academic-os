import { readFile } from "node:fs/promises";

import { sha256Bytes } from "../checksum.js";
import { readCheatsheetModuleText } from "./exact-text.js";
import { buildCheatsheetReleaseSource } from "./authoring.js";
import { parseCheatsheetCoverage } from "./coverage.js";
import { parseCheatsheetManifest } from "./manifest.js";
import { resolveModuleFile } from "./module-path.js";
import type { CheatsheetCoverageItem, CheatsheetManifest } from "./types.js";

export interface CheatsheetEvidence {
  manifest: CheatsheetManifest;
  coverage: CheatsheetCoverageItem[];
  manifestText: string;
  manifestBytes: Uint8Array;
  manifestSha256: string;
  coverageSha256: string;
  coverageBytes: Uint8Array;
  releaseBytes: Uint8Array;
  coverageText: string;
  releaseSource: string;
  releasedPdf: Uint8Array;
}

export async function loadCheatsheetEvidence(input: {
  moduleRoot: string;
  manifestPath: string;
}): Promise<CheatsheetEvidence> {
  const manifestRead = await readCheatsheetModuleText(
    input.moduleRoot,
    input.manifestPath,
  );
  const manifestText = manifestRead.text;
  const manifest = parseCheatsheetManifest(manifestText);
  const expectedManifestPath = `${manifest.artifact.support}/manifest.yaml`;
  if (input.manifestPath !== expectedManifestPath) {
    throw new Error(`Manifest path must be ${expectedManifestPath}.`);
  }
  const coverageRead = await readCheatsheetModuleText(
    input.moduleRoot,
    manifest.coverage,
  );
  const coverageText = coverageRead.text;
  const coverage = parseCheatsheetCoverage({
    csv: coverageText.replace(/^\uFEFF/u, ""),
    sourceIds: new Set(manifest.sources.map(({ id }) => id)),
  });
  for (const source of manifest.sources) {
    const bytes = await readFile(
      await resolveModuleFile(input.moduleRoot, source.path),
    );
    if (sha256Bytes(bytes) !== source.sha256) {
      throw new Error(`${source.path} no longer matches its declared SHA-256.`);
    }
  }
  const built = await buildCheatsheetReleaseSource({
    moduleRoot: input.moduleRoot,
    authoring: manifest.authoring,
  });
  const releaseRead = await readCheatsheetModuleText(
    input.moduleRoot,
    manifest.artifact.releaseTex,
  );
  const releaseSource = releaseRead.text;
  if (!Buffer.from(releaseRead.bytes).equals(built.bytes)) {
    throw new Error(
      "Release TeX is stale against its declared authoring authority.",
    );
  }
  validateCoverageCorrespondence(manifest, coverage, releaseSource);
  if (manifest.release.texSha256 !== built.sha256) {
    throw new Error("Release TeX digest does not describe the current source.");
  }
  const releasedPdf = await readFile(
    await resolveModuleFile(input.moduleRoot, manifest.artifact.releasePdf),
  );
  if (manifest.release.pdfSha256 !== sha256Bytes(releasedPdf)) {
    throw new Error("Release PDF digest does not describe the current PDF.");
  }
  return {
    manifest,
    coverage,
    manifestText,
    manifestBytes: manifestRead.bytes,
    manifestSha256: manifestRead.sha256,
    coverageSha256: coverageRead.sha256,
    coverageBytes: coverageRead.bytes,
    releaseBytes: releaseRead.bytes,
    coverageText,
    releaseSource,
    releasedPdf,
  };
}

export function validateCoverageCorrespondence(
  manifest: CheatsheetManifest,
  coverage: CheatsheetCoverageItem[],
  source: string,
): void {
  const labels = new Set(
    [
      ...source
        .replace(/(?<!\\)%[^\n]*/gu, "")
        .matchAll(/\\label\s*\{([^{}]+)\}/gu),
    ].map((match) => match[1]),
  );
  for (const source of manifest.sources) {
    if (
      !("requiredLocators" in source) ||
      source.requiredLocators === undefined
    )
      continue;
    const required = source.requiredLocators;
    if (
      !Array.isArray(required) ||
      !required.every(
        (locator): locator is string => typeof locator === "string",
      )
    )
      throw new Error(
        "Required source inventory must contain locator strings.",
      );
    for (const locator of required) {
      if (
        !coverage.some(
          (item) =>
            item.sourceId === source.id &&
            item.locator === locator &&
            item.priority === "required" &&
            ["verbatim", "condensed", "cross-reference"].includes(
              item.disposition,
            ),
        )
      ) {
        throw new Error(
          `Required source ${source.id} locator ${locator} is absent from included required coverage.`,
        );
      }
    }
  }
  for (const item of coverage) {
    const declared = manifest.sources.find(({ id }) => id === item.sourceId);
    if (!declared?.locators.includes(item.locator)) {
      throw new Error(
        `Coverage item ${item.id} locator is absent from its declared source locators.`,
      );
    }
    if (
      item.artifactLocator !== undefined &&
      !labels.has(item.artifactLocator)
    ) {
      throw new Error(
        `Coverage item ${item.id} names missing artifact label ${item.artifactLocator}.`,
      );
    }
  }
}

export function assertCheatsheetReleaseReady(
  evidence: CheatsheetEvidence,
): void {
  const pending = evidence.coverage.filter(
    (item) => item.priority === "required" && item.disposition === "pending",
  );
  if (evidence.coverage.length === 0 || pending.length > 0) {
    throw new Error(
      "Release requires nonempty coverage with every required item included.",
    );
  }
}
