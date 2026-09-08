import { readControlDocument } from "../conformance/control-document.js";
import {
  type Inventory,
  type InventoryEntry,
  validateSourceMap,
} from "../conformance/index.js";
import { parseDocument } from "yaml";
import type {
  DeclaredTutorialGap,
  LearningMaterialsAssessment,
  LearningMaterialsUnit,
  MaterialCategory,
  MaterialReferenceAssessment,
  TutorialAssessment,
  TutorialSourceAssessment,
} from "./types.js";

interface SourceMapUnit {
  topics: string[];
  lectures: string[];
  textbook: string[];
  tutorials: Array<string | TutorialBlock>;
  teaching_weeks?: number[];
  supplementary_materials?: string[];
  past_papers?: string[];
  practice_tests?: string[];
  historical_reference?: string[];
}

interface TutorialBlock {
  block: string;
  exercises: string;
  sources: Array<{
    file: string;
    locator: string;
    role: string;
    missing?: string[];
  }>;
}

export function assessLearningMaterials(
  sourceMap: string | undefined,
  inventory: Inventory,
): LearningMaterialsAssessment {
  const completeness = inventory.provenance?.completeness ?? "partial";
  const finding = validateSourceMap(sourceMap);
  if (finding.status !== "pass" || sourceMap === undefined) {
    return emptyAssessment("invalid", completeness, [finding.evidence]);
  }
  const parsed = readControlDocument(sourceMap);
  if ("problems" in parsed) {
    return emptyAssessment("invalid", completeness, parsed.problems);
  }
  const source = parsed.value as { units: Record<string, SourceMapUnit> };
  const entries = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const units = sourceMapUnitOrder(sourceMap).map((unit) =>
    assessUnit(
      unit,
      source.units[unit] as SourceMapUnit,
      entries,
      completeness,
    ),
  );
  const references = units.flatMap(unitReferences);
  const declaredTutorialGaps = units.flatMap(declaredGaps);
  const missingFiles = uniquePaths(references, "missing");
  const nonFiles = uniquePaths(references, "not-file");
  const unavailableFiles = uniquePaths(references, "unavailable");
  const emptyUnits = units
    .filter(({ status }) => status === "empty")
    .map(({ unit }) => unit);
  const noUnits = units.length === 0;
  const hasGaps =
    noUnits ||
    missingFiles.length > 0 ||
    nonFiles.length > 0 ||
    declaredTutorialGaps.length > 0 ||
    emptyUnits.length > 0;
  const outcome =
    completeness === "partial" || unavailableFiles.length > 0
      ? "incomplete"
      : hasGaps
        ? "gaps"
        : "available";
  return {
    outcome,
    inventoryCompleteness: completeness,
    units,
    missingFiles,
    nonFiles,
    unavailableFiles,
    declaredTutorialGaps,
    emptyUnits,
    noUnits,
    problems: [],
    summary: {
      units: units.length,
      references: references.length,
      available: countAvailability(references, "available"),
      missing: countAvailability(references, "missing"),
      nonFiles: countAvailability(references, "not-file"),
      unavailable: countAvailability(references, "unavailable"),
      declaredMissing: declaredTutorialGaps.reduce(
        (total, gap) => total + gap.missing.length,
        0,
      ),
      emptyUnits: emptyUnits.length,
    },
  };
}

function sourceMapUnitOrder(sourceMap: string): string[] {
  const root = parseDocument(sourceMap, { uniqueKeys: true }).toJS({
    mapAsMap: true,
  });
  if (!(root instanceof Map)) return [];
  const units = root.get("units");
  return units instanceof Map ? [...units.keys()].map(String) : [];
}

