export const cheatsheetAuthorities = [
  "owner-constraint",
  "issued-current",
  "official-solution",
  "module-derived",
  "registered-textbook",
  "historical",
  "original-example",
] as const;

export type CheatsheetAuthority = (typeof cheatsheetAuthorities)[number];
export type CheatsheetPriority = "required" | "high" | "useful" | "extension";
export type CoverageDisposition =
  | "verbatim"
  | "condensed"
  | "cross-reference"
  | "excluded"
  | "pending";

export interface CheatsheetSource {
  id: string;
  path: string;
  sha256: string;
  authority: CheatsheetAuthority;
  locators: string[];
  requiredLocators?: string[];
}

export type CheatsheetPageConstraint =
  | { exact: number; maximum?: never }
  | { maximum: number; exact?: never };

export type CheatsheetAuthoringAuthority =
  | {
      kind: "self-contained";
      path: string;
      sha256: string;
      construction?: import("./construction.js").CheatsheetConstructionProvenance;
    }
  | {
      kind: "fragments";
      fragments: Array<{ path: string; sha256: string }>;
    };

export interface CheatsheetConstraints {
  paper: "A4";
  pages: CheatsheetPageConstraint;
  color: "monochrome";
  columns: number;
  bodyPt: { preferred: number; floor: number };
  layout?: {
    marginsMm: { left: number; right: number; top: number; bottom: number };
    headerBottomMm: number;
    footerTopMm: number;
  };
}

export interface CheatsheetReview {
  status: "unreviewed" | "pending" | "passed";
  reviewedPdfSha256?: string;
}

export interface CheatsheetManifest {
  schemaVersion: 1;
  artifact: {
    id: string;
    title: string;
    scope: string;
    releaseTex: string;
    releasePdf: string;
    support: string;
  };
  authoring: CheatsheetAuthoringAuthority;
  constraints: CheatsheetConstraints;
  sources: CheatsheetSource[];
  coverage: string;
  release: {
    texSha256?: string;
    pdfSha256?: string;
    review: CheatsheetReview;
  };
}

export interface CheatsheetCoverageItem {
  id: string;
  sourceId: string;
  locator: string;
  topicId: string;
  priority: CheatsheetPriority;
  disposition: CoverageDisposition;
  artifactLocator?: string;
  note?: string;
}

export interface CheatsheetMeasurements {
  pages: number;
  bodyPt: number;
  overfullBoxes: number;
  missingGlyphs: number;
  unidentifiedContinuations: number;
  internalVoidBaselines: number;
  finalColumnUnusedMm: number;
}

export interface CheatsheetArtifactEvidence {
  path: string;
  sha256: string;
}

export interface CheatsheetBuildEvidence {
  id: string;
  source: CheatsheetArtifactEvidence;
  pdf: CheatsheetArtifactEvidence;
  releasedPdf: CheatsheetArtifactEvidence;
  aux: CheatsheetArtifactEvidence;
  log: CheatsheetArtifactEvidence;
  pdfInfo: CheatsheetArtifactEvidence;
  fontXml: CheatsheetArtifactEvidence;
  fullXml: CheatsheetArtifactEvidence;
  renders: Array<CheatsheetArtifactEvidence & { page: number }>;
  releasedRenders: Array<CheatsheetArtifactEvidence & { page: number }>;
}

export type CheatsheetObservation<T> =
  | { kind: "unknown"; reason: string }
  | {
      kind: "measured" | "manual";
      value: T;
      method: string;
      evidence: CheatsheetArtifactEvidence[];
    };

export interface CheatsheetColumnGeometry {
  topMm: number;
  bottomMm: number;
  contentTopMm: number;
  contentBottomMm: number;
  largestInternalGapBaselines: number;
}

export type CheatsheetColumnContinuation =
  | { status: "none" }
  | { status: "unidentified" }
  | { status: "identified"; label: string };

export interface CheatsheetMeasurementEvidence {
  schemaVersion: 2;
  release: {
    artifactId: string;
    manifestSha256: string;
    texSha256: string;
    pdfSha256: string;
  };
  build: CheatsheetBuildEvidence;
  metrics: {
    pages: CheatsheetObservation<number>;
    bodyPt: CheatsheetObservation<number>;
    overfullBoxes: CheatsheetObservation<number>;
    missingGlyphs: CheatsheetObservation<number>;
  };
  columns: Array<{
    page: number;
    column: number;
    geometry: CheatsheetObservation<CheatsheetColumnGeometry>;
    continuation: CheatsheetObservation<CheatsheetColumnContinuation>;
  }>;
}

export type CheatsheetFitDecision =
  | { kind: "accept"; reason: string }
  | {
      kind: "expand";
      itemId: string;
      reason: string;
    }
  | {
      kind: "compress";
      itemId: string;
      operation: "cross-reference" | "condense" | "remove";
      reason: string;
    }
  | {
      kind: "adjust-font";
      bodyPt: number;
      reason: string;
    }
  | { kind: "blocked"; reasons: string[] }
  | { kind: "user-choice"; reason: string };

export interface CheatsheetReleaseVerification {
  texSha256: string;
  pdfSha256: string;
  pageCount: number;
  fontsEmbedded: boolean;
  textMatches: boolean;
  rendersMatch: boolean;
  isolatedBuild: boolean;
  evidence: string[];
  buildEvidence?: CheatsheetBuildEvidence;
}
