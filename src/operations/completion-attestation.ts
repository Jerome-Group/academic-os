import { isDeepStrictEqual } from "node:util";
import { sha256Bytes } from "../checksum.js";
import { isJsonObject } from "./json-object.js";
import type { ModuleCompletionSelector } from "./module-completion-tools.js";
import type { OperationToolResult } from "./types.js";

export function standingCompletionSource(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isJsonObject(value) &&
    Array.isArray(value.authorizations) &&
    value.authorizations.length === 0 &&
    value.policyVersion === undefined
  );
}

export function validateStandingCompletionSource(
  source: Record<string, unknown>,
  now = Date.now(),
) {
  const issued =
    typeof source.issuedAt === "string" ? Date.parse(source.issuedAt) : NaN;
  const expires =
    typeof source.validUntil === "string" ? Date.parse(source.validUntil) : NaN;
  if (
    source.schemaVersion !== 1 ||
    source.protocol !== "academic-os-planning/1" ||
    source.issuer !== "dot-cloud" ||
    !isJsonObject(source.coverage) ||
    source.coverage.complete !== true ||
    !Array.isArray(source.coverage.gaps) ||
    source.coverage.gaps.length ||
    !isJsonObject(source.policy) ||
    typeof source.maxEvidenceAgeMs !== "number" ||
    !Number.isSafeInteger(source.maxEvidenceAgeMs) ||
    source.maxEvidenceAgeMs <= 0 ||
    source.maxEvidenceAgeMs > 86400000 ||
    !Number.isFinite(issued) ||
    issued > now ||
    now - issued > source.maxEvidenceAgeMs ||
    !Number.isFinite(expires) ||
    expires <= now ||
    typeof source.coordinationDefinitionHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(source.coordinationDefinitionHash)
  )
    throw new Error("completion-source-projection-invalid");
  for (const key of ["assignments", "occurrences", "bindings", "ownerRules"])
    if (
      !Array.isArray(source.policy[key]) ||
      (source.policy[key] as unknown[]).length > 2000
    )
      throw new Error("completion-source-projection-invalid");
}

export function completionSourceContext(
  source: unknown,
  selector: ModuleCompletionSelector,
) {
  if (
    !standingCompletionSource(source) ||
    !isJsonObject(source.scope) ||
    !isDeepStrictEqual(source.scope.target, selector.target) ||
    source.scope.listId !== selector.listId ||
    !isJsonObject(source.policy)
  )
    throw new Error("completion-source-projection-required");
  validateStandingCompletionSource(source);
  const scope = source.scope;
  const policy = source.policy;
  if (
    !Array.isArray(policy.bindings) ||
    !Array.isArray(policy.occurrences) ||
    !Array.isArray(policy.assignments)
  )
    throw new Error("completion-source-projection-required");
  const bindings = policy.bindings.filter(
    (row) =>
      isJsonObject(row) &&
      isJsonObject(row.identity) &&
      row.identity.environment === scope.environment &&
      row.identity.accountId === scope.accountId &&
      row.identity.containerKind === "task-list" &&
      row.identity.containerId === selector.listId &&
      row.identity.nativeId === selector.taskId,
  );
  // Supersession is fully validated by the producer. Ambiguous history requires source clarification.
  if (
    bindings.length !== 1 ||
    !isJsonObject(bindings[0]) ||
    bindings[0].supersedes !== null
  )
    throw new Error("completion-source-binding-clarification-required");
  const occurrences = policy.occurrences.filter(
    (row) => isJsonObject(row) && row.id === bindings[0]?.occurrenceId,
  );
  if (occurrences.length !== 1 || !isJsonObject(occurrences[0]))
    throw new Error("completion-source-binding-clarification-required");
  const occurrence = occurrences[0];
  const assignments = policy.assignments.filter(
    (row) => isJsonObject(row) && row.id === occurrence.assignmentId,
  );
  if (assignments.length !== 1 || !isJsonObject(assignments[0]))
    throw new Error("completion-source-binding-clarification-required");
  const assignment = assignments[0];
  for (const value of [
    occurrence.id,
    occurrence.assignmentId,
    occurrence.name,
    occurrence.range,
    occurrence.kind,
    assignment.reference,
  ])
    if (typeof value !== "string" || value.trim() === "")
      throw new Error("completion-source-binding-clarification-required");
  return {
    target: selector.target,
    listId: selector.listId,
    taskId: selector.taskId,
    sourceVersion: sha256Bytes(Buffer.from(JSON.stringify(source))),
    sourceOccurrenceId: occurrence.id as string,
    sourceReference: assignment.reference as string,
    sourceRange: occurrence.range as string,
    source: {
      id: occurrence.id,
      occurrenceId: occurrence.id,
      assignmentId: occurrence.assignmentId,
      name: occurrence.name,
      reference: assignment.reference,
      range: occurrence.range,
      kind: occurrence.kind,
      completed: false,
    },
  };
}

