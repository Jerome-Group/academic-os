import {
  interpolateModuleCode,
  pinnedDocumentNames,
  pinnedDocumentPaths,
  seedTemplatePath,
  type PinnedDocumentBodies,
  type PinnedDocumentName,
} from "../contract/pinned-documents.js";
import { controlFinding, failedControl } from "./control-finding.js";
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

function firstDifference(copy: string, expected: string): string {
  const copyLines = copy.split("\n");
  const expectedLines = expected.split("\n");
  const index = expectedLines.findIndex(
    (line, position) => copyLines[position] !== line,
  );
  return index < 0
    ? `line ${expectedLines.length + 1}, where the copy continues past the template`
    : `line ${index + 1}, which reads ${JSON.stringify(copyLines[index] ?? "<end of copy>")} rather than ${JSON.stringify(expectedLines[index] ?? "")}`;
}
