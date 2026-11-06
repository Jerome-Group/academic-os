import { digest } from "./canonical-json.js";
import type {
  AssessmentReviewV2,
  Fragment,
} from "./generated/module-verification-1.js";

export function assessmentProblems(review: AssessmentReviewV2): string[] {
  const problems: string[] = [];
  const ids = review.criteria.map((criterion) => criterion.id);
  if (new Set(ids).size !== ids.length)
    problems.push("Criterion IDs must be unique within one assessment.");
  for (const criterion of review.criteria) {
    if (criterion.applicability !== "applies") continue;
    if (review.kind === "rubric-linked" && criterion.basis.kind !== "rubric")
      problems.push(
        `${criterion.id}: inferred criteria require a provisional assessment.`,
      );
    const allocation = criterion.allocation;
    if (allocation.kind === "numeric") {
      if (
        allocation.estimate.kind === "known" &&
        compareDecimals(allocation.estimate.value, allocation.maximum) > 0
      )
        problems.push(
          `${criterion.id}: estimated points exceed the explicit maximum.`,
        );
      const sources =
        criterion.basis.kind === "rubric"
          ? [criterion.basis.fragment]
          : criterion.basis.sources;
      if (
        allocation.allocationSource.source.id !==
          review.question.reference.id &&
        !sources.some(
          (source) =>
            source.source.id === allocation.allocationSource.source.id,
        )
      )
        problems.push(
          `${criterion.id}: numeric allocation must bind a declared criterion or question source.`,
        );
    }
    if (allocation.kind === "qualitative") {
      const bands = allocation.bands.map((band) => band.id);
      if (
        new Set(bands).size !== bands.length ||
        (allocation.estimate.kind === "band" &&
          !bands.includes(allocation.estimate.id))
      )
        problems.push(
          `${criterion.id}: qualitative bands must be unique and the estimate must select a declared band.`,
        );
    }
  }
  const aggregate = review.aggregate;
  if (aggregate.kind !== "numeric-estimate") return problems;
  const selected = review.criteria.filter((criterion) =>
    aggregate.criterionIds.includes(criterion.id),
  );
  if (
    new Set(aggregate.criterionIds).size !== aggregate.criterionIds.length ||
    selected.length !== aggregate.criterionIds.length
  )
    problems.push(
      "Numeric aggregation must select distinct existing criteria.",
    );
  const numeric = selected.flatMap((criterion) =>
    criterion.applicability === "applies" &&
    criterion.allocation.kind === "numeric" &&
    criterion.allocation.estimate.kind === "known"
      ? [criterion.allocation]
      : [],
  );
  if (numeric.length !== selected.length || selected.length === 0)
    problems.push(
      "Only applicable numeric criteria with complete estimates can be aggregated. Excluded, unresolved, qualitative and unknown criteria contribute nothing.",
    );
  const locations = numeric.map((allocation) => allocation.allocationSource);
  if (
    locations.some((fragment, index) =>
      locations
        .slice(0, index)
        .some((other) => overlappingFragments(fragment, other)),
    )
  )
    problems.push(
      "Numeric aggregation cannot double-count overlapping source allocations.",
    );
  if (
    numeric.length === selected.length &&
    (compareDecimalSum(
      numeric.map((allocation) => allocation.maximum),
      aggregate.maximum,
    ) !== 0 ||
      compareDecimalSum(
        numeric.flatMap((allocation) =>
          allocation.estimate.kind === "known"
            ? [allocation.estimate.value]
            : [],
        ),
        aggregate.value,
      ) !== 0)
  )
    problems.push(
      "Aggregate value and maximum must equal the exact selected numeric sums.",
    );
  if (compareDecimals(aggregate.value, aggregate.maximum) > 0)
    problems.push("Aggregate estimate exceeds its maximum.");
  return problems;
}

function overlappingFragments(left: Fragment, right: Fragment): boolean {
  return (
    left.source.id === right.source.id &&
    digest(left.extraction) === digest(right.extraction) &&
    left.location.kind === right.location.kind &&
    (left.location.kind !== "page-text" ||
      right.location.kind !== "page-text" ||
      left.location.page === right.location.page) &&
    left.location.start < right.location.start + right.location.length &&
    right.location.start < left.location.start + left.location.length
  );
}

function scaled(value: string, scale: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

export function compareDecimals(left: string, right: string): number {
  return compareDecimalSum([left], right);
}

function compareDecimalSum(values: string[], expected: string): number {
  const scale = Math.max(
    ...[...values, expected].map((value) => value.split(".")[1]?.length ?? 0),
  );
  const sum = values.reduce((total, value) => total + scaled(value, scale), 0n);
  const right = scaled(expected, scale);
  return sum < right ? -1 : sum > right ? 1 : 0;
}
