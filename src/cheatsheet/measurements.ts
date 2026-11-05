import { readFile } from "node:fs/promises";

import { sha256Bytes } from "../checksum.js";
import { type CheatsheetEvidence, loadCheatsheetEvidence } from "./evidence.js";
import { planCheatsheetFit } from "./fit.js";
import { parseCheatsheetMeasurementEvidence } from "./measurement-schema.js";
import { resolveModuleFile } from "./module-path.js";
import {
  dominantBodyPointSize,
  fontMeasurementTolerance,
} from "./pdf-inspection.js";
import type {
  CheatsheetArtifactEvidence,
  CheatsheetBuildEvidence,
  CheatsheetFitDecision,
  CheatsheetMeasurementEvidence,
  CheatsheetObservation,
} from "./types.js";

export function cheatsheetBuildEvidenceId(
  build: Omit<CheatsheetBuildEvidence, "id">,
): string {
  return sha256Bytes(
    Buffer.from(
      JSON.stringify({
        source: build.source.sha256,
        pdf: build.pdf.sha256,
        releasedPdf: build.releasedPdf.sha256,
        aux: build.aux.sha256,
        log: build.log.sha256,
        pdfInfo: build.pdfInfo.sha256,
        fontXml: build.fontXml.sha256,
        fullXml: build.fullXml.sha256,
        renders: build.renders.map(({ page, sha256 }) => ({ page, sha256 })),
        releasedRenders: build.releasedRenders.map(({ page, sha256 }) => ({
          page,
          sha256,
        })),
      }),
      "utf8",
    ),
  );
}

export function rebaseCheatsheetBuildEvidence(
  build: CheatsheetBuildEvidence,
  directory: string,
): CheatsheetBuildEvidence {
  const rebase = (
    artifact: CheatsheetArtifactEvidence,
  ): CheatsheetArtifactEvidence => ({
    ...artifact,
    path: `${directory}/${artifact.path}`,
  });
  return {
    id: build.id,
    source: rebase(build.source),
    pdf: rebase(build.pdf),
    releasedPdf: rebase(build.releasedPdf),
    aux: rebase(build.aux),
    log: rebase(build.log),
    pdfInfo: rebase(build.pdfInfo),
    fontXml: rebase(build.fontXml),
    fullXml: rebase(build.fullXml),
    renders: build.renders.map((render) => ({
      ...rebase(render),
      page: render.page,
    })),
    releasedRenders: build.releasedRenders.map((render) => ({
      ...rebase(render),
      page: render.page,
    })),
  };
}

function references(
  observation: CheatsheetObservation<unknown>,
): CheatsheetArtifactEvidence[] {
  return observation.kind === "unknown" ? [] : observation.evidence;
}

function assertReference(
  observation: CheatsheetObservation<unknown>,
  artifact: CheatsheetArtifactEvidence,
  description: string,
): void {
  if (
    observation.kind !== "unknown" &&
    !observation.evidence.some(
      ({ path, sha256 }) =>
        path === artifact.path && sha256 === artifact.sha256,
    )
  ) {
    throw new Error(`${description} must reference ${artifact.path}.`);
  }
}

function valueOrUnknown<T>(
  observation: CheatsheetObservation<T>,
  description: string,
  reasons: string[],
): T | undefined {
  if (observation.kind === "unknown") {
    reasons.push(`${description} is unknown: ${observation.reason}`);
    return undefined;
  }
  return observation.value;
}

function assertReleaseIdentity(
  measurement: CheatsheetMeasurementEvidence,
  release: CheatsheetEvidence,
): void {
  const identity = measurement.release;
  if (
    identity.artifactId !== release.manifest.artifact.id ||
    identity.manifestSha256 !==
      sha256Bytes(Buffer.from(release.manifestText, "utf8")) ||
    identity.texSha256 !== release.manifest.release.texSha256 ||
    identity.pdfSha256 !== release.manifest.release.pdfSha256
  ) {
    throw new Error(
      "Measurements are stale or describe a different manifest/release TeX/PDF.",
    );
  }
  if (
    measurement.build.id !== cheatsheetBuildEvidenceId(measurement.build) ||
    measurement.build.source.sha256 !== identity.texSha256 ||
    measurement.build.releasedPdf.sha256 !== identity.pdfSha256
  ) {
    throw new Error(
      "Build evidence identity is stale or does not describe this release.",
    );
  }
}

