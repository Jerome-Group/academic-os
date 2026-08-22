import { sha256 } from "../checksum.js";
import { firstDifference } from "../conformance/first-difference.js";
import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
  seedTemplatePath,
  type PinnedDocumentBodies,
  type PinnedDocumentName,
} from "../contract/pinned-documents.js";
import type {
  ObservedModuleCopies,
  PinnedCopyRewrite,
  PinnedCopyState,
  PinnedRewritePlan,
} from "./types.js";

// What every module of a cohort owes each pinned document, decided from bytes already read. Pure,
// so the preview a run shows and the rewrites it would make are the same object.
export function planPinnedDocumentRewrite(input: {
  modules: readonly ObservedModuleCopies[];
  pinnedDocuments: PinnedDocumentBodies;
}): PinnedRewritePlan {
  const counts: Record<PinnedCopyState, number> = {
    current: 0,
    stale: 0,
    missing: 0,
  };
  const rewrites: PinnedCopyRewrite[] = [];
  for (const observed of [...input.modules].sort((left, right) =>
    left.module.localeCompare(right.module),
  )) {
    for (const document of pinnedDocumentNames) {
      const expected = interpolateModuleCode(
        input.pinnedDocuments[document],
        observed.module,
      );
      const copy = observed.controls[document];
      const state = copyState(copy, expected);
      counts[state] += 1;
      if (state === "current") continue;
      rewrites.push({
        module: observed.module,
        semester: observed.semester,
        document,
        path: pinnedDocumentPaths[document],
        state,
        evidence: evidenceFor(document, copy, expected),
        observedSha256: copy === undefined ? null : sha256(copy),
        expected,
      });
    }
  }
  return { outcome: planOutcome(counts), counts, rewrites };
}

function copyState(
  copy: string | undefined,
  expected: string,
): PinnedCopyState {
  if (copy === undefined) return "missing";
  return copy === expected ? "current" : "stale";
}

function evidenceFor(
  document: PinnedDocumentName,
  copy: string | undefined,
  expected: string,
): string {
  const path = pinnedDocumentPaths[document];
  return copy === undefined
    ? `No readable copy exists at ${path}.`
    : `Pinned copy differs from seed-templates/${seedTemplatePath(document)} at ${firstDifference(copy, expected)}.`;
}

// A missing copy outranks a stale one: the module has no instruction at all where it should have
// this repository's, which is the worse of the two states a rewrite resolves.
function planOutcome(counts: Record<PinnedCopyState, number>): PinnedCopyState {
  if (counts.missing > 0) return "missing";
  return counts.stale > 0 ? "stale" : "current";
}
