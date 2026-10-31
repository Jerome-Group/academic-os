import { canonical, digest } from './records.mjs';
import { strictJson } from './bounded-json.mjs';
import { assessCalendarPolicy, sourceLabel } from './calendar-policy.mjs';

const hash = value => digest(canonical(value));
const same = (a, b) => canonical(a) === canonical(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 1024) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
const need = (condition, message) => { if (!condition) throw new Error(message); };
function shape(value, required, optional = []) {
  need(object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), 'Unsupported or missing Academic OS adapter field');
}
function target(value) {
  shape(value, ['kind', 'key', 'title']);
  need(['module', 'research-project'].includes(value.kind) && text(value.key) && text(value.title), 'Invalid Academic OS target');
}
function toolResult(value) {
  if (object(value) && typeof value.failed === 'boolean' && object(value.report) && !Object.hasOwn(value, 'content') && !Object.hasOwn(value, 'isError')) return value;
  if (!object(value) || typeof value.isError !== 'boolean' || !Array.isArray(value.content) || value.content.length !== 1 || value.content[0]?.type !== 'text' || typeof value.content[0].text !== 'string' || value.content[0].text.length > 32 * 1024 * 1024 || Object.hasOwn(value, 'report') || Object.hasOwn(value, 'failed')) return null;
  try { return { failed: value.isError, report: strictJson(value.content[0].text) }; }
  catch { return null; }
}
export function validateAcademicOsTaskIntent(intent) {
  shape(intent, ['schemaVersion', 'operationId', 'issuedAt', 'maxEvidenceAgeMs', 'target', 'identity', 'expectedSnapshot', 'operation', 'policyDigest', 'coordinationDefinitionHash', 'planDigest', 'operationDigest', 'effectKey', 'sourceRef', 'authorityRef'], ['baseline', 'nativeSnapshotDigest', 'preflightDigest', 'policy', 'source']);
  need(intent.schemaVersion === 1 && text(intent.operationId, 200) && stamp(intent.issuedAt) && Number.isSafeInteger(intent.maxEvidenceAgeMs) && intent.maxEvidenceAgeMs > 0 && intent.maxEvidenceAgeMs <= 86400000, 'Invalid versioned API intent');
  target(intent.target);
  for (const key of ['expectedSnapshot', 'policyDigest', 'coordinationDefinitionHash', 'planDigest', 'operationDigest', 'effectKey']) need(sha(intent[key]), `Invalid ${key}`);
  need(intent.nativeSnapshotDigest === undefined || sha(intent.nativeSnapshotDigest), 'Invalid native snapshot association');
  need(intent.preflightDigest === undefined || sha(intent.preflightDigest), 'Invalid native preflight association');
  need(text(intent.sourceRef, 16384) && text(intent.authorityRef, 16384), 'Retain source and authority references; these do not authenticate approval');
  const create = intent.operation?.name === 'create';
  shape(intent.identity, ['environment', 'accountId', 'listId', create ? 'sourceOccurrenceId' : 'taskId']);
  need(Object.values(intent.identity).every(value => text(value)), 'Invalid exact Task identity');
  if (create) {
    shape(intent.operation, ['name', 'title'], ['provenance']);
    need(intent.baseline === undefined, 'A create has no existing native baseline');
    if (intent.operation.provenance !== undefined) {
      const keys = ['assessment', 'source', 'milestone', ...(intent.target.kind === 'research-project' ? ['claim', 'meeting', 'deliverable'] : [])];
      shape(intent.operation.provenance, [], keys);
      need(Object.values(intent.operation.provenance).every(value => text(value)), 'Invalid source provenance');
    }
  } else {
    need(['change', 'complete'].includes(intent.operation?.name), 'Only create, title change and completion are supported');
    shape(intent.operation, intent.operation.name === 'change' ? ['name', 'title'] : ['name']);
    shape(intent.baseline, ['title', 'status']);
    need(typeof intent.baseline.title === 'string' && intent.baseline.title.length <= 1024 && intent.baseline.status === 'open', 'Existing API intent requires its exact open title/status baseline');
  }
  if (intent.operation.name !== 'complete') need(text(intent.operation.title), 'A source title is required');
}
function wirePlan(intent) {
  return { schemaVersion: 1, operationId: intent.operationId, target: structuredClone(intent.target), listId: intent.identity.listId, expectedSnapshot: intent.expectedSnapshot, operation: { ...structuredClone(intent.operation), ...(intent.operation.name === 'create' ? {} : { taskId: intent.identity.taskId }) }, ...(intent.operation.name === 'create' ? { sourceOccurrenceId: intent.identity.sourceOccurrenceId } : {}), policyVersion: intent.policyDigest };
}
const limits = [
  'References, account/environment bindings, reads and reports are declared evidence, not authenticated owner approval or provider truth.',
  'The API token is not a native-window digest. Title/status baseline coverage does not establish unchanged native timing or every provider field.',
  'No call is sent, retry scheduled, credential loaded, native verified receipt created or completed effect accepted. Retain the first exact packet and original response before any separately authorized dispatch.',
];
const result = (status, findings, extra = {}) => ({ schemaVersion: 1, kind: 'academic-os-task-plan-adapter', status, execution: 'none', nativeVerified: false, completedEffectKeys: [], assurance: 'declared-api-intent-and-reported-readback', findings, ...extra, limits });

