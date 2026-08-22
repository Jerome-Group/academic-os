import { seedSourceTemplatePath } from "./seed-source-template-path.js";

export const pinnedDocumentPaths = {
  agents: "AGENTS.md",
  structureAndNaming: "docs/00 Structure and Naming.md",
  curationProcedure: "docs/10 Curation Procedure.md",
  teachingProcedure: "docs/20 Teaching Procedure.md",
  textbookProcedure: "docs/30 Textbook Procedure.md",
  teachingPreferences: "70 Learning/templates/preferences.md",
} as const;

export type PinnedDocumentName = keyof typeof pinnedDocumentPaths;
export type PinnedDocumentBodies = Readonly<Record<PinnedDocumentName, string>>;

export const pinnedDocumentNames = Object.keys(
  pinnedDocumentPaths,
) as PinnedDocumentName[];

export function seedTemplatePath(name: PinnedDocumentName): string {
  return seedSourceTemplatePath(pinnedDocumentPaths[name]);
}

export function interpolateModuleCode(
  template: string,
  moduleCode: string,
): string {
  return template.replaceAll("MODULE_CODE", moduleCode);
}
