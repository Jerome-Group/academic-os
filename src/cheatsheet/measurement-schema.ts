import type {
  CheatsheetArtifactEvidence,
  CheatsheetBuildEvidence,
  CheatsheetColumnContinuation,
  CheatsheetColumnGeometry,
  CheatsheetMeasurementEvidence,
  CheatsheetObservation,
} from "./types.js";

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isMapping(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a nonempty string.`);
  }
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite nonnegative number.`);
  }
  return value;
}

function positiveIntegerAt(value: unknown, path: string): number {
  const number = numberAt(value, path);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return number;
}

function sha256At(value: unknown, path: string): string {
  const digest = stringAt(value, path);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function artifactAt(value: unknown, path: string): CheatsheetArtifactEvidence {
  const object = objectAt(value, path);
  const candidate = stringAt(object.path, `${path}.path`);
  if (
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    candidate.split("/").some((part) => ["", ".", ".."].includes(part))
  ) {
    throw new Error(`${path}.path must be a normalized module-relative path.`);
  }
  return {
    path: candidate,
    sha256: sha256At(object.sha256, `${path}.sha256`),
  };
}

function artifactsAt(
  value: unknown,
  path: string,
): CheatsheetArtifactEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain retained evidence.`);
  }
  return value.map((entry: unknown, index) =>
    artifactAt(entry, `${path}[${index}]`),
  );
}

function rendersAt(
  value: unknown,
  path: string,
): CheatsheetBuildEvidence["renders"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain one render per page.`);
  }
  return value.map((entry: unknown, index) => ({
    ...artifactAt(entry, `${path}[${index}]`),
    page: positiveIntegerAt(
      objectAt(entry, path).page,
      `${path}[${index}].page`,
    ),
  }));
}

function buildAt(value: unknown): CheatsheetBuildEvidence {
  const build = objectAt(value, "measurements.build");
  return {
    id: sha256At(build.id, "measurements.build.id"),
    source: artifactAt(build.source, "measurements.build.source"),
    pdf: artifactAt(build.pdf, "measurements.build.pdf"),
    releasedPdf: artifactAt(
      build.releasedPdf,
      "measurements.build.releasedPdf",
    ),
    aux: artifactAt(build.aux, "measurements.build.aux"),
    log: artifactAt(build.log, "measurements.build.log"),
    pdfInfo: artifactAt(build.pdfInfo, "measurements.build.pdfInfo"),
    fontXml: artifactAt(build.fontXml, "measurements.build.fontXml"),
    fullXml: artifactAt(build.fullXml, "measurements.build.fullXml"),
    renders: rendersAt(build.renders, "measurements.build.renders"),
    releasedRenders: rendersAt(
      build.releasedRenders,
      "measurements.build.releasedRenders",
    ),
  };
}

function observationAt<T>(
  value: unknown,
  path: string,
  parseValue: (value: unknown, path: string) => T,
): CheatsheetObservation<T> {
  const object = objectAt(value, path);
  if (object.kind === "unknown") {
    if ("value" in object || "method" in object || "evidence" in object) {
      throw new Error(
        `${path}: unknown observations cannot carry a value or claim evidence.`,
      );
    }
    return {
      kind: "unknown",
      reason: stringAt(object.reason, `${path}.reason`),
    };
  }
  if (object.kind !== "measured" && object.kind !== "manual") {
    throw new Error(`${path}.kind must be measured, manual or unknown.`);
  }
  return {
    kind: object.kind,
    value: parseValue(object.value, `${path}.value`),
    method: stringAt(object.method, `${path}.method`),
    evidence: artifactsAt(object.evidence, `${path}.evidence`),
  };
}

function geometryAt(value: unknown, path: string): CheatsheetColumnGeometry {
  const object = objectAt(value, path);
  const geometry = {
    topMm: numberAt(object.topMm, `${path}.topMm`),
    bottomMm: numberAt(object.bottomMm, `${path}.bottomMm`),
    contentTopMm: numberAt(object.contentTopMm, `${path}.contentTopMm`),
    contentBottomMm: numberAt(
      object.contentBottomMm,
      `${path}.contentBottomMm`,
    ),
    largestInternalGapBaselines: numberAt(
      object.largestInternalGapBaselines,
      `${path}.largestInternalGapBaselines`,
    ),
  };
  if (
    geometry.bottomMm <= geometry.topMm ||
    geometry.bottomMm > 297 ||
    geometry.contentTopMm < geometry.topMm ||
    geometry.contentBottomMm < geometry.contentTopMm ||
    geometry.contentBottomMm > geometry.bottomMm
  ) {
    throw new Error(
      `${path} must describe ordered content bounds within an A4 column.`,
    );
  }
  return geometry;
}

