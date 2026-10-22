import { planCohortAudit, type CohortSelection } from "../cohort/index.js";
import type { AcademicConfig, ConfiguredModule } from "../config/index.js";
import { auditModuleControls } from "../conformance/audit-module-controls.js";
import { readControlDocument } from "../conformance/control-document.js";
import { moduleControlPaths } from "../conformance/control-paths.js";
import type { AuditResult, Finding } from "../conformance/types.js";
import { validateDefinition } from "../conformance/validate-definition.js";
import { validateTaskRegister } from "../conformance/validate-task-register.js";
import { isRecord, nonEmptyString } from "../conformance/value-shape.js";
import { loadModuleContract } from "../contract/load-module-contract.js";
import type { ImportRootStatus } from "../imports/index.js";
import { assessLearningMaterials } from "../learning-materials/assess-learning-materials.js";
import type { LearningMaterialsAssessment } from "../learning-materials/types.js";
import {
  inspectMountedModule,
  observeModuleImportStatus,
  OperationalError,
} from "../mounted/index.js";
import type { LocalConfig, MountedAuditInputResult } from "../mounted/types.js";

type Readiness = "ready" | "attention" | "unobserved";
type ReadinessCheck<T> =
  | { kind: "observed"; status: Readiness; evidence: T }
  | {
      kind: "unavailable";
      status: "unobserved";
      error: { code: string; message: string };
    };
type ContractEvidence =
  | { kind: "loaded"; value: Awaited<ReturnType<typeof loadModuleContract>> }
  | { kind: "unavailable"; error: { code: string; message: string } };
type TaskBinding = {
  source: "local-register";
  liveFreshness: "unverified";
  validation: Finding;
} & ({ binding: "bound"; listId: string } | { binding: "unbound" | "invalid" });
type NextAction = {
  command:
    | "audit"
    | "pinned refresh"
    | "imports status"
    | "learning materials"
    | "tasks provision";
  reason: string;
};

interface ModuleReadiness {
  module: ConfiguredModule;
  outcome: Readiness;
  checks: {
    controls: ReadinessCheck<AuditResult>;
    imports: ReadinessCheck<ImportRootStatus[]>;
    learningMaterials: ReadinessCheck<LearningMaterialsAssessment>;
    tasks: ReadinessCheck<TaskBinding>;
  };
  nextActions: NextAction[];
}

export interface OfferingReadinessReport {
  schemaVersion: 1;
  mode: "offering-readiness";
  activeSemester: string;
  observedAt: string;
  maxAgeHours: number;
  evidence: "local-only";
  unverified: string[];
  outcome: Readiness;
  selection: CohortSelection;
  groups: Record<Readiness, ConfiguredModule[]>;
  modules: ModuleReadiness[];
}

export async function runOfferingReadiness(input: {
  config: AcademicConfig;
  observedAt: string;
  maxAgeHours: number;
}): Promise<OfferingReadinessReport> {
  const plan = planCohortAudit(input.config);
  let contract: ContractEvidence;
  try {
    contract = { kind: "loaded", value: await loadModuleContract() };
  } catch (error) {
    contract = { kind: "unavailable", error: failure(error) };
  }
  const modules: ModuleReadiness[] = [];
  for (const config of plan.targets) {
    const imports = await observeImports({
      config,
      observedAt: input.observedAt,
      maxAgeHours: input.maxAgeHours,
    });
    let mountedChecks: Omit<ModuleReadiness["checks"], "imports">;
    try {
      const mounted = await inspectMountedModule(config);
      mountedChecks = {
        controls: assessControls(mounted, contract),
        learningMaterials: assessMaterials(mounted),
        tasks: assessTasks(mounted),
      };
    } catch (error) {
      const unavailable = unavailableCheck(error);
      mountedChecks = {
        controls: unavailable,
        learningMaterials: unavailable,
        tasks: unavailable,
      };
    }
    const checks = { ...mountedChecks, imports };
    const outcome = readiness(
      Object.values(checks).map(({ status }) => status),
    );
    const module = { semester: config.semester, module: config.module };
    modules.push({ module, outcome, checks, nextActions: nextActions(checks) });
  }
  return {
    schemaVersion: 1,
    mode: "offering-readiness",
    activeSemester: input.config.activeSemester,
    observedAt: input.observedAt,
    maxAgeHours: input.maxAgeHours,
    evidence: "local-only",
    unverified: [
      "live Google access",
      "task freshness",
      "destination preflight",
      "learning mastery",
    ],
    outcome:
      plan.selection.unresolved.length > 0
        ? "unobserved"
        : readiness(modules.map(({ outcome }) => outcome)),
    selection: plan.selection,
    groups: {
      ready: modules
        .filter(({ outcome }) => outcome === "ready")
        .map(({ module }) => module),
      attention: modules
        .filter(({ outcome }) => outcome === "attention")
        .map(({ module }) => module),
      unobserved: modules
        .filter(({ outcome }) => outcome === "unobserved")
        .map(({ module }) => module),
    },
    modules,
  };
}

