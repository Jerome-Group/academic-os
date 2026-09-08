import type { Finding, ModuleConformancePlan } from "../conformance/index.js";
import type {
  LearningMaterialsAssessment,
  LearningMaterialsUnit,
} from "../learning-materials/index.js";
import type { ImportRootStatus } from "../imports/index.js";
import {
  MAINTENANCE_DOMAINS,
  type MaintenanceDomainId,
} from "./maintenance-domains.js";

const maximumFindings = 100;
const maximumLearningUnits = 50;
const maximumPathsPerUnit = 30;

export interface MaintenanceImportObservation {
  available: boolean;
  roots: ImportRootStatus[];
  error?: string;
}

export interface MaintenanceFinding {
  ruleId: string;
  status: Finding["status"];
  enforcement: Finding["enforcement"];
  path: string;
  evidence: string;
  applicability: string;
}

export interface MaintenanceDomainWork {
  domain: MaintenanceDomainId;
  label: string;
  ruleIds: readonly string[];
  evidence: string[];
  findings: MaintenanceFinding[];
  proposedDirectories: string[];
}

export interface MaintenanceLearningUnit {
  unit: string;
  topics: string[];
  status: LearningMaterialsUnit["status"];
  gaps: string[];
}

export interface ModuleMaintenanceWorkOrder {
  schemaVersion: 1;
  module: { code: string; semester: string };
  observedAt: string;
  contractVersion: number | "unavailable";
  audit: {
    outcome: ModuleConformancePlan["outcome"];
    findings: MaintenanceFinding[];
    omittedFindings: number;
    proposedDirectories: string[];
  };
  imports: MaintenanceImportObservation;
  learningSources: {
    outcome: LearningMaterialsAssessment["outcome"];
    summary: LearningMaterialsAssessment["summary"];
    units: MaintenanceLearningUnit[];
    omittedUnits: number;
    problems: string[];
  };
  writeJournalDirectory: string;
  writeJournalPath: string;
  writeJournalSchemaVersion: 1;
  domains: MaintenanceDomainWork[];
}

export function createModuleMaintenanceWorkOrder(input: {
  module: { code: string; semester: string };
  observedAt: string;
  plan: ModuleConformancePlan;
  imports: MaintenanceImportObservation;
  learningSources: LearningMaterialsAssessment;
  writeJournalDirectory: string;
  writeJournalPath: string;
}): ModuleMaintenanceWorkOrder {
  const attentionFindings = input.plan.findings
    .filter(({ status }) => !["pass", "not-applicable"].includes(status))
    .sort(compareFindings);
  const findings = attentionFindings
    .slice(0, maximumFindings)
    .map(maintenanceFinding);
  const proposedDirectories = input.plan.proposedOperations
    .filter(({ kind }) => kind === "create-directory")
    .map(({ path }) => path);
  const units = input.learningSources.units
    .slice(0, maximumLearningUnits)
    .map(maintenanceLearningUnit);
  return {
    schemaVersion: 1,
    module: input.module,
    observedAt: input.observedAt,
    contractVersion: input.plan.observation.contractVersion,
    audit: {
      outcome: input.plan.outcome,
      findings,
      omittedFindings: attentionFindings.length - findings.length,
      proposedDirectories,
    },
    imports: input.imports,
    learningSources: {
      outcome: input.learningSources.outcome,
      summary: input.learningSources.summary,
      units,
      omittedUnits: input.learningSources.units.length - units.length,
      problems: input.learningSources.problems.slice(0, maximumPathsPerUnit),
    },
    writeJournalDirectory: input.writeJournalDirectory,
    writeJournalPath: input.writeJournalPath,
    writeJournalSchemaVersion: 1,
    domains: MAINTENANCE_DOMAINS.map((domain) => {
      const rules = new Set<string>(domain.ruleIds);
      const domainFindings = findings.filter(({ ruleId }) => rules.has(ruleId));
      const domainPasses = input.plan.findings.filter(
        ({ ruleId, status }) => rules.has(ruleId) && status === "pass",
      ).length;
      return {
        domain: domain.id,
        label: domain.label,
        ruleIds: domain.ruleIds,
        evidence: domainEvidence(
          domain.id,
          domainPasses,
          domainFindings,
          input.imports,
          input.learningSources,
        ),
        findings: domainFindings,
        proposedDirectories: input.plan.proposedOperations
          .filter(
            ({ kind, ruleId }) =>
              kind === "create-directory" && rules.has(ruleId),
          )
          .map(({ path }) => path),
      };
    }),
  };
}

