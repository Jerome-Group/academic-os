import type {
  AuditResult,
  Finding,
  Inventory,
  InventoryEntryKind,
} from "./types.js";
import { universalStructurePaths } from "../contract/universal-structure.js";
import { requiredPathFindings } from "./required-paths.js";
import { enforcementForRule } from "./rule-enforcement.js";

const universalStructureRule = {
  ruleId: "MF-UNIVERSAL-001",
  subject: "universal",
  applicability: "Universal structure applies to every module folder.",
} as const;

const academicDocumentExtensions = new Set([
  ".doc",
  ".docx",
  ".key",
  ".numbers",
  ".pages",
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

export function auditUniversalStructure(
  inventory: Inventory,
  declaredContextualRoots: ReadonlySet<string> = new Set(),
  expectedStructure: ReadonlyArray<
    readonly [string, InventoryEntryKind]
  > = universalStructurePaths,
): AuditResult {
  const expectedRootPaths = new Set<string>(
    expectedStructure
      .filter(([path]) => !path.includes("/"))
      .map(([path]) => path),
  );
  const findings = requiredPathFindings(
    inventory,
    expectedStructure,
    universalStructureRule,
  );

  const unexpectedRootEntries = inventory.entries
    .filter(
      (entry) =>
        !entry.path.includes("/") &&
        !expectedRootPaths.has(entry.path) &&
        !declaredContextualRoots.has(entry.path) &&
        entry.path !== "build" &&
        !(entry.kind === "directory" && entry.path.startsWith("NTULearn_")),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const unexpectedRootFindings = unexpectedRootEntries.flatMap((entry) => {
    const finding = unexpectedRootFinding(entry);
    return finding === undefined ? [] : [finding];
  });
  findings.push(
    ...(unexpectedRootFindings.length === 0
      ? [conformantRootFinding()]
      : unexpectedRootFindings),
  );

  return {
    outcome: outcomeFor(findings),
    findings,
  };
}

function unexpectedRootFinding({
  path,
  kind,
}: Inventory["entries"][number]): Finding | undefined {
  if (kind === "directory") {
    return {
      ruleId: "MF-ROOT-002",
      enforcement: enforcementForRule("MF-ROOT-002"),
      status: "requires-decision",
      severity: "decision",
      path,
      evidence: `Inventory contains the unclassified root ${kind} ${path}.`,
      explanation:
        "An unknown root entry requires classification and a human decision.",
      applicability:
        "Root-entry classification applies to every module folder.",
    };
  }

  if (kind !== "file" || !isAcademicDocument(path)) {
    return undefined;
  }

  return {
    ruleId: "MF-ROOT-002",
    enforcement: enforcementForRule("MF-ROOT-002"),
    status: "fail",
    severity: "error",
    path,
    evidence: `Inventory contains the loose academic file ${path}.`,
    explanation: "Academic documents are prohibited at module root.",
    applicability: "Root-entry placement applies to every module folder.",
  };
}

function conformantRootFinding(): Finding {
  return {
    ruleId: "MF-ROOT-002",
    enforcement: enforcementForRule("MF-ROOT-002"),
    status: "pass",
    severity: "information",
    path: ".",
    evidence: "Inventory contains no governed module-root deviations.",
    explanation:
      "No root directory needs classification and no academic payload is loose.",
    applicability: "Root-entry placement applies to every module folder.",
  };
}

function isAcademicDocument(path: string): boolean {
  const extensionStart = path.lastIndexOf(".");
  return (
    extensionStart >= 0 &&
    academicDocumentExtensions.has(path.slice(extensionStart).toLowerCase())
  );
}

export function outcomeFor(findings: Finding[]): AuditResult["outcome"] {
  if (findings.some(({ status }) => status === "requires-decision")) {
    return "requires-decision";
  }
  if (findings.some(({ status }) => status === "fail")) {
    return "deviation";
  }
  return "conformant";
}