function semanticAssessment(intent, baseline, evaluatedAt) {
  const scope = { environment: intent.identity.environment, accountId: intent.identity.accountId };
  const create = intent.operation.name === 'create';
  const identity = { ...scope, containerKind: 'task-list', containerId: intent.identity.listId, nativeId: intent.identity.taskId ?? intent.identity.sourceOccurrenceId };
  const assessment = assessCalendarPolicy(intent.policy, baseline, scope, [{ id: intent.operationId, identity, create, source: intent.source, changes: intent.operation.name === 'complete' ? { completed: true } : { title: intent.operation.title } }], evaluatedAt);
  if (create && intent.source?.occurrenceId !== intent.identity.sourceOccurrenceId) assessment.findings.push({ code: 'source-occurrence-create-mismatch' });
  if (intent.operation.name !== 'complete' && intent.source && !sourceLabel(intent.operation.title, intent.source.name)) assessment.findings.push({ code: 'source-scope-missing-from-title' });
  return assessment;
}

export function prepareAcademicOsTaskPlan(intent, observation, { evaluatedAt = new Date().toISOString() } = {}) {
  validateAcademicOsTaskIntent(intent);
  shape(observation, ['environment', 'accountId', 'capturedAt', 'evidenceRef', 'result'], ['policy']);
  need(stamp(evaluatedAt) && stamp(observation.capturedAt) && text(observation.evidenceRef, 16384) && text(observation.environment) && text(observation.accountId), 'Invalid observation attribution');
  const findings = [];
  const add = code => { if (!findings.includes(code)) findings.push(code); };
  for (const row of semanticAssessment(intent, observation.policy, evaluatedAt).findings) add(row.code);
  const received = toolResult(observation.result);
  const report = received?.report;
  const execution = report?.execution;
  const register = report?.register;
  if (received?.failed !== false || report?.schemaVersion !== 1 || report.outcome !== 'read' || register?.freshness !== 'fresh' || execution?.protocol !== 'task-plan/1' || execution.applyTool !== 'tasks_apply_plan' || execution.writeArgument !== 'plan_json') add('fresh-official-task-plan-read-required');
  if (!same(execution?.target ?? null, intent.target) || report?.target !== undefined && !same(report.target, intent.target) || register?.target !== undefined && !same(register.target, intent.target)) add('target-mismatch');
  if (report?.module !== undefined && (intent.target.kind !== 'module' || `${report.module.semester}/${report.module.module}` !== intent.target.key || report.module.module !== intent.target.title)) add('target-mismatch');
  if (execution?.listId !== intent.identity.listId || register?.listId !== intent.identity.listId) add('list-mismatch');
  if (execution?.expectedSnapshot !== intent.expectedSnapshot || register?.providerSnapshot !== intent.expectedSnapshot) add('original-api-snapshot-mismatch');
  if (observation.environment !== intent.identity.environment || observation.accountId !== intent.identity.accountId) add('declared-account-binding-mismatch');
  if (!stamp(register?.observedAt) || !sha(register?.generation)) add('verified-generation-required');
  const oldest = Math.min(Date.parse(intent.issuedAt), Date.parse(register?.observedAt));
  const validUntil = Number.isFinite(oldest) ? new Date(oldest + intent.maxEvidenceAgeMs).toISOString() : null;
  if (!validUntil || Date.parse(intent.issuedAt) > Date.parse(evaluatedAt) || Date.parse(register.observedAt) > Date.parse(observation.capturedAt) || Date.parse(observation.capturedAt) > Date.parse(evaluatedAt) || Date.parse(evaluatedAt) > Date.parse(validUntil)) add('stale-or-future-api-evidence');
  let selectedTask = null;
  if (!Array.isArray(report?.tasks)) add('register-rows-required');
  else if (intent.operation.name !== 'create') {
    const matches = report.tasks.filter(row => row?.taskId === intent.identity.taskId);
    if (matches.length !== 1) add('exact-task-row-required');
    else {
      selectedTask = { taskId: matches[0].taskId, title: matches[0].title, status: matches[0].status };
      if (!same({ title: selectedTask.title, status: selectedTask.status }, intent.baseline)) add('original-task-baseline-changed');
      if (selectedTask.status !== 'open') add('terminal-or-unknown-task-status');
    }
  }
  if (findings.length) return result('return-to-cloud', findings, { intent: structuredClone(intent), call: null, prepared: null });
  const binding = { environment: observation.environment, accountId: observation.accountId, evidenceRef: observation.evidenceRef, capturedAt: observation.capturedAt, observedAt: register.observedAt, generation: register.generation, target: structuredClone(execution.target), listId: execution.listId, expectedSnapshot: execution.expectedSnapshot, selectedTask, policy: structuredClone(observation.policy) };
  const body = { schemaVersion: 1, intent: structuredClone(intent), binding, preparedAt: evaluatedAt, validUntil, apiPlan: wirePlan(intent) };
  const prepared = { ...body, preparedDigest: hash(body) };
  return result('api-plan-ready-reported', [], { prepared, call: { tool: 'tasks_apply_plan', arguments: { plan_json: canonical(prepared.apiPlan) } } });
}

