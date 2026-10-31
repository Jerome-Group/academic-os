import { canonical, digest } from './records.mjs';
import { strictJson } from './bounded-json.mjs';
import { assessCalendarPolicy, sourceLabel } from './calendar-policy.mjs';
import { prepareAcademicOsTaskPlan, validateAcademicOsTaskPrepared, validateAcademicOsTaskIntent } from './academic-os-task-plan.mjs';

const hash = value => digest(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16384;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
const need = (condition, message) => { if (!condition) throw new Error(message); };
function shape(value, required, optional = []) {
  need(value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), 'Unsupported or missing planning catalog field');
}
function interval(value) {
  need(stamp(value.issuedAt) && stamp(value.validUntil) && Date.parse(value.issuedAt) < Date.parse(value.validUntil), 'Invalid original planning evidence interval');
}
const identityFor = (catalog, authorization) => ({ environment: catalog.scope.environment, accountId: catalog.scope.accountId, listId: catalog.scope.listId, ...(authorization.operation.name === 'create' ? { sourceOccurrenceId: authorization.sourceOccurrenceId } : { taskId: authorization.taskId }) });
const policyTimes = policy => ['assignments', 'occurrences', 'bindings', 'ownerRules'].flatMap(key => policy[key].map(row => Date.parse(row.observedAt)));

export function buildAcademicOsPlanningCatalog(input, { evaluatedAt = new Date().toISOString() } = {}) {
  shape(input, ['schemaVersion', 'protocol', 'issuer', 'scope', 'issuedAt', 'validUntil', 'maxEvidenceAgeMs', 'sourceRef', 'coordinationDefinitionHash', 'coverage', 'policy', 'authorizations']);
  need(input.schemaVersion === 1 && input.protocol === 'academic-os-planning/1' && input.issuer === 'dot-cloud' && stamp(evaluatedAt), 'Use academic-os-planning/1 with declared dot-cloud issuer');
  shape(input.scope, ['environment', 'accountId', 'target', 'listId']);
  shape(input.scope.target, ['kind', 'key', 'title']);
  need(['module', 'research-project'].includes(input.scope.target.kind) && Object.values(input.scope.target).every(text) && ['environment', 'accountId', 'listId'].every(key => text(input.scope[key])), 'Invalid exact planning scope');
  interval(input);
  need(Number.isSafeInteger(input.maxEvidenceAgeMs) && input.maxEvidenceAgeMs > 0 && input.maxEvidenceAgeMs <= 86400000 && text(input.sourceRef) && sha(input.coordinationDefinitionHash), 'Retain planning evidence and coordination definition');
  shape(input.coverage, ['complete', 'gaps']);
  need(input.coverage.complete === true && Array.isArray(input.coverage.gaps) && input.coverage.gaps.length === 0, 'Complete scoped cloud review required; partial evidence cannot become authority');
  need(Array.isArray(input.authorizations) && input.authorizations.length > 0 && input.authorizations.length <= 2000, 'Explicit operation authorizations required');
  const scope = { environment: input.scope.environment, accountId: input.scope.accountId };
  const policyFindings = assessCalendarPolicy(input.policy, input.policy, scope, [], evaluatedAt).findings;
  need(policyFindings.length === 0, `Invalid retained planning policy: ${policyFindings.map(row => row.code).join(',')}`);
  const originalTimes = [Date.parse(input.issuedAt), ...policyTimes(input.policy)];
  const ids = new Set();
  const creates = new Set();
  for (const authorization of input.authorizations) {
    shape(authorization, ['operationId', 'operation', 'source', 'authorityRef', 'issuedAt', 'validUntil'], ['taskId', 'sourceOccurrenceId', 'baseline']);
    interval(authorization);
    need(text(authorization.operationId) && authorization.operationId.length <= 200 && !ids.has(authorization.operationId) && text(authorization.authorityRef), 'Unique exact operation and particular authority evidence required');
    ids.add(authorization.operationId);
    need(Date.parse(authorization.issuedAt) <= Date.parse(evaluatedAt) && Date.parse(authorization.validUntil) > Date.parse(evaluatedAt), 'Expired or future particular operation authority');
    const create = authorization.operation?.name === 'create';
    const identity = identityFor(input, authorization);
    need(create ? text(authorization.sourceOccurrenceId) && authorization.taskId === undefined && authorization.baseline === undefined : text(authorization.taskId) && authorization.sourceOccurrenceId === undefined, 'Exact native identity required; titles are never identifiers');
    if (create) {
      need(authorization.sourceOccurrenceId === authorization.source?.occurrenceId && !creates.has(authorization.sourceOccurrenceId), 'Create occurrence identity must match one uniquely authorized source');
      creates.add(authorization.sourceOccurrenceId);
    }
    if (authorization.operation.name !== 'complete') need(sourceLabel(authorization.operation.title, authorization.source?.name), 'Source label must remain in the authorized title');
    const selector = { id: authorization.operationId, identity: { ...scope, containerKind: 'task-list', containerId: input.scope.listId, nativeId: identity.taskId ?? identity.sourceOccurrenceId }, create, source: authorization.source, changes: authorization.operation?.name === 'complete' ? { completed: true } : { title: authorization.operation?.title } };
    const findings = assessCalendarPolicy(input.policy, input.policy, scope, [selector], evaluatedAt).findings;
    need(findings.length === 0, `Operation violates retained source or owner policy: ${findings.map(row => row.code).join(',')}`);
    originalTimes.push(Date.parse(authorization.issuedAt));
    validateAcademicOsTaskIntent(intentFor(input, authorization, '0'.repeat(64)));
  }
  need(originalTimes.every(time => Number.isFinite(time) && time <= Date.parse(evaluatedAt) && Date.parse(evaluatedAt) - time <= input.maxEvidenceAgeMs) && Date.parse(input.validUntil) > Date.parse(evaluatedAt), 'Stale or future original planning evidence; export cannot renew source age');
  return { ...structuredClone(input), policyVersion: hash(input) };
}

