import { readFile } from "node:fs/promises";

import { sha256, sha256Bytes } from "../checksum.js";
import { readControlDocument } from "../conformance/control-document.js";
import { readDefinitionIdentity } from "../conformance/definition-shape.js";
import {
  firstDirectTableRows,
  sectionBody,
} from "../conformance/markdown-control-helpers.js";
import { validateSourceMap } from "../conformance/validate-source-map.js";
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
  const controlFindings = [
    ...validateDefinition(
      controls.find(({ kind }) => kind === "definition")?.text,
      input.moduleCode,
      `S${identity.semester}`,
    ).findings,
    ...validateProfile(profile, identity),
  ];
  const sourceMap =
    controls.find(({ kind }) => kind === "sourceMap")?.text ?? "";
  const validation = validateSourceMap(sourceMap);
  if (validation.status !== "pass") throw new Error(validation.evidence);
  const parsed = readControlDocument(sourceMap);
  if (
    !("value" in parsed) ||
    !isRecord(parsed.value) ||
    !isRecord(parsed.value.units)
  )
    throw new Error("Unreadable Source Map.");
  const candidates: CheatsheetCandidate[] = [];
  for (const [unit, raw] of Object.entries(parsed.value.units)) {
    if (!isRecord(raw)) continue;
    const topics = raw.topics as string[];
    for (const [role, entries] of Object.entries(raw)) {
      if (
        role === "topics" ||
        role === "teaching_weeks" ||
        !Array.isArray(entries)
      )
        continue;
      for (const entry of entries) {
        if (typeof entry === "string") {
          candidates.push({
            unit,
            topics,
            path: entry,
            locator: "whole file",
            role,
            missing: [],
            availability: "unavailable",
          });
        } else if (isRecord(entry) && Array.isArray(entry.sources)) {
          for (const source of entry.sources) {
            if (!isRecord(source)) continue;
            candidates.push({
              unit,
              topics,
              path: source.file as string,
              locator: source.locator as string,
              role: source.role as string,
              missing: (source.missing as string[] | undefined) ?? [],
              availability: "unavailable",
            });
          }
        }
      }
    }
  }
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
