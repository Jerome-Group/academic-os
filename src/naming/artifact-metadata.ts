import { isArtifactDestination } from "./destinations.js";
import {
  isAcademicYear,
  isCalendarDay,
  isNumericToken,
  isSourceToken,
  isTitleToken,
} from "./filename.js";
import type { NamingArtifact, NamingDiagnostic } from "./types.js";
import { collisionKey, supportsNamingUnicode } from "./unicode.js";

export function artifactDiagnostics(
  artifact: NamingArtifact,
): NamingDiagnostic[] {
  const diagnostics: NamingDiagnostic[] = [];
  if (
    artifact.destination.directory
      .split("/")
      .some(
        (component) =>
          Buffer.byteLength(component.normalize("NFC"), "utf8") > 240,
      )
  )
    diagnostics.push(
      problem(
        "component-too-long",
        artifact,
        "An accepted directory component exceeds 240 UTF-8 bytes.",
      ),
    );
  if (!isArtifactDestination(artifact))
    diagnostics.push(
      problem(
        "invalid-category-destination",
        artifact,
        "The accepted destination must use the category's existing contract home, required workspace child and nesting rules. Unclassified and Miscellaneous are unresolved placement.",
      ),
    );
  if (artifact.sequence.kind === "unknown")
    diagnostics.push(
      problem("unknown-sequence", artifact, artifact.sequence.reason),
    );
  if (artifact.issued !== null && !isCalendarDay(artifact.issued.day))
    diagnostics.push(
      problem(
        "invalid-calendar-day",
        artifact,
        "Issued date must be a real Gregorian calendar day, not just a date-shaped token.",
      ),
    );
  if (
    artifact.academicYear !== null &&
    !isAcademicYear(artifact.academicYear.value)
  )
    diagnostics.push(
      problem(
        "invalid-academic-year",
        artifact,
        "Academic year must be a nonzero four-digit year or adjacent year range.",
      ),
    );
  if (!artifact.titleTokens.every(isTitleToken))
    diagnostics.push(
      problem(
        "invalid-title-token",
        artifact,
        "Title tokens retain accepted Title Case, uppercase initialisms and internal capitals. The planner does not guess capitalization.",
      ),
    );
  if (
    ![
      ...artifact.sourceTokens,
      ...artifact.disambiguators.flatMap(({ tokens }) => tokens),
    ].every(isSourceToken)
  )
    diagnostics.push(
      problem(
        "invalid-source-token",
        artifact,
        "Source identifiers and semantic disambiguators must retain portable Unicode letter, mark, number, apostrophe and hyphen tokens without introducing path syntax.",
      ),
    );
  const reserved = new Set([
    "clean",
    "annotated",
    "graded",
    "ungraded",
    "questions",
    "solutions",
    "final",
  ]);
  for (const qualifier of artifact.qualifiers)
    if (
      !qualifier.tokens.every(
        (token) =>
          (isTitleToken(token) || isNumericToken(token)) &&
          !reserved.has(collisionKey(token)),
      )
    )
      diagnostics.push(
        problem(
          "contradictory-qualifier",
          artifact,
          "Content, annotation and grading belong in independent traits. Final is not a completion suffix. Other qualifiers retain accepted title or numeric tokens.",
        ),
      );
  for (const item of artifact.disambiguators) {
    if (
      item.kind === "year" &&
      (item.tokens.length !== 1 || !isAcademicYear(item.tokens[0]))
    )
      diagnostics.push(
        problem(
          "invalid-disambiguator-year",
          artifact,
          "A year discriminator must be a real year or adjacent academic-year range.",
        ),
      );
    if (
      item.kind === "date" &&
      (item.tokens.length !== 1 || !isCalendarDay(item.tokens[0]))
    )
      diagnostics.push(
        problem(
          "invalid-disambiguator-date",
          artifact,
          "A date discriminator must be a real calendar day.",
        ),
      );
  }
  const proposed = [
    artifact.destination.directory,
    ...artifact.titleTokens,
    ...artifact.sourceTokens,
    ...artifact.qualifiers.flatMap(({ tokens }) => tokens),
    ...artifact.disambiguators.flatMap(({ tokens }) => tokens),
  ];
  if (proposed.some((value) => !supportsNamingUnicode(value)))
    diagnostics.push(
      problem(
        "unsupported-unicode",
        artifact,
        "Proposed naming metadata contains scalars outside the pinned Unicode 16.0.0 assigned set.",
      ),
    );
  const fields = [
    {
      pointer: "destination/directory",
      value: artifact.destination.directory,
      evidence: artifact.destination.evidence,
    },
    ...artifact.titleTokens.map((value, index) => ({
      pointer: `titleTokens/${index}`,
      value,
      evidence: artifact.acceptedBy,
    })),
    ...artifact.sourceTokens.map((value, index) => ({
      pointer: `sourceTokens/${index}`,
      value,
      evidence: artifact.source.evidence,
    })),
    ...artifact.qualifiers.flatMap(({ tokens, evidence }, index) =>
      tokens.map((value, token) => ({
        pointer: `qualifiers/${index}/tokens/${token}`,
        value,
        evidence,
      })),
    ),
    ...artifact.disambiguators.flatMap(({ tokens, evidence }, index) =>
      tokens.map((value, token) => ({
        pointer: `disambiguators/${index}/tokens/${token}`,
        value,
        evidence,
      })),
    ),
  ];
  for (const { pointer, value, evidence } of fields) {
    const normalized = value.normalize("NFC");
    if (value !== normalized)
      diagnostics.push({
        kind: "normalization",
        code: "normalized-nfc",
        pointer: `/${pointer}`,
        message:
          "Display naming uses NFC. Source evidence and accepted metadata remain unchanged.",
        evidence,
        form: "NFC",
        original: value,
        normalized,
      });
  }
  return diagnostics;
}

export function problem(
  code: string,
  artifact: NamingArtifact,
  message: string,
): NamingDiagnostic {
  return {
    kind: "problem",
    code,
    pointer: "",
    message,
    evidence: artifact.acceptedBy,
  };
}
