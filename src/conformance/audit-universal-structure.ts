import type {
  AuditResult,
  Finding,
  Inventory,
  InventoryEntryKind,
} from "./types.js";

const requiredPaths = [
  ["00 Module Admin", "directory"],
  ["00 Module Admin/00 Module Profile.md", "file"],
  ["00 Module Admin/10 Module Definition.yaml", "file"],
  ["00 Module Admin/20 Curation Register.jsonl", "file"],
  ["10 Learning Materials", "directory"],
  ["10 Learning Materials/10 Lecture Materials", "directory"],
  ["10 Learning Materials/20 Textbook Chapters", "directory"],
  ["10 Learning Materials/30 Personal Notes", "directory"],
  ["20 Tutorials", "directory"],
  ["30 Assessments", "directory"],
  ["30 Assessments/30 Midterms", "directory"],
  ["30 Assessments/40 Finals", "directory"],
  ["40 Projects and Labs", "directory"],
  ["70 Learning", "directory"],
  ["90 Resources", "directory"],
  ["90 Resources/00 Unclassified", "directory"],
  [".scratch", "directory"],
  ["NTULearn", "directory"],
  ["AGENTS.md", "file"],
  ["CLAUDE.md", "file"],
  ["CONTEXT.md", "file"],
  ["docs", "directory"],
] as const satisfies ReadonlyArray<readonly [string, InventoryEntryKind]>;

const expectedRootPaths = new Set<string>(
  requiredPaths.filter(([path]) => !path.includes("/")).map(([path]) => path),
);
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

export function auditUniversalStructure(inventory: Inventory): AuditResult {
  const entriesByPath = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const findings = requiredPaths.map(([path, expectedKind]) => {
    const entry = entriesByPath.get(path);
    if (entry === undefined) {
      return missingRequiredPath(path, expectedKind);
    }
    if (entry.kind !== expectedKind) {
      return wrongRequiredPathKind(path, expectedKind, entry.kind);
    }
    return presentRequiredPath(path, expectedKind);
  });

  const unexpectedRootEntries = inventory.entries
    .filter(
      (entry) =>
        !entry.path.includes("/") && !expectedRootPaths.has(entry.path),
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

function presentRequiredPath(
  path: string,
  expectedKind: InventoryEntryKind,
): Finding {
  return {
    ruleId: "MF-UNIVERSAL-001",
    status: "pass",
    severity: "information",
    path,
    evidence: `Inventory contains a ${expectedKind} at ${path}.`,
    explanation:
      "The required universal path is present with the required kind.",
    applicability: "Universal structure applies to every module folder.",
  };
}

function missingRequiredPath(
  path: string,
  expectedKind: InventoryEntryKind,
): Finding {
  return {
    ruleId: "MF-UNIVERSAL-001",
    status: "fail",
    severity: "error",
    path,
    evidence: `Inventory has no entry at ${path}.`,
    explanation: `The contract requires a ${expectedKind} at this path.`,
    applicability: "Universal structure applies to every module folder.",
  };
}

function wrongRequiredPathKind(
  path: string,
  expectedKind: InventoryEntryKind,
  actualKind: InventoryEntryKind,
): Finding {
  return {
    ruleId: "MF-UNIVERSAL-001",
    status: "fail",
    severity: "error",
    path,
    evidence: `Inventory identifies ${path} as a ${actualKind}.`,
    explanation: `The contract requires a ${expectedKind} at this path.`,
    applicability: "Universal structure applies to every module folder.",
  };
}

function unexpectedRootFinding({
  path,
  kind,
}: Inventory["entries"][number]): Finding | undefined {
  if (kind === "directory") {
    return {
      ruleId: "MF-ROOT-002",
      status: "requires-decision",
      severity: "decision",
      path,
      evidence: `Inventory contains the unclassified root ${kind} ${path}.`,
      explanation: "An unknown root entry requires classification.",
      applicability:
        "Root-entry classification applies to every module folder.",
    };
  }

  if (kind !== "file" || !isAcademicDocument(path)) {
    return undefined;
  }

  return {
    ruleId: "MF-ROOT-002",
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

function outcomeFor(findings: Finding[]): AuditResult["outcome"] {
  if (findings.some(({ status }) => status === "requires-decision")) {
    return "requires-decision";
  }
  if (findings.some(({ status }) => status === "fail")) {
    return "deviation";
  }
  return "conformant";
}