export function auditEvidence(plan: ModuleConformancePlan): {
  schemaVersion: 1;
  observedAt: string;
  outcome: ModuleConformancePlan["outcome"];
  inventory: { entries: number; completeness: string };
  findings: MaintenanceFinding[];
  proposedOperations: ModuleConformancePlan["proposedOperations"];
  comparison: ModuleConformancePlan["comparison"];
} {
  return {
    schemaVersion: 1,
    observedAt: plan.observation.observedAt,
    outcome: plan.outcome,
    inventory: {
      entries: plan.observation.inventory.entries.length,
      completeness:
        plan.observation.inventory.provenance?.completeness ?? "unknown",
    },
    findings: plan.findings.map(maintenanceFinding),
    proposedOperations: plan.proposedOperations,
    comparison: plan.comparison,
  };
}

function maintenanceFinding(finding: Finding): MaintenanceFinding {
  return {
    ruleId: finding.ruleId,
    status: finding.status,
    enforcement: finding.enforcement,
    path: finding.path,
    evidence: finding.evidence,
    applicability: finding.applicability,
  };
}

function maintenanceLearningUnit(
  unit: LearningMaterialsUnit,
): MaintenanceLearningUnit {
  const references = [
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
  const sourceGaps = references
    .filter(({ availability }) => availability !== "available")
    .map(
      ({ category, file, availability }) =>
        `${category}: ${file} (${availability})`,
    );
  const declaredGaps = unit.tutorials.flatMap((tutorial) =>
    tutorial.kind === "file"
      ? []
      : tutorial.sources.flatMap((source) =>
          source.declaredMissing.map(
            (missing) =>
              `tutorials: ${source.file} declares missing ${missing}`,
          ),
        ),
  );
  return {
    unit: unit.unit,
    topics: unit.topics,
    status: unit.status,
    gaps: [...sourceGaps, ...declaredGaps].slice(0, maximumPathsPerUnit),
  };
}

function domainEvidence(
  domain: MaintenanceDomainId,
  passes: number,
  findings: MaintenanceFinding[],
  imports: MaintenanceImportObservation,
  learning: LearningMaterialsAssessment,
): string[] {
  const evidence = [
    `${passes} deterministic checks passed; ${findings.length} attention findings are in this work order.`,
  ];
  if (domain === "import-health") {
    evidence.push(
      imports.available
        ? imports.roots
            .map(
              ({ destination, status, finishedAt }) =>
                `${destination}: ${status}; finished ${finishedAt ?? "none"}`,
            )
            .join("; ")
        : `Import health unavailable: ${imports.error ?? "unknown failure"}`,
    );
  }
  if (domain === "learning-sources") {
    evidence.push(
      `Learning-source assessment ${learning.outcome}: ${learning.summary.available}/${learning.summary.references} references available; ${learning.summary.missing} missing; ${learning.summary.declaredMissing} declared tutorial gaps.`,
    );
  }
  if (passes === 0 && findings.length === 0) {
    evidence.push(
      "The deterministic preflight has no finding for this domain; inspect its route and records directly.",
    );
  }
  return evidence;
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    left.ruleId.localeCompare(right.ruleId) ||
    left.path.localeCompare(right.path)
  );
}
