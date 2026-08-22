import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
  seedTemplatePath,
  type PinnedDocumentBodies,
  type PinnedDocumentName,
} from "../contract/pinned-documents.js";
import { controlFinding, failedControl } from "./control-finding.js";
import { firstDifference } from "./first-difference.js";
import type { Finding, ModuleControls } from "./types.js";

export function validatePinnedDocuments(
  controls: ModuleControls,
  moduleCode: string,
  templates: PinnedDocumentBodies,
): Finding[] {
  return pinnedDocumentNames.map((name) =>
    pinnedDocumentFinding(
      name,
      controls[name],
      interpolateModuleCode(templates[name], moduleCode),
    ),
  );
}

function pinnedDocumentFinding(
  name: PinnedDocumentName,
  copy: string | undefined,
  expected: string,
): Finding {
  const path = pinnedDocumentPaths[name];
  if (copy === undefined) {
    return failedControl("MF-AGENTS-004", path, [
      `No readable control exists at ${path}.`,
    ]);
  }
  if (copy !== expected) {
    return failedControl("MF-AGENTS-004", path, [
      `Pinned copy differs from seed-templates/${seedTemplatePath(name)} at ${firstDifference(copy, expected)}.`,
    ]);
  }
  return controlFinding(
    "MF-AGENTS-004",
    path,
    "pass",
    `Pinned copy is byte-identical to seed-templates/${seedTemplatePath(name)}.`,
    "The pinned document carries the contract's own text for this module.",
  );
}
