import type { ConfiguredModule } from "../config/index.js";

export type MaterialAvailability =
  | "available"
  | "missing"
  | "not-file"
  | "unavailable";

export type MaterialCategory =
  | "lectures"
  | "textbook"
  | "tutorials"
  | "supplementary_materials"
  | "past_papers"
  | "practice_tests"
  | "historical_reference";

export interface MaterialReferenceAssessment {
  category: MaterialCategory;
  file: string;
  availability: MaterialAvailability;
  actualKind?: "directory" | "symlink" | "other";
}

export interface TutorialSourceAssessment extends MaterialReferenceAssessment {
  category: "tutorials";
  locator: string;
  role: string;
  declaredMissing: string[];
}

export type TutorialAssessment =
  | {
      kind: "file";
      source: MaterialReferenceAssessment & { category: "tutorials" };
    }
  | {
      kind: "block";
      block: string;
      exercises: string;
      sources: TutorialSourceAssessment[];
    };

export interface LearningMaterialsUnit {
  unit: string;
  topics: string[];
  teachingWeeks?: number[];
  lectures: MaterialReferenceAssessment[];
  textbook: MaterialReferenceAssessment[];
  tutorials: TutorialAssessment[];
  supplementaryMaterials: MaterialReferenceAssessment[];
  pastPapers: MaterialReferenceAssessment[];
  practiceTests: MaterialReferenceAssessment[];
  historicalReference: MaterialReferenceAssessment[];
  status: "available" | "gaps" | "empty" | "unavailable";
}

export interface DeclaredTutorialGap {
  unit: string;
  block: string;
  file: string;
  role: string;
  missing: string[];
}

export interface LearningMaterialsSummary {
  units: number;
  references: number;
  available: number;
  missing: number;
  nonFiles: number;
  unavailable: number;
  declaredMissing: number;
  emptyUnits: number;
}

export interface LearningMaterialsAssessment {
  outcome: "available" | "gaps" | "invalid" | "incomplete";
  inventoryCompleteness: "complete" | "partial";
  units: LearningMaterialsUnit[];
  missingFiles: string[];
  nonFiles: string[];
  unavailableFiles: string[];
  declaredTutorialGaps: DeclaredTutorialGap[];
  emptyUnits: string[];
  noUnits: boolean;
  problems: string[];
  summary: LearningMaterialsSummary;
}

export interface ModuleLearningMaterialsReport {
  module: ConfiguredModule;
  outcome: LearningMaterialsAssessment["outcome"];
  assessment?: LearningMaterialsAssessment;
  error?: { code: string; message: string };
}

export interface LearningMaterialsReport {
  schemaVersion: 1;
  mode: "learning-materials";
  activeSemester: string;
  outcome: LearningMaterialsAssessment["outcome"];
  selection: {
    included: ConfiguredModule[];
    excluded: Array<ConfiguredModule & { reason: "past" | "future" }>;
    unresolved: Array<ConfiguredModule & { reason: string }>;
  };
  modules: ModuleLearningMaterialsReport[];
}