function assessControls(
  mounted: MountedAuditInputResult,
  contract: ContractEvidence,
): ReadinessCheck<AuditResult> {
  if (contract.kind === "unavailable")
    return { ...contract, status: "unobserved" };
  try {
    const evidence = auditModuleControls(
      {
        moduleCode: mounted.target.module,
        semester: mounted.target.semester,
        controls: mounted.controls,
      },
      contract.value,
    );
    const status = evidence.findings.some(
      ({ status }) => status === "manual-review",
    )
      ? "unobserved"
      : evidence.findings.every(
            ({ status }) => status === "pass" || status === "not-applicable",
          )
        ? "ready"
        : "attention";
    return { kind: "observed", status, evidence };
  } catch (error) {
    return unavailableCheck(error);
  }
}

function assessMaterials(
  mounted: MountedAuditInputResult,
): ReadinessCheck<LearningMaterialsAssessment> {
  try {
    const sourceMap = mounted.inventory.entries.some(
      ({ path, kind }) =>
        path === moduleControlPaths.sourceMap && kind === "file",
    )
      ? mounted.controls.sourceMap
      : undefined;
    const evidence = assessLearningMaterials(sourceMap, mounted.inventory);
    const status =
      evidence.outcome === "available"
        ? "ready"
        : evidence.outcome === "gaps"
          ? "attention"
          : "unobserved";
    return { kind: "observed", status, evidence };
  } catch (error) {
    return unavailableCheck(error);
  }
}

function assessTasks(
  mounted: MountedAuditInputResult,
): ReadinessCheck<TaskBinding> {
  try {
    const definition = validateDefinition(
      mounted.controls.definition,
      mounted.target.module,
      mounted.target.semester,
    );
    const source = mounted.controls.taskRegister;
    const validation = validateTaskRegister(source, definition.importerRoots);
    const base = {
      source: "local-register",
      liveFreshness: "unverified",
      validation,
    } as const;
    if (validation.status !== "pass" || source === undefined) {
      return {
        kind: "observed",
        status: "unobserved",
        evidence: { ...base, binding: "invalid" },
      };
    }
    const parsed = readControlDocument(source);
    if (!("value" in parsed) || !isRecord(parsed.value)) {
      return {
        kind: "observed",
        status: "unobserved",
        evidence: { ...base, binding: "invalid" },
      };
    }
    const listId = parsed.value.list_id;
    return nonEmptyString(listId)
      ? {
          kind: "observed",
          status: "ready",
          evidence: { ...base, binding: "bound", listId },
        }
      : {
          kind: "observed",
          status: "attention",
          evidence: { ...base, binding: "unbound" },
        };
  } catch (error) {
    return unavailableCheck(error);
  }
}

async function observeImports(input: {
  config: LocalConfig;
  observedAt: string;
  maxAgeHours: number;
}): Promise<ReadinessCheck<ImportRootStatus[]>> {
  try {
    const { roots } = await observeModuleImportStatus(input);
    return {
      kind: "observed",
      status:
        roots.length === 0 || roots.some(({ status }) => status === "invalid")
          ? "unobserved"
          : roots.every(({ status }) => status === "current")
            ? "ready"
            : "attention",
      evidence: roots,
    };
  } catch (error) {
    return unavailableCheck(error);
  }
}

function nextActions(checks: ModuleReadiness["checks"]): NextAction[] {
  const actions: NextAction[] = [];
  if (
    checks.controls.status !== "ready" ||
    checks.tasks.status === "unobserved"
  ) {
    actions.push({
      command: "audit",
      reason: "Inspect control findings before choosing repairs.",
    });
  }
  if (
    checks.controls.kind === "observed" &&
    checks.controls.evidence.findings.some(
      ({ ruleId, status }) => ruleId === "MF-AGENTS-004" && status !== "pass",
    )
  ) {
    actions.push({
      command: "pinned refresh",
      reason: "Preview replacement of stale or absent pinned controls.",
    });
  }
  if (checks.imports.status !== "ready")
    actions.push({
      command: "imports status",
      reason: "Inspect each importer root's receipt evidence.",
    });
  if (checks.learningMaterials.status !== "ready")
    actions.push({
      command: "learning materials",
      reason: "Review ordered source references and material gaps.",
    });
  if (
    checks.tasks.kind === "observed" &&
    checks.tasks.evidence.binding === "unbound"
  ) {
    actions.push({
      command: "tasks provision",
      reason: "Preview the missing local Task-list binding.",
    });
  }
  return actions;
}

function readiness(statuses: Readiness[]): Readiness {
  if (statuses.length === 0 || statuses.includes("unobserved"))
    return "unobserved";
  return statuses.includes("attention") ? "attention" : "ready";
}

function failure(error: unknown): { code: string; message: string } {
  return error instanceof OperationalError
    ? { code: error.code, message: error.message }
    : {
        code: "operational-failure",
        message:
          error instanceof Error
            ? error.message
            : "Local evidence could not be assessed.",
      };
}

function unavailableCheck(error: unknown): {
  kind: "unavailable";
  status: "unobserved";
  error: { code: string; message: string };
} {
  return { kind: "unavailable", status: "unobserved", error: failure(error) };
}