export function attestedCompletionCatalog(
  source: unknown,
  selector: ModuleCompletionSelector,
  official: OperationToolResult,
  value: unknown,
  now = new Date().toISOString(),
) {
  const context = completionSourceContext(source, selector);
  const keys = [
    "schemaVersion",
    "kind",
    "attestationId",
    "agentRef",
    "ownerInstructionRef",
    "reportedAt",
    "statement",
    "target",
    "listId",
    "taskId",
    "sourceVersion",
    "sourceOccurrenceId",
    "sourceRange",
  ];
  if (
    !isJsonObject(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schemaVersion !== 1 ||
    value.kind !== "module-agent-attestation" ||
    value.statement !== "owner-explicitly-finished" ||
    ["attestationId", "agentRef", "ownerInstructionRef", "reportedAt"].some(
      (key) =>
        typeof value[key] !== "string" ||
        (value[key] as string).trim() === "" ||
        (value[key] as string).length > 4096,
    )
  )
    throw new Error("completion-explicit-owner-attestation-required");
  if (
    !isDeepStrictEqual(value.target, selector.target) ||
    value.listId !== selector.listId ||
    value.taskId !== selector.taskId ||
    value.sourceVersion !== context.sourceVersion ||
    value.sourceOccurrenceId !== context.sourceOccurrenceId ||
    value.sourceRange !== context.sourceRange
  )
    throw new Error("completion-attestation-scope-mismatch");
  const time = Date.parse(value.reportedAt as string);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== value.reportedAt ||
    time > Date.parse(now) ||
    Date.parse(now) - time > 86400000
  )
    throw new Error("completion-attestation-stale");
  if (
    !standingCompletionSource(source) ||
    typeof source.maxEvidenceAgeMs !== "number" ||
    typeof source.validUntil !== "string"
  )
    throw new Error("completion-source-projection-required");
  if (Date.parse(now) - time > source.maxEvidenceAgeMs)
    throw new Error("completion-attestation-stale");
  const report = official.report;
  const rows =
    isJsonObject(report) && Array.isArray(report.tasks)
      ? report.tasks.filter(
          (row) => isJsonObject(row) && row.taskId === selector.taskId,
        )
      : [];
  if (
    official.failed ||
    rows.length !== 1 ||
    !isJsonObject(rows[0]) ||
    rows[0].status !== "open" ||
    typeof rows[0].title !== "string"
  )
    throw new Error("completion-exact-open-task-required");
  const operationId = `attested-${sha256Bytes(Buffer.from(JSON.stringify({ selector, attestationId: value.attestationId, agentRef: value.agentRef })))}`;
  return {
    operationId,
    attestation: value,
    catalogInput: {
      ...source,
      authorizations: [
        {
          operationId,
          operation: { name: "complete" },
          taskId: selector.taskId,
          source: context.source,
          authorityRef: `module-agent-attestation:${value.attestationId}`,
          issuedAt: value.reportedAt,
          validUntil: new Date(
            Math.min(
              Date.parse(source.validUntil),
              time + source.maxEvidenceAgeMs,
            ),
          ).toISOString(),
          baseline: { title: rows[0].title, status: "open" },
        },
      ],
    },
  };
}
