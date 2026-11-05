export function academicOsPlanFixture(name = 'change', now = new Date().toISOString(), kind = 'module') {
  const intent = {
    schemaVersion: 1, operationId: `synthetic-${kind}-${name}`, issuedAt: new Date(Date.parse(now) - 500).toISOString(), maxEvidenceAgeMs: 60000,
    target: kind === 'module' ? { kind, key: 'Y2S1/MH3210', title: 'MH3210' } : { kind, key: 'ureca', title: 'URECA' },
    identity: { environment: 'synthetic', accountId: 'owner@example.test', listId: 'list-one', ...(name === 'create' ? { sourceOccurrenceId: 'source-one-occurrence-one' } : { taskId: 'task-one' }) },
    expectedSnapshot: 'a'.repeat(64), policyDigest: 'c'.repeat(64), coordinationDefinitionHash: 'd'.repeat(64), planDigest: 'e'.repeat(64), operationDigest: 'f'.repeat(64), effectKey: '1'.repeat(64), nativeSnapshotDigest: '2'.repeat(64), preflightDigest: '4'.repeat(64), sourceRef: 'synthetic-source-file', authorityRef: 'synthetic-owner-scope-reference',
    operation: name === 'complete' ? { name } : { name, title: kind === 'module' ? 'MH3210 Handout 10' : 'URECA Y2 Q1–Q3 Hecke Worksheet', ...(name === 'create' ? { provenance: { source: 'synthetic-source-one' } } : {}) },
    ...(name === 'create' ? {} : { baseline: { title: 'Original source title', status: 'open' } }),
  };
  const observation = { environment: intent.identity.environment, accountId: intent.identity.accountId, capturedAt: new Date(Date.parse(now) - 100).toISOString(), evidenceRef: 'synthetic-official-read-result', result: { failed: false, report: {
    schemaVersion: 1, outcome: 'read', ...(kind === 'module' ? { module: { semester: 'Y2S1', module: 'MH3210' } } : { target: intent.target }),
    execution: { protocol: 'task-plan/1', target: intent.target, listId: 'list-one', expectedSnapshot: intent.expectedSnapshot, applyTool: 'tasks_apply_plan', writeArgument: 'plan_json', requiredPlanFields: ['schemaVersion', 'operationId', 'target', 'listId', 'expectedSnapshot', 'operation', 'policyVersion'], createRequires: ['sourceOccurrenceId'] },
    register: { freshness: 'fresh', listId: 'list-one', providerSnapshot: intent.expectedSnapshot, generation: 'b'.repeat(64), observedAt: new Date(Date.parse(now) - 1000).toISOString() },
    tasks: [{ title: 'Unpushed local draft', status: 'open' }, { taskId: 'task-one', title: 'Original source title', status: 'open', notes: 'synthetic-private-note-not-for-plan-output' }],
  } } };
  const scope = { environment: intent.identity.environment, accountId: intent.identity.accountId };
  const evidence = { observedAt: observation.result.report.register.observedAt, evidenceRef: 'synthetic-retained-owner-obligation' };
  intent.source = { id: 'source-one', assignmentId: 'assignment-one', occurrenceId: 'source-one-occurrence-one', name: kind === 'module' ? 'Handout 10' : 'Hecke Worksheet', reference: 'synthetic-source-file', range: 'whole source', kind: 'whole-source', completed: false };
  intent.policy = { schemaVersion: 1, scope, assignments: [{ id: 'assignment-one', reference: intent.source.reference, orderedUnits: [], ...evidence }], occurrences: [{ id: intent.source.occurrenceId, assignmentId: intent.source.assignmentId, name: intent.source.name, range: intent.source.range, kind: intent.source.kind, unitIds: [], predecessors: [], state: 'open', ...evidence }], bindings: name === 'create' ? [] : [{ identity: { ...scope, containerKind: 'task-list', containerId: intent.identity.listId, nativeId: intent.identity.taskId }, occurrenceId: intent.source.occurrenceId, supersedes: null, ...evidence }], ownerRules: [] };
  observation.policy = structuredClone(intent.policy);
  return { intent, observation, evaluatedAt: now };
}