function continuationAt(
  value: unknown,
  path: string,
): CheatsheetColumnContinuation {
  const object = objectAt(value, path);
  if (object.status === "none" || object.status === "unidentified") {
    return { status: object.status };
  }
  if (object.status === "identified") {
    return {
      status: "identified",
      label: stringAt(object.label, `${path}.label`),
    };
  }
  throw new Error(`${path}.status must be none, identified or unidentified.`);
}

export function parseCheatsheetMeasurementEvidence(
  value: unknown,
): CheatsheetMeasurementEvidence {
  const root = objectAt(value, "measurements");
  if (root.schemaVersion !== 2) {
    throw new Error(
      "measurements.schemaVersion must be 2; unsupported numeric-only measurements cannot establish release fitness.",
    );
  }
  const release = objectAt(root.release, "measurements.release");
  const metrics = objectAt(root.metrics, "measurements.metrics");
  if (!Array.isArray(root.columns) || root.columns.length === 0) {
    throw new Error(
      "measurements.columns must describe every page and column.",
    );
  }
  return {
    schemaVersion: 2,
    release: {
      artifactId: stringAt(
        release.artifactId,
        "measurements.release.artifactId",
      ),
      manifestSha256: sha256At(
        release.manifestSha256,
        "measurements.release.manifestSha256",
      ),
      texSha256: sha256At(release.texSha256, "measurements.release.texSha256"),
      pdfSha256: sha256At(release.pdfSha256, "measurements.release.pdfSha256"),
    },
    build: buildAt(root.build),
    metrics: {
      pages: observationAt(
        metrics.pages,
        "measurements.metrics.pages",
        positiveIntegerAt,
      ),
      bodyPt: observationAt(
        metrics.bodyPt,
        "measurements.metrics.bodyPt",
        numberAt,
      ),
      overfullBoxes: observationAt(
        metrics.overfullBoxes,
        "measurements.metrics.overfullBoxes",
        numberAt,
      ),
      missingGlyphs: observationAt(
        metrics.missingGlyphs,
        "measurements.metrics.missingGlyphs",
        numberAt,
      ),
    },
    columns: root.columns.map((entry: unknown, index) => {
      const path = `measurements.columns[${index}]`;
      const column = objectAt(entry, path);
      return {
        page: positiveIntegerAt(column.page, `${path}.page`),
        column: positiveIntegerAt(column.column, `${path}.column`),
        geometry: observationAt(
          column.geometry,
          `${path}.geometry`,
          geometryAt,
        ),
        continuation: observationAt(
          column.continuation,
          `${path}.continuation`,
          continuationAt,
        ),
      };
    }),
  };
}

export const cheatsheetMeasurementSchema = {
  format: "JSON",
  schemaVersion: 2,
  release: ["artifactId", "manifestSha256", "texSha256", "pdfSha256"],
  build: {
    id: "SHA-256 of canonical build evidence digests; paths excluded",
    artifacts: [
      "source",
      "pdf",
      "releasedPdf",
      "aux",
      "log",
      "pdfInfo",
      "fontXml",
      "fullXml",
    ],
    renders:
      "renders and releasedRenders: [{page, path, sha256}], sequential page order",
  },
  observation: {
    known: "{kind: measured|manual, value, method, evidence: [{path, sha256}]}",
    unknown: "{kind: unknown, reason}; no value; blocks fitting",
  },
  metrics: ["pages", "bodyPt", "overfullBoxes", "missingGlyphs"],
  columns: {
    identity: ["page", "column"],
    geometryValue: [
      "topMm",
      "bottomMm",
      "contentTopMm",
      "contentBottomMm",
      "largestInternalGapBaselines",
    ],
    continuationValue:
      "{status: none|unidentified} or {status: identified, label}",
    evidence:
      "Geometry and continuation observations reference this page's retained released render; identified continuations also reference compiled AUX",
  },
  evidence:
    "Normalized module-relative paths beneath artifact.support; every file and SHA-256 checked. Numeric metrics corroborated by retained pdfinfo, font XML and log. Manual layout observations remain manual, not machine proof.",
} as const;