export function validateAcademicOsPlanningCatalog(catalog, options) {
  shape(catalog, ['schemaVersion', 'protocol', 'issuer', 'scope', 'issuedAt', 'validUntil', 'maxEvidenceAgeMs', 'sourceRef', 'coordinationDefinitionHash', 'coverage', 'policy', 'authorizations', 'policyVersion']);
  const { policyVersion, ...input } = catalog;
  need(sha(policyVersion) && policyVersion === hash(input), 'Planning catalog version does not bind its exact canonical content');
  return buildAcademicOsPlanningCatalog(input, options);
}

function intentFor(catalog, authorization, expectedSnapshot) {
  const issuedAt = new Date(Math.min(Date.parse(catalog.issuedAt), Date.parse(authorization.issuedAt), ...policyTimes(catalog.policy))).toISOString();
  const expires = Math.min(Date.parse(catalog.validUntil), Date.parse(authorization.validUntil));
  const identity = identityFor(catalog, authorization);
  const effect = { operationId: authorization.operationId, target: catalog.scope.target, identity, operation: authorization.operation, source: authorization.source };
  const policyVersion = catalog.policyVersion ?? hash(catalog);
  return {
    schemaVersion: 1, operationId: authorization.operationId, issuedAt,
    maxEvidenceAgeMs: Math.min(catalog.maxEvidenceAgeMs, expires - Date.parse(issuedAt)),
    target: structuredClone(catalog.scope.target), identity, expectedSnapshot,
    operation: structuredClone(authorization.operation), ...(authorization.baseline === undefined ? {} : { baseline: structuredClone(authorization.baseline) }),
    policyDigest: policyVersion, coordinationDefinitionHash: catalog.coordinationDefinitionHash,
    planDigest: hash({ effect, expectedSnapshot, policyVersion, baseline: authorization.baseline ?? null }), operationDigest: hash(effect), effectKey: hash({ target: catalog.scope.target, identity, operation: authorization.operation }),
    sourceRef: catalog.sourceRef, authorityRef: authorization.authorityRef, source: structuredClone(authorization.source), policy: structuredClone(catalog.policy),
  };
}

