import { auditCuratedNaming } from "./audit-curated-naming.js";
import { auditLatexBuilds } from "./audit-latex-builds.js";
import { auditStructuralPlacement } from "./audit-structural-placement.js";
import { auditTextbookChapters } from "./audit-textbook-chapters.js";
import { outcomeFor } from "./audit-universal-structure.js";
import { deriveContextualStructure } from "./contextual-structure.js";
import type { AuditResult, Inventory } from "./types.js";

export function auditGovernedContent(
  inventory: Inventory,
  definitionSource: string | undefined,
): AuditResult {
  const context = deriveContextualStructure(definitionSource);
  const findings = [
    ...auditStructuralPlacement(inventory, context),
    ...auditCuratedNaming(inventory, context.importerRoots),
    ...auditLatexBuilds(inventory, context.importerRoots),
    ...auditTextbookChapters(inventory),
  ];
  return { outcome: outcomeFor(findings), findings };
}
