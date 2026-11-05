import type {
  NamingArtifact,
  NamingPolicy,
  NamingRequest,
} from "../../src/naming/index.js";

export const policy: NamingPolicy = {
  $schema: "urn:academic-os:naming-policy:1",
  schemaVersion: 1,
  id: "module-artifact-naming/1",
  normalization: "NFC",
  collisionComparison: "nfkc-full-fold-nfkc-unicode-16.0.0/1",
  counterMinimumWidth: 2,
  requiredContractVersion: 8,
  maxComponentUtf8Bytes: 240,
  ambiguity: "unresolved-no-output",
};

export function artifact(
  overrides: Partial<NamingArtifact> = {},
): NamingArtifact {
  return {
    id: "artifact:one",
    source: {
      id: "source:issued-001",
      legacyIdentity: null,
      title: "Synthetic source title",
      filename: "Synthetic_Source_1.pdf",
      evidence: ["evidence:source"],
    },
    acceptedBy: ["evidence:accepted"],
    destination: {
      category: "lecture",
      directory: "10 Learning Materials/10 Lecture Materials",
      evidence: ["evidence:placement"],
    },
    titleTokens: ["Synthetic"],
    sourceTokens: [],
    sequence: {
      kind: "source",
      token: "1",
      format: "minimum-two",
      authority: "source-filename",
      evidence: ["evidence:sequence"],
    },
    issued: null,
    academicYear: null,
    traits: {
      content: "other",
      annotation: "clean",
      grading: "ungraded",
      evidence: ["evidence:traits"],
    },
    representation: {
      kind: "file",
      role: "native",
      extension: "pdf",
      evidence: ["evidence:native"],
    },
    qualifiers: [],
    disambiguators: [],
    ...overrides,
  };
}

export function request(artifacts = [artifact()]): NamingRequest {
  return {
    $schema: "urn:academic-os:naming-request:1",
    schemaVersion: 1,
    policy,
    module: {
      $schema: "urn:academic-os:module-identity:1",
      schemaVersion: 1,
      module: "module:synthetic",
      moduleCode: "MH2100",
      title: "Synthetic Module",
    },
    artifacts,
    occupiedPaths: [],
    targetContractVersion: 7,
  };
}
