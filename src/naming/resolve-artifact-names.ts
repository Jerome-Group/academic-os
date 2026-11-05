import { readStrictJson } from "../controls/strict-json.js";
import { artifactDiagnostics, problem } from "./artifact-metadata.js";
import { hasCollision, type Candidate } from "./collisions.js";
import { isSafeRelativePath } from "./destinations.js";
import { isCuratedFileName } from "./filename.js";
import { renderPath } from "./render-artifact-path.js";
import { validateNamingRequest } from "./schema-registry.js";
import type {
  NamingDiagnostic,
  NamingEntry,
  NamingPlan,
  NamingRequest,
} from "./types.js";
import {
  compareNames,
  namingRuntimeSupported,
  supportsNamingUnicode,
} from "./unicode.js";

export function planNamingJson(bytes: Uint8Array): NamingPlan {
  const read = readStrictJson(bytes, "naming-request");
  if (read.kind === "invalid")
    return {
      outcome: "refused",
      diagnostics: read.diagnostics.map(({ code, pointer, message }) => ({
        kind: "problem",
        code,
        pointer,
        message,
        evidence: [],
      })),
    };
  return resolveArtifactNames(read.value);
}

export function resolveArtifactNames(input: unknown): NamingPlan {
  if (!validateNamingRequest(input))
    return {
      outcome: "refused",
      diagnostics: (validateNamingRequest.errors ?? []).map((error) => ({
        kind: "problem",
        code: "invalid-naming-schema",
        pointer: error.instancePath,
        message: `${error.message ?? error.keyword}: ${JSON.stringify(error.params)}`,
        evidence: [],
      })),
    };
  const request = input;
  const global = requestDiagnostics(request);
  if (global.length > 0) return { outcome: "refused", diagnostics: global };
  const ordered = [...request.artifacts].sort((left, right) =>
    compareNames(left.id, right.id),
  );
  const items = ordered.map((artifact) => ({
    artifact,
    diagnostics: artifactDiagnostics(artifact),
  }));
  const unsupportedOccupied = request.occupiedPaths.filter(
    ({ path }) => !supportsNamingUnicode(path),
  );
  if (unsupportedOccupied.length > 0)
    for (const { artifact, diagnostics } of items)
      diagnostics.push(
        problem(
          "unsupported-unicode-occupied",
          artifact,
          "Occupied paths contain scalars outside Unicode 16.0.0. Resolve their collision semantics before planning names.",
        ),
      );
  const candidates = items.flatMap(({ artifact, diagnostics }): Candidate[] =>
    diagnostics.some((item) => item.kind !== "normalization")
      ? []
      : [
          {
            artifact,
            diagnostics,
            path: renderPath(request, artifact, false),
            qualified: false,
          },
        ],
  );
  for (;;) {
    const needingQualification = candidates.filter(
      (candidate) =>
        !candidate.qualified &&
        hasCollision(candidate, candidates, request.occupiedPaths) &&
        candidate.artifact.disambiguators.length > 0,
    );
    if (needingQualification.length === 0) break;
    for (const candidate of needingQualification) {
      candidate.qualified = true;
      candidate.path = renderPath(request, candidate.artifact, true);
    }
  }
  for (const candidate of candidates) {
    if (hasCollision(candidate, candidates, request.occupiedPaths))
      candidate.diagnostics.push(
        problem(
          "unresolved-collision",
          candidate.artifact,
          "The complete candidate and occupied sets still collide. Supply accepted semantic disambiguation or compare duplicates; no enumeration or hash suffix is assigned.",
        ),
      );
    if (
      Buffer.byteLength(filename(candidate.path), "utf8") >
      request.policy.maxComponentUtf8Bytes
    )
      candidate.diagnostics.push(
        problem(
          "component-too-long",
          candidate.artifact,
          "The proposed filename exceeds 240 UTF-8 bytes. Accept a meaningful shorter title; automatic truncation would lose identity.",
        ),
      );
    if (
      !isCuratedFileName(
        filename(candidate.path),
        request.module.moduleCode,
        request.policy.id,
      )
    )
      candidate.diagnostics.push(
        problem(
          "invalid-rendered-name",
          candidate.artifact,
          "Accepted tokens do not produce a governed curated filename.",
        ),
      );
  }
  const entries: NamingEntry[] = items.map(
    ({ artifact, diagnostics: issues }) => {
      const candidate = candidates.find(
        (item) => item.artifact.id === artifact.id,
      );
      if (
        candidate === undefined ||
        issues.some((issue) => issue.kind !== "normalization")
      )
        return { kind: "unresolved", artifact, diagnostics: issues };
      return {
        kind: "resolved",
        artifact,
        path: candidate.path,
        filename: filename(candidate.path),
        diagnostics: issues,
      };
    },
  );
  return {
    outcome: entries.some((entry) => entry.kind === "unresolved")
      ? "unresolved"
      : "resolved",
    schema: "urn:academic-os:naming-plan:1",
    admission: {
      kind: "not-admitted",
      requiredContractVersion: request.policy.requiredContractVersion,
      targetContractVersion: request.targetContractVersion,
      reason:
        request.targetContractVersion < request.policy.requiredContractVersion
          ? "target-contract-version"
          : "activation-pending",
    },
    policy: request.policy,
    module: request.module,
    entries,
    diagnostics: [],
  };
}

function requestDiagnostics(request: NamingRequest): NamingDiagnostic[] {
  const diagnostics: NamingDiagnostic[] = [];
  if (!namingRuntimeSupported())
    diagnostics.push({
      kind: "problem",
      code: "unsupported-unicode-runtime",
      pointer: "/policy",
      message:
        "Naming requires a runtime implementing Unicode 16 or later normalization stability.",
      evidence: [],
    });
  if (
    new Set(request.artifacts.map(({ id }) => id)).size !==
    request.artifacts.length
  )
    diagnostics.push({
      kind: "problem",
      code: "duplicate-artifact-id",
      pointer: "/artifacts",
      message:
        "Each artifact identity must occur exactly once in the complete candidate set.",
      evidence: [],
    });
  if (request.occupiedPaths.some(({ path }) => !isSafeRelativePath(path)))
    diagnostics.push({
      kind: "problem",
      code: "unsafe-occupied-path",
      pointer: "/occupiedPaths",
      message:
        "Occupied paths must be safe module-relative paths with no escapes or hidden separators.",
      evidence: [],
    });
  return diagnostics;
}

function filename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
