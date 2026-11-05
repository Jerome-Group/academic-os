import { categoryToken } from "./destinations.js";
import type { NamingArtifact, NamingRequest } from "./types.js";
import { compareNames } from "./unicode.js";

export function renderPath(
  request: NamingRequest,
  artifact: NamingArtifact,
  qualified: boolean,
): string {
  const sequence =
    artifact.sequence.kind === "source"
      ? [
          artifact.sequence.format === "preserve"
            ? artifact.sequence.token
            : artifact.sequence.token.padStart(
                request.policy.counterMinimumWidth,
                "0",
              ),
        ]
      : [];
  const traits = [
    ...(artifact.traits.content === "questions" ||
    artifact.traits.content === "questions-and-solutions"
      ? ["Questions"]
      : []),
    ...(artifact.traits.content === "solutions" ||
    artifact.traits.content === "questions-and-solutions"
      ? ["Solutions"]
      : []),
    ...(artifact.traits.annotation === "clean"
      ? ["Clean"]
      : artifact.traits.annotation === "annotated"
        ? ["Annotated"]
        : []),
    ...(artifact.traits.grading === "graded" ? ["Graded"] : []),
  ];
  const markers = {
    "source-id": "Source",
    "source-version": "Version",
    year: "Year",
    date: "Date",
    edition: "Edition",
  };
  const disambiguators = qualified
    ? [...artifact.disambiguators]
        .sort((left, right) =>
          compareNames(
            `${left.kind}\0${left.tokens.join("_")}`,
            `${right.kind}\0${right.tokens.join("_")}`,
          ),
        )
        .flatMap(({ kind, tokens }) => [markers[kind], ...tokens])
    : [];
  const tokens = [
    request.module.moduleCode,
    categoryToken(artifact),
    ...sequence,
    ...artifact.titleTokens,
    ...(artifact.sourceTokens.length > 0
      ? ["Source", ...artifact.sourceTokens]
      : []),
    ...(artifact.academicYear === null ? [] : [artifact.academicYear.value]),
    ...(artifact.issued === null ? [] : [artifact.issued.day]),
    ...traits,
    ...[...artifact.qualifiers]
      .sort((left, right) =>
        compareNames(left.tokens.join("_"), right.tokens.join("_")),
      )
      .flatMap(({ tokens: values }) => values),
    ...disambiguators,
  ];
  return `${artifact.destination.directory}/${tokens.join("_")}.${artifact.representation.extension}`.normalize(
    "NFC",
  );
}