export async function fitCheatsheetRelease(input: {
  moduleRoot: string;
  manifestPath: string;
  measurementsPath: string;
}): Promise<
  CheatsheetFitDecision & {
    measurementEvidence: CheatsheetMeasurementEvidence;
    evidenceBoundary: string;
  }
> {
  const release = await loadCheatsheetEvidence(input);
  const measurement = parseCheatsheetMeasurementEvidence(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readFile(input.measurementsPath),
      ),
    ),
  );
  assertReleaseIdentity(measurement, release);
  const { build, metrics } = measurement;
  const artifacts = [
    build.source,
    build.pdf,
    build.releasedPdf,
    build.aux,
    build.log,
    build.pdfInfo,
    build.fontXml,
    build.fullXml,
    ...build.renders,
    ...build.releasedRenders,
    ...Object.values(metrics).flatMap(references),
    ...measurement.columns.flatMap((column) => [
      ...references(column.geometry),
      ...references(column.continuation),
    ]),
  ];
  const files = new Map<string, Buffer>();
  for (const artifact of artifacts) {
    if (!artifact.path.startsWith(`${release.manifest.artifact.support}/`)) {
      throw new Error(
        `Retained evidence ${artifact.path} must be beneath artifact.support.`,
      );
    }
    let bytes = files.get(artifact.path);
    if (bytes === undefined) {
      bytes = await readFile(
        await resolveModuleFile(input.moduleRoot, artifact.path),
      );
      files.set(artifact.path, bytes);
    }
    if (bytes.length === 0 || sha256Bytes(bytes) !== artifact.sha256) {
      throw new Error(
        `Retained evidence ${artifact.path} is empty, stale or has the wrong SHA-256.`,
      );
    }
  }
  const text = (artifact: CheatsheetArtifactEvidence): string => {
    const bytes = files.get(artifact.path);
    if (bytes === undefined)
      throw new Error(`Missing retained evidence ${artifact.path}.`);
    return bytes.toString("utf8");
  };
  const reportedPages = Number(
    /^Pages:\s+(\d+)$/mu.exec(text(build.pdfInfo))?.[1],
  );
  if (!Number.isInteger(reportedPages) || reportedPages < 1) {
    throw new Error("Retained pdfinfo must report a positive page count.");
  }
  for (const [index, render] of build.renders.entries()) {
    const released = build.releasedRenders[index];
    if (
      render.page !== index + 1 ||
      released?.page !== index + 1 ||
      render.sha256 !== released.sha256
    ) {
      throw new Error(
        "Fresh build and released renders must match for every sequential page.",
      );
    }
  }
  if (
    build.renders.length !== reportedPages ||
    build.releasedRenders.length !== reportedPages
  ) {
    throw new Error(
      "Retained renders do not cover exactly the compiled pages.",
    );
  }
  const expectedColumns = reportedPages * release.manifest.constraints.columns;
  if (measurement.columns.length !== expectedColumns) {
    throw new Error(
      "Measurements must describe every compiled page and column exactly once.",
    );
  }
  const reasons: string[] = [];
  const pages = valueOrUnknown(metrics.pages, "Page count", reasons);
  const bodyPt = valueOrUnknown(metrics.bodyPt, "Body size", reasons);
  const overfullBoxes = valueOrUnknown(
    metrics.overfullBoxes,
    "Overfull box count",
    reasons,
  );
  const missingGlyphs = valueOrUnknown(
    metrics.missingGlyphs,
    "Missing glyph count",
    reasons,
  );
  assertReference(metrics.pages, build.pdfInfo, "Page count");
  assertReference(metrics.bodyPt, build.fontXml, "Body size");
  assertReference(metrics.overfullBoxes, build.log, "Overfull box count");
  assertReference(metrics.missingGlyphs, build.log, "Missing glyph count");
  const log = text(build.log);
  const actualOverfull = [...log.matchAll(/Overfull \\[hv]box/gu)].length;
  const actualMissing = [...log.matchAll(/Missing character:/gu)].length;
  const actualBodyPt = dominantBodyPointSize(text(build.fontXml));
  if (
    (pages !== undefined && pages !== reportedPages) ||
    (bodyPt !== undefined &&
      (bodyPt <= 0 ||
        Math.abs(bodyPt - actualBodyPt) > fontMeasurementTolerance)) ||
    (overfullBoxes !== undefined && overfullBoxes !== actualOverfull) ||
    (missingGlyphs !== undefined && missingGlyphs !== actualMissing)
  ) {
    throw new Error(
      "Numeric observations contradict the retained compiled PDF/log evidence.",
    );
  }
  let unidentifiedContinuations = 0;
  let internalVoidBaselines = 0;
  let maximumColumnUnusedMm = 0;
  const columnIdentities = new Set<string>();
  const labels = new Set(
    [...text(build.aux).matchAll(/\\newlabel\{([^{}]+)\}/gu)].map(
      (match) => match[1],
    ),
  );
  for (const column of measurement.columns) {
    const identity = `page ${column.page}, column ${column.column}`;
    if (
      column.page > reportedPages ||
      column.column > release.manifest.constraints.columns ||
      columnIdentities.has(identity)
    ) {
      throw new Error(`Invalid or duplicate ${identity}.`);
    }
    columnIdentities.add(identity);
    const render = build.releasedRenders[column.page - 1];
    if (render === undefined)
      throw new Error(`Missing render for ${identity}.`);
    assertReference(column.geometry, render, `Geometry for ${identity}`);
    assertReference(
      column.continuation,
      render,
      `Continuation for ${identity}`,
    );
    const geometry = valueOrUnknown(
      column.geometry,
      `Geometry for ${identity}`,
      reasons,
    );
    const continuation = valueOrUnknown(
      column.continuation,
      `Continuation for ${identity}`,
      reasons,
    );
    if (geometry !== undefined) {
      internalVoidBaselines = Math.max(
        internalVoidBaselines,
        geometry.largestInternalGapBaselines,
      );
      maximumColumnUnusedMm = Math.max(
        maximumColumnUnusedMm,
        geometry.bottomMm - geometry.contentBottomMm,
      );
    }
    if (continuation?.status === "unidentified") unidentifiedContinuations += 1;
    if (continuation?.status === "identified") {
      assertReference(
        column.continuation,
        build.aux,
        `Identified continuation for ${identity}`,
      );
      if (!labels.has(continuation.label))
        throw new Error(
          `Continuation label ${continuation.label} is absent from compiled AUX.`,
        );
    }
  }
  const decision: CheatsheetFitDecision =
    pages === undefined ||
    bodyPt === undefined ||
    overfullBoxes === undefined ||
    missingGlyphs === undefined ||
    reasons.length > 0
      ? { kind: "blocked", reasons }
      : planCheatsheetFit({
          constraints: release.manifest.constraints,
          coverage: release.coverage,
          measurements: {
            pages,
            bodyPt,
            overfullBoxes,
            missingGlyphs,
            unidentifiedContinuations,
            internalVoidBaselines,
            finalColumnUnusedMm: maximumColumnUnusedMm,
          },
        });
  return {
    ...decision,
    measurementEvidence: measurement,
    evidenceBoundary:
      "Artifact identities and numeric corroboration checked; retained manual/measured layout observations keep their declared method and do not establish machine measurement or semantic proof.",
  };
}