export function acquireAcademicOsTaskPlan(catalog, request, observation, { evaluatedAt = new Date().toISOString() } = {}) {
  const current = validateAcademicOsPlanningCatalog(catalog, { evaluatedAt });
  shape(request, ['operationId', 'target', 'listId'], ['taskId', 'sourceOccurrenceId']);
  need(same(request.target, current.scope.target) && request.listId === current.scope.listId, 'Requested target/list is outside cloud planning scope');
  const authorization = current.authorizations.find(row => row.operationId === request.operationId);
  need(authorization && same({ ...(request.taskId === undefined ? {} : { taskId: request.taskId }), ...(request.sourceOccurrenceId === undefined ? {} : { sourceOccurrenceId: request.sourceOccurrenceId }) }, authorization.operation.name === 'create' ? { sourceOccurrenceId: authorization.sourceOccurrenceId } : { taskId: authorization.taskId }), 'No exact cloud authorization for requested operation and native identity');
  need(observation.policy === undefined, 'Acquisition supplies policy only from the configured cloud catalog');
  const result = observation.result;
  let report;
  if (result?.failed === false) report = result.report;
  else if (result?.isError === false && Array.isArray(result.content) && result.content.length === 1 && result.content[0]?.type === 'text' && typeof result.content[0].text === 'string' && result.content[0].text.length <= 32 * 1024 * 1024) {
    try { report = strictJson(result.content[0].text); } catch { report = null; }
  }
  const intent = intentFor(current, authorization, report?.execution?.expectedSnapshot);
  return { ...prepareAcademicOsTaskPlan(intent, { ...observation, policy: current.policy }, { evaluatedAt }), planningProtocol: current.protocol, policyVersion: current.policyVersion, catalogSourceRef: current.sourceRef };
}

export function discoverAcademicOsPlanningAuthorizations(catalog, selector, { evaluatedAt = new Date().toISOString() } = {}) {
  const current = validateAcademicOsPlanningCatalog(catalog, { evaluatedAt });
  shape(selector, ['target', 'listId'], ['taskId', 'sourceOccurrenceId']);
  need(same(selector.target, current.scope.target) && selector.listId === current.scope.listId && !(selector.taskId !== undefined && selector.sourceOccurrenceId !== undefined), 'Discovery selector is outside exact planning scope');
  const authorizations = current.authorizations.filter(row => (selector.taskId === undefined || selector.taskId === row.taskId) && (selector.sourceOccurrenceId === undefined || selector.sourceOccurrenceId === row.sourceOccurrenceId)).map(row => {
    const intent = intentFor(current, row, '0'.repeat(64));
    return { operationId: row.operationId, target: structuredClone(current.scope.target), listId: current.scope.listId, ...(row.operation.name === 'create' ? { sourceOccurrenceId: row.sourceOccurrenceId } : { taskId: row.taskId }), operation: structuredClone(row.operation), source: structuredClone(row.source), validUntil: new Date(Date.parse(intent.issuedAt) + intent.maxEvidenceAgeMs).toISOString() };
  });
  return { schemaVersion: 1, status: 'planning-authorizations-discovered', execution: 'none', policyVersion: current.policyVersion, authorizations, limits: ['Eligible declared authorizations still require a fresh official same-ID preflight. Catalog data does not authenticate cloud authorship or current-source selection.'] };
}

export function revalidateAcademicOsTaskPlan(catalog, prepared, observation, { evaluatedAt = new Date().toISOString() } = {}) {
  validateAcademicOsTaskPrepared(prepared);
  const current = validateAcademicOsPlanningCatalog(catalog, { evaluatedAt });
  const intent = prepared.intent;
  const authorization = current.authorizations.find(row => row.operationId === intent.operationId);
  const refusal = findings => ({ schemaVersion: 1, status: 'return-to-cloud', execution: 'none', policyVersion: current.policyVersion, prepared: structuredClone(prepared), call: null, findings });
  if (!authorization || !same(intent, intentFor(current, authorization, intent.expectedSnapshot))) return refusal(['current-cloud-planning-revision-mismatch']);
  if (Date.parse(prepared.preparedAt) > Date.parse(evaluatedAt)) return refusal(['original-prepared-packet-from-future']);
  if (Date.parse(evaluatedAt) > Date.parse(prepared.validUntil)) return refusal(['original-prepared-packet-expired']);
  need(observation.policy === undefined, 'Revalidation supplies policy only from the configured cloud catalog');
  const fresh = prepareAcademicOsTaskPlan(intent, { ...observation, policy: current.policy }, { evaluatedAt });
  if (fresh.status !== 'api-plan-ready-reported') return refusal(fresh.findings);
  need(same(fresh.prepared.apiPlan, prepared.apiPlan), 'Revalidation cannot rebase the original API plan');
  return { schemaVersion: 1, status: 'api-plan-current-reported', execution: 'none', policyVersion: current.policyVersion, prepared: structuredClone(prepared), call: null, findings: [], checkedAt: evaluatedAt, limits: ['Use only before the first provider send after recovery backup and the final snapshot. Applied or uncertain attempts must reconcile the stored original operation without another send.', 'A remote current-source check cannot prevent a later policy change before provider send. Atomic reservation or equivalent serialization belongs to the consumer transport.'] };
}
