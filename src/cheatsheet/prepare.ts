import { readFile } from "node:fs/promises";

import { sha256, sha256Bytes } from "../checksum.js";
import { readControlDocument } from "../conformance/control-document.js";
import { readDefinitionIdentity } from "../conformance/definition-shape.js";
import {
  firstDirectTableRows,
  sectionBody,
} from "../conformance/markdown-control-helpers.js";
import {
  readSourceMap,
  type SourceMapUnitEntry,
} from "../conformance/source-map.js";
import { validateDefinition } from "../conformance/validate-definition.js";
import { validateProfile } from "../conformance/validate-profile.js";
import { isRecord } from "../conformance/value-shape.js";
import { resolveModuleFile } from "./module-path.js";

export interface CheatsheetCandidate {
  unit: string;
  topics: string[];
  path: string;
  locator: string;
  role: string;
  missing: string[];
  availability: "observed" | "unavailable";
  sha256?: string;
  reason?: string;
}

/** Read-only context evidence; the pinned procedure decides relevance and authority. */
export async function prepareCheatsheet(input: {
  moduleRoot: string;
  moduleCode: string;
  assessment: string;
}) {
  const paths = {
    profile: "00 Module Admin/00 Module Profile.md",
    definition: "00 Module Admin/10 Module Definition.yaml",
    sourceMap: "00 Module Admin/40 Source Map.yaml",
  };
  const controls = await Promise.all(
    Object.entries(paths).map(async ([kind, path]) => ({
      kind,
      path,
      text: await readFile(
        await resolveModuleFile(input.moduleRoot, path),
        "utf8",
      ),
    })),
  );
  const profile = controls.find(({ kind }) => kind === "profile")?.text ?? "";
  const definition = readControlDocument(
    controls.find(({ kind }) => kind === "definition")?.text ?? "",
  );
  const identity =
    "value" in definition && isRecord(definition.value)
      ? readDefinitionIdentity(definition.value)
      : undefined;
  if (identity?.code !== input.moduleCode)
    throw new Error("Requested module disagrees with Definition identity.");
  const definitionValidation = validateDefinition(
    controls.find(({ kind }) => kind === "definition")?.text,
    input.moduleCode,
    `S${identity.semester}`,
  );
  const controlFindings = [
    ...definitionValidation.findings,
    ...validateProfile(profile, identity, definitionValidation.importerRoots),
  ];
  const sourceMap =
    controls.find(({ kind }) => kind === "sourceMap")?.text ?? "";
  const read = readSourceMap(sourceMap);
  if (read.kind === "invalid") throw new Error(read.finding.evidence);
  const candidates = read.units.flatMap(declaredCandidates);
  for (const candidate of candidates) {
    try {
      candidate.sha256 = sha256Bytes(
        await readFile(
          await resolveModuleFile(input.moduleRoot, candidate.path),
        ),
      );
      candidate.availability = "observed";
    } catch (error) {
      candidate.reason = error instanceof Error ? error.message : String(error);
    }
  }
  const rows = firstDirectTableRows(
    sectionBody(profile, "Assessment Structure"),
  );
  const header = rows[0] ?? [];
  const component = header.indexOf("Component");
  const assessments = rows
    .slice(2)
    .filter((row) =>
      (row[component] ?? "")
        .toLowerCase()
        .includes(input.assessment.toLowerCase()),
    )
    .map((row) =>
      Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])),
    );
  const unresolved = [
    ...controlFindings
      .filter(({ status }) => status !== "pass" && status !== "not-applicable")
      .map(({ ruleId, evidence }) => `${ruleId}: ${evidence}`),
    ...(assessments.length === 1
      ? []
      : [
          `Assessment request matches ${assessments.length} Profile rows; select the assessment.`,
        ]),
    ...(assessments.some((row) =>
      Object.values(row).some((cell) => /\bunknown\b/iu.test(cell)),
    )
      ? [
          "Assessment has explicit unknown facts; resolve those affecting scope or exam constraints.",
        ]
      : []),
    ...(candidates.length === 0
      ? ["Source Map has no candidate sources."]
      : []),
    ...(candidates.some(({ availability }) => availability === "unavailable")
      ? [
          "Some mapped sources are unreadable; resolve required-source gaps before authoring.",
        ]
      : []),
  ];
  return {
    status: unresolved.length > 0 ? "needs-choice" : "context-discovered",
    module: identity,
    assessmentRequest: input.assessment,
    assessments,
    controlFindings,
    controls: controls.map(({ path, text }) => ({
      path,
      sha256: sha256(text),
    })),
    context: {
      scope: sectionBody(profile, "Scope"),
      sourceAuthority: sectionBody(profile, "Source Authority"),
      knownGaps: sectionBody(profile, "Known Gaps"),
    },
    candidates,
    unresolved,
    limits: [
      "Mapped files and digests prove local availability, not current upstream completeness, assessment relevance, or permission to bring a sheet.",
      "Read cited assessment evidence to establish page, font, permitted-content and exam constraints; mathematical and visual review remain semantic work.",
    ],
  };
}

function declaredCandidates({
  unit,
  source,
}: SourceMapUnitEntry): CheatsheetCandidate[] {
  const candidate = {
    unit,
    topics: [...source.topics],
    availability: "unavailable" as const,
  };
  return Object.keys(source).flatMap((role): CheatsheetCandidate[] => {
    switch (role) {
      case "lectures":
      case "textbook":
      case "supplementary_materials":
      case "past_papers":
      case "practice_tests":
      case "historical_reference":
        return (source[role] ?? []).map((path) => ({
          ...candidate,
          path,
          locator: "whole file",
          role,
          missing: [],
        }));
      case "tutorials":
        return source.tutorials.flatMap((tutorial) =>
          typeof tutorial === "string"
            ? [
                {
                  ...candidate,
                  path: tutorial,
                  locator: "whole file",
                  role,
                  missing: [],
                },
              ]
            : tutorial.sources.map((entry) => ({
                ...candidate,
                path: entry.file,
                locator: entry.locator,
                role: entry.role,
                missing: [...(entry.missing ?? [])],
              })),
        );
      default:
        return [];
    }
  });
}