function assessUnit(
  unit: string,
  source: SourceMapUnit,
  entries: Map<string, InventoryEntry>,
  completeness: "complete" | "partial",
): LearningMaterialsUnit {
  const paths = (category: MaterialCategory, values: string[] | undefined) =>
    (values ?? []).map((file) =>
      assessReference(category, file, entries, completeness),
    );
  const tutorials = source.tutorials.map((tutorial): TutorialAssessment => {
    if (typeof tutorial === "string") {
      return {
        kind: "file",
        source: assessReference(
          "tutorials",
          tutorial,
          entries,
          completeness,
        ) as MaterialReferenceAssessment & { category: "tutorials" },
      };
    }
    return {
      kind: "block",
      block: tutorial.block,
      exercises: tutorial.exercises,
      sources: tutorial.sources.map(
        (sourceEntry): TutorialSourceAssessment => ({
          ...assessReference(
            "tutorials",
            sourceEntry.file,
            entries,
            completeness,
          ),
          category: "tutorials",
          locator: sourceEntry.locator,
          role: sourceEntry.role,
          declaredMissing: [...(sourceEntry.missing ?? [])],
        }),
      ),
    };
  });
  const assessed: LearningMaterialsUnit = {
    unit,
    topics: [...source.topics],
    ...(source.teaching_weeks === undefined
      ? {}
      : { teachingWeeks: [...source.teaching_weeks] }),
    lectures: paths("lectures", source.lectures),
    textbook: paths("textbook", source.textbook),
    tutorials,
    supplementaryMaterials: paths(
      "supplementary_materials",
      source.supplementary_materials,
    ),
    pastPapers: paths("past_papers", source.past_papers),
    practiceTests: paths("practice_tests", source.practice_tests),
    historicalReference: paths(
      "historical_reference",
      source.historical_reference,
    ),
    status: "available",
  };
  const references = unitReferences(assessed);
  const declared = declaredGaps(assessed);
  assessed.status =
    references.length === 0
      ? "empty"
      : references.some(({ availability }) => availability === "unavailable")
        ? "unavailable"
        : references.some(({ availability }) => availability !== "available") ||
            declared.length > 0
          ? "gaps"
          : "available";
  return assessed;
}

function assessReference(
  category: MaterialCategory,
  file: string,
  entries: Map<string, InventoryEntry>,
  completeness: "complete" | "partial",
): MaterialReferenceAssessment {
  const entry = entries.get(file);
  if (entry === undefined) {
    return {
      category,
      file,
      availability: completeness === "complete" ? "missing" : "unavailable",
    };
  }
  if (entry.kind === "file")
    return { category, file, availability: "available" };
  return {
    category,
    file,
    availability: "not-file",
    actualKind: entry.kind,
  };
}

function unitReferences(
  unit: LearningMaterialsUnit,
): MaterialReferenceAssessment[] {
  return [
    ...unit.lectures,
    ...unit.textbook,
    ...unit.tutorials.flatMap((tutorial) =>
      tutorial.kind === "file" ? [tutorial.source] : tutorial.sources,
    ),
    ...unit.supplementaryMaterials,
    ...unit.pastPapers,
    ...unit.practiceTests,
    ...unit.historicalReference,
  ];
}

function declaredGaps(unit: LearningMaterialsUnit): DeclaredTutorialGap[] {
  return unit.tutorials.flatMap((tutorial) =>
    tutorial.kind === "file"
      ? []
      : tutorial.sources.flatMap((source) =>
          source.declaredMissing.length === 0
            ? []
            : [
                {
                  unit: unit.unit,
                  block: tutorial.block,
                  file: source.file,
                  role: source.role,
                  missing: [...source.declaredMissing],
                },
              ],
        ),
  );
}

function uniquePaths(
  references: MaterialReferenceAssessment[],
  availability: MaterialReferenceAssessment["availability"],
): string[] {
  return [
    ...new Set(
      references
        .filter((reference) => reference.availability === availability)
        .map(({ file }) => file),
    ),
  ];
}

function countAvailability(
  references: MaterialReferenceAssessment[],
  availability: MaterialReferenceAssessment["availability"],
): number {
  return references.filter(
    (reference) => reference.availability === availability,
  ).length;
}

function emptyAssessment(
  outcome: "invalid",
  inventoryCompleteness: "complete" | "partial",
  problems: string[],
): LearningMaterialsAssessment {
  return {
    outcome,
    inventoryCompleteness,
    units: [],
    missingFiles: [],
    nonFiles: [],
    unavailableFiles: [],
    declaredTutorialGaps: [],
    emptyUnits: [],
    noUnits: false,
    problems,
    summary: {
      units: 0,
      references: 0,
      available: 0,
      missing: 0,
      nonFiles: 0,
      unavailable: 0,
      declaredMissing: 0,
      emptyUnits: 0,
    },
  };
}