export function validateAcademicOsTaskPrepared(prepared) {
  shape(prepared, ['schemaVersion', 'intent', 'binding', 'preparedAt', 'validUntil', 'apiPlan', 'preparedDigest']);
  const { preparedDigest, ...body } = prepared;
  validateAcademicOsTaskIntent(prepared.intent);
  const intent = prepared.intent;
  const binding = prepared.binding;
  shape(binding, ['environment', 'accountId', 'evidenceRef', 'capturedAt', 'observedAt', 'generation', 'target', 'listId', 'expectedSnapshot', 'selectedTask', 'policy']);
  need(semanticAssessment(intent, binding.policy, prepared.preparedAt).findings.length === 0, 'Original API semantic policy is missing or changed');
  need(prepared.schemaVersion === 1 && sha(preparedDigest) && preparedDigest === hash(body) && same(prepared.apiPlan, wirePlan(intent)) && stamp(prepared.preparedAt) && stamp(prepared.validUntil) && stamp(binding.observedAt) && stamp(binding.capturedAt) && sha(binding.generation) && text(binding.evidenceRef, 16384), 'Changed or invalid original API packet');
  const expiry = Math.min(Date.parse(intent.issuedAt), Date.parse(binding.observedAt)) + intent.maxEvidenceAgeMs;
  need(Date.parse(prepared.validUntil) === expiry && Date.parse(prepared.preparedAt) <= expiry && Date.parse(binding.observedAt) <= Date.parse(binding.capturedAt) && Date.parse(binding.capturedAt) <= Date.parse(prepared.preparedAt) && Date.parse(intent.issuedAt) <= Date.parse(prepared.preparedAt) && binding.environment === intent.identity.environment && binding.accountId === intent.identity.accountId && binding.listId === intent.identity.listId && binding.expectedSnapshot === intent.expectedSnapshot && same(binding.target, intent.target), 'Changed API snapshot, account or expiry binding');
  need(intent.operation.name === 'create' ? binding.selectedTask === null : same(binding.selectedTask, { taskId: intent.identity.taskId, ...intent.baseline }), 'Changed original exact Task baseline');
  return prepared;
}

