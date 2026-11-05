import { academicOsPlanFixture } from './academic-os-plan-fixtures.mjs';

export function academicOsPlanningFixture(now = new Date().toISOString(), name = 'complete', kind = 'module') {
  const { intent, observation } = academicOsPlanFixture(name, now, kind);
  const validUntil = new Date(Date.parse(now) + 60000).toISOString();
  delete observation.policy;
  return {
    catalogInput: {
      schemaVersion: 1, protocol: 'academic-os-planning/1', issuer: 'dot-cloud',
      scope: { environment: intent.identity.environment, accountId: intent.identity.accountId, target: intent.target, listId: intent.identity.listId },
      issuedAt: intent.issuedAt, validUntil, maxEvidenceAgeMs: 60000, sourceRef: intent.sourceRef, coordinationDefinitionHash: intent.coordinationDefinitionHash,
      coverage: { complete: true, gaps: [] }, policy: intent.policy,
      authorizations: [{ operationId: intent.operationId, operation: intent.operation, source: intent.source, authorityRef: intent.authorityRef, issuedAt: intent.issuedAt, validUntil, ...(name === 'create' ? { sourceOccurrenceId: intent.identity.sourceOccurrenceId } : { taskId: intent.identity.taskId, baseline: intent.baseline }) }],
    },
    request: { operationId: intent.operationId, target: intent.target, listId: intent.identity.listId, ...(name === 'create' ? { sourceOccurrenceId: intent.identity.sourceOccurrenceId } : { taskId: intent.identity.taskId }) },
    observation, evaluatedAt: now,
  };
}
