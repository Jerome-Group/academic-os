import { digest, sha256 } from "./canonical-json.js";
import type { Artifact, Evidence } from "./generated/module-data-1.js";
import type {
  AssessmentReviewV2,
  Fragment,
} from "./generated/module-verification-1.js";
import type { SupportedModuleData } from "./generated/supported-controls.js";
import type { CanonicalControl, ControlObservation } from "./types.js";

export function validateVerificationFacts(input: {
  value: Extract<SupportedModuleData, { schemaVersion: 2 }>;
  controls: readonly CanonicalControl[];
  observations: readonly ControlObservation[];
  problem: (pointer: string, message: string) => void;
}): void {
  const { value, controls, observations, problem } = input;
  const evidence = new Map<string, Evidence>();
  const artifacts = new Map<string, Artifact>();
  for (const control of controls) {
    if (control.role === "module-identity" || !("role" in control.value))
      continue;
    if (control.value.role === "evidence")
      for (const entry of control.value.entries) evidence.set(entry.id, entry);
    if (control.value.role === "artifacts")
      for (const entry of control.value.artifacts)
        artifacts.set(entry.id, entry);
  }
  function sourceBinding(
    reference: string,
    binding: Fragment["original"],
    pointer: string,
  ): Evidence | undefined {
    const source = evidence.get(reference);
    if (
      source?.content.kind === "known" &&
      source.content.value !== binding.byteSha256
    )
      problem(
        pointer,
        "Source binding differs from the canonical evidence hash.",
      );
    if (
      source?.locator.kind === "retained-original" &&
      (source.locator.byteLength !== binding.byteLength ||
        source.locator.byteSha256 !== binding.byteSha256)
    )
      problem(
        pointer,
        "Source binding differs from its exact retained-original locator.",
      );
    return source;
  }
  function fragment(fragment: Fragment, pointer: string): void {
    const source = sourceBinding(
      fragment.source.id,
      fragment.original,
      pointer,
    );
    if (
      fragment.location.length > fragment.extraction.byteLength ||
      fragment.location.start >
        fragment.extraction.byteLength - fragment.location.length
    )
      problem(
        pointer,
        "Fragment range exceeds the exact extraction byte length.",
      );
    if (
      fragment.location.length === 0 &&
      fragment.fragmentSha256 !== sha256(new Uint8Array())
    )
      problem(
        pointer,
        "Empty fragment hash differs from SHA-256 of empty bytes.",
      );
    if (
      fragment.location.kind === "utf8-bytes" &&
      fragment.location.start === 0 &&
      fragment.location.length === fragment.extraction.byteLength &&
      fragment.fragmentSha256 !== fragment.extraction.byteSha256
    )
      problem(
        pointer,
        "Whole-extraction fragment hash differs from the exact extraction binding.",
      );
    if (fragment.extractor.recipe !== "utf8-identity/1") return;
    if (
      digest(fragment.original) !== digest(fragment.extraction) ||
      fragment.location.kind !== "utf8-bytes"
    ) {
      problem(
        pointer,
        "UTF-8 identity extraction must retain its exact original binding and byte coordinate system.",
      );
      return;
    }
    if (
      !source ||
      (source.locator.kind !== "retained-original" &&
        source.locator.kind !== "module-file")
    )
      return;
    const path = source.locator.path;
    const file = observations.find((file) => file.path === path);
    if (file?.kind !== "file") return;
    if (
      file.bytes.byteLength !== fragment.original.byteLength ||
      sha256(file.bytes) !== fragment.original.byteSha256 ||
      sha256(
        file.bytes.subarray(
          fragment.location.start,
          fragment.location.start + fragment.location.length,
        ),
      ) !== fragment.fragmentSha256
    )
      problem(
        pointer,
        "Observed source bytes or exact fragment hash differ from the declared binding.",
      );
  }
  function submission(review: AssessmentReviewV2, pointer: string): void {
    const artifact = artifacts.get(review.submission.reference.id);
    if (artifact?.representation.kind === "file") {
      const data = artifact.representation.entries[0].data;
      if (
        data.kind === "known" &&
        data.value !== review.submission.bytes.byteSha256
      )
        problem(
          pointer,
          "Assessment attempt differs from the canonical artifact data hash.",
        );
    }
    sourceBinding(
      review.question.reference.id,
      review.question.bytes,
      `${pointer}/question`,
    );
  }
  if (value.role === "verification") {
    for (const [index, check] of value.checks.entries())
      if (check.kind === "mathematics")
        fragment(check.claim, `/checks/${index}/claim`);
    return;
  }
  for (const [index, review] of value.assessments.entries()) {
    if (!("recordVersion" in review)) continue;
    const pointer = `/assessments/${index}`;
    submission(review, pointer);
    for (const [index, criterion] of review.criteria.entries()) {
      const position = `${pointer}/criteria/${index}`;
      if (criterion.applicability !== "applies") {
        fragment(criterion.fragment, position);
        continue;
      }
      if (criterion.basis.kind === "rubric") {
        fragment(criterion.basis.fragment, `${position}/basis`);
      } else
        for (const source of criterion.basis.sources)
          fragment(source, `${position}/basis`);
      if (criterion.allocation.kind === "numeric")
        fragment(
          criterion.allocation.allocationSource,
          `${position}/allocation`,
        );
      if (criterion.allocation.kind === "qualitative")
        for (const band of criterion.allocation.bands)
          fragment(band.descriptor, `${position}/allocation`);
    }
    if (review.aggregate.kind === "numeric-estimate")
      fragment(review.aggregate.aggregationSource, `${pointer}/aggregate`);
  }
}