export function assessAcademicOsTaskResult(prepared, receipt, { evaluatedAt = new Date().toISOString() } = {}) {
  validateAcademicOsTaskPrepared(prepared);
  const intent = prepared.intent;
  const expiry = Date.parse(prepared.validUntil);
  shape(receipt, ['attemptedAt', 'observedAt', 'evidenceRef'], ['report', 'isError', 'transportError', 'result']);
  need(stamp(evaluatedAt) && stamp(receipt.attemptedAt) && stamp(receipt.observedAt) && text(receipt.evidenceRef, 16384) && Date.parse(receipt.observedAt) >= Date.parse(receipt.attemptedAt) && Date.parse(receipt.observedAt) <= Date.parse(evaluatedAt) && ['report', 'result', 'transportError'].filter(key => receipt[key] !== undefined).length === 1 && (receipt.isError === undefined || typeof receipt.isError === 'boolean') && (receipt.transportError === undefined || text(receipt.transportError, 16384)), 'Invalid original operation receipt');
  const findings = [];
  const received = receipt.result === undefined ? null : toolResult(receipt.result);
  const report = receipt.report ?? received?.report;
  const isError = receipt.isError ?? received?.failed;
  const full = object(report) && report.schemaVersion === 1 && report.operationId === intent.operationId && ['applied', 'conflict', 'uncertain', 'failed'].includes(report.outcome) && (report.taskId === null || text(report.taskId)) && typeof report.registerFresh === 'boolean' && (report.code === undefined || text(report.code));
  if (Date.parse(receipt.attemptedAt) < Date.parse(prepared.preparedAt) || Date.parse(receipt.attemptedAt) > expiry) findings.push('attempt-outside-original-preflight-window');
  if (!full) findings.push(receipt.transportError === undefined ? 'unknown-or-uncorrelated-api-report' : 'transport-outcome-unknown');
  if (full && intent.operation.name !== 'create' && report.taskId !== null && report.taskId !== intent.identity.taskId) findings.push('response-task-identity-mismatch');
  if (report?.outcome === 'applied' && (!text(report.taskId) || report.registerFresh !== true || isError === true || report.code !== undefined || receipt.isError !== undefined && received && receipt.isError !== received.failed)) findings.push('contradictory-api-applied-report');
  if (intent.operation.name === 'create' && report?.taskId === null && report?.outcome === 'uncertain') findings.push('unknown-create-outcome');
  const applied = full && report.outcome === 'applied' && findings.length === 0;
  const status = applied ? 'api-applied-reported' : full && report.outcome === 'conflict' && findings.length === 0 ? 'return-to-cloud' : 'reconcile-original-operation';
  return result(status, findings, { prepared: structuredClone(prepared), call: null, reportEvidence: { attemptedAt: receipt.attemptedAt, observedAt: receipt.observedAt, evidenceRef: receipt.evidenceRef, responseDigest: hash(receipt), outcome: typeof report?.outcome === 'string' ? report.outcome : null, operationId: typeof report?.operationId === 'string' ? report.operationId : null, taskId: typeof report?.taskId === 'string' ? report.taskId : null, registerFresh: typeof report?.registerFresh === 'boolean' ? report.registerFresh : null, code: typeof report?.code === 'string' ? report.code : null, transportError: receipt.transportError ?? null }, next: applied ? 'Retain API-only evidence; native timing, source learning and root acceptance remain separate.' : 'Retain the original packet and response. Return conflicts to cloud; reconcile unknown effects under this same operation ID without another write or title-based matching.' });
}
