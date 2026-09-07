import type {
  CheatsheetConstraints,
  CheatsheetCoverageItem,
  CheatsheetFitDecision,
  CheatsheetMeasurements,
  CheatsheetPriority,
} from "./types.js";

const priorityRank: Record<CheatsheetPriority, number> = {
  required: 0,
  high: 1,
  useful: 2,
  extension: 3,
};

function pageLimit(constraints: CheatsheetConstraints): number {
  return constraints.pages.exact ?? constraints.pages.maximum;
}

function included(item: CheatsheetCoverageItem): boolean {
  return item.disposition !== "excluded" && item.disposition !== "pending";
}

function optionalCompression(
  item: CheatsheetCoverageItem,
): "cross-reference" | "condense" | "remove" | undefined {
  if (item.priority === "extension") return "remove";
  if (item.disposition === "verbatim") return "condense";
  if (item.disposition === "condensed") return "cross-reference";
  return undefined;
}

export function planCheatsheetFit(input: {
  constraints: CheatsheetConstraints;
  coverage: CheatsheetCoverageItem[];
  measurements: CheatsheetMeasurements;
}): CheatsheetFitDecision {
  const requiredPending = input.coverage.filter(
    (item) => item.priority === "required" && !included(item),
  );
  const hardFailures = [
    ...(requiredPending.length === 0
      ? []
      : [`${requiredPending.length} required coverage items are pending.`]),
    ...(input.measurements.bodyPt < input.constraints.bodyPt.floor
      ? ["Body text is below the declared font floor."]
      : []),
    ...(input.measurements.overfullBoxes > 0
      ? [`${input.measurements.overfullBoxes} overfull boxes remain.`]
      : []),
    ...(input.measurements.missingGlyphs > 0
      ? [`${input.measurements.missingGlyphs} missing glyphs remain.`]
      : []),
    ...(input.measurements.unidentifiedContinuations > 0
      ? [
          `${input.measurements.unidentifiedContinuations} column continuations are unidentified.`,
        ]
      : []),
  ];
  if (hardFailures.length > 0) {
    return { kind: "blocked", reasons: hardFailures };
  }

  const limit = pageLimit(input.constraints);
  const overflow = input.measurements.pages > limit;
  if (overflow) {
    const candidate = input.coverage
      .filter((item) => included(item) && item.priority !== "required")
      .sort(
        (left, right) =>
          priorityRank[right.priority] - priorityRank[left.priority],
      )
      .map((item) => ({ item, operation: optionalCompression(item) }))
      .find(
        (
          candidate,
        ): candidate is {
          item: CheatsheetCoverageItem;
          operation: "cross-reference" | "condense" | "remove";
        } => candidate.operation !== undefined,
      );
    if (candidate !== undefined) {
      return {
        kind: "compress",
        itemId: candidate.item.id,
        operation: candidate.operation,
        reason:
          "The page limit is exceeded; change the lowest-priority included item first.",
      };
    }
    const requiredCandidate = input.coverage.find(
      (item) =>
        included(item) &&
        item.priority === "required" &&
        item.disposition === "verbatim",
    );
    if (requiredCandidate !== undefined) {
      return {
        kind: "compress",
        itemId: requiredCandidate.id,
        operation: "condense",
        reason:
          "The page limit is exceeded; shorten this required item while retaining its conditions and reasoning.",
      };
    }
    if (input.measurements.bodyPt > input.constraints.bodyPt.floor) {
      const nextBodyPt = Math.max(
        input.constraints.bodyPt.floor,
        Math.round((input.measurements.bodyPt - 0.1) * 1000) / 1000,
      );
      return {
        kind: "adjust-font",
        bodyPt: nextBodyPt,
        reason:
          "Content compression is exhausted; measure the next native body size before changing a hard constraint.",
      };
    }
    return {
      kind: "user-choice",
      reason: `Required content still exceeds the page limit at the measured ${input.measurements.bodyPt}pt floor; page count or content scope must change.`,
    };
  }

  const exactPages = input.constraints.pages.exact;
  const sparse =
    (exactPages !== undefined && input.measurements.pages < exactPages) ||
    input.measurements.finalColumnUnusedMm > 12 ||
    input.measurements.internalVoidBaselines > 3;
  if (sparse) {
    const candidate = input.coverage
      .filter((item) => item.disposition === "pending")
      .sort(
        (left, right) =>
          priorityRank[left.priority] - priorityRank[right.priority],
      )
      .at(0);
    if (candidate !== undefined) {
      return {
        kind: "expand",
        itemId: candidate.id,
        reason:
          "Use the highest-priority unused sourced item before adding original material.",
      };
    }
    if (exactPages !== undefined && input.measurements.pages < exactPages) {
      return {
        kind: "blocked",
        reasons: [
          `Release has ${input.measurements.pages} pages; exactly ${exactPages} are required and no sourced expansion remains.`,
        ],
      };
    }
    return {
      kind: "accept",
      reason:
        "No sourced candidate remains; recorded whitespace does not license filler.",
    };
  }

  return { kind: "accept", reason: "Coverage and measured constraints pass." };
}
