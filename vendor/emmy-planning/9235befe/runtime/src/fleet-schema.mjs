import { morningInput, deliveryInput } from './morning.mjs';
export const insist = (ok, message) => { if (!ok) throw new Error(message); };
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function shape(value, fields, name) { insist(object(value) && Object.keys(value).every(key => fields.includes(key)), `Invalid ${name} fields`); }
export const conditions = ['healthy', 'login-expired', 'denied-action', 'unavailable-tool', 'timeout', 'stale-source', 'resource-pressure', 'monitoring-failed', 'workflow-failed', 'suspended', 'unknown', 'pending', 'recovered'];
export const priorities = ['interactive', 'morning', 'heavy'];
export const defaults = { maxPending: 4, maxJobs: 64, maxEntities: 64, maxAlerts: 1024, maxAttempts: 3, retryMs: 1000, attemptMs: 300000, maxAgeMs: 300000, maxRequestBytes: 16384, maxPendingBytes: 65536 };
export function fleetConfig(value = {}) {
  shape(value, Object.keys(defaults), 'fleet configuration'); const config = { ...defaults, ...value };
  for (const key of ['maxPending', 'maxJobs', 'maxEntities', 'maxAlerts']) insist(integer(config[key], key === 'maxPending' ? 3 : 1, defaults[key]), `Invalid ${key}`);
  insist(config.maxJobs >= config.maxPending, 'Invalid fleet queue capacity');
  insist(integer(config.maxAttempts, 1, 3) && integer(config.retryMs, 1, 60000) && integer(config.attemptMs, 1, 300000) && integer(config.maxAgeMs, 1, 86400000), 'Invalid fleet time or retry bound');
  for (const key of ['maxRequestBytes', 'maxPendingBytes']) insist(integer(config[key], 1, defaults[key]), `Invalid ${key}`);
  return config;
}
export function entityInput(value) {
  shape(value, ['id', 'kind', 'scope', 'maxAgeMs', 'monitorId', 'requiresDelivery', 'dueAt', 'occurrenceId', 'expectedDigest', 'expectedRevision'], 'fleet entity');
  insist(id(value.id) && ['repository', 'installed', 'native-job', 'cloud-job', 'schedule', 'authentication', 'monitor'].includes(value.kind), 'Invalid fleet entity identity');
  shape(value.scope, ['service', 'account', 'environment', 'surface', 'resource'], 'entity scope');
  for (const key of ['service', 'environment', 'surface', 'resource']) insist(text(value.scope[key]), `Missing scope ${key}`);
  insist(['repository', 'installed', 'native', 'cloud', 'schedule', 'browser', 'connector'].includes(value.scope.surface), 'Invalid source surface');
  if (value.scope.account !== undefined) insist(text(value.scope.account), 'Invalid expected account');
  if (value.kind === 'authentication') insist(text(value.scope.account) && ['browser', 'connector'].includes(value.scope.surface), 'Authentication requires exact account and surface');
  if (value.maxAgeMs !== undefined) insist(integer(value.maxAgeMs, 1, 86400000), 'Invalid entity age');
  if (value.monitorId !== undefined) insist(id(value.monitorId) && value.monitorId !== value.id, 'Invalid monitor binding');
  insist(value.kind !== 'monitor' || value.monitorId === undefined, 'A monitor cannot depend on another monitor');
  if (value.requiresDelivery !== undefined) insist(typeof value.requiresDelivery === 'boolean', 'Invalid delivery requirement');
  if (value.dueAt !== undefined) insist(stamp(value.dueAt), 'Invalid due time');
  if (value.occurrenceId !== undefined) insist(text(value.occurrenceId) && stamp(value.dueAt), 'Occurrence identity requires an explicit due time');
  if (value.expectedDigest !== undefined) insist(['repository', 'installed'].includes(value.kind) && hash(value.expectedDigest), 'Invalid expected source digest');
  if (value.expectedRevision !== undefined) insist(['repository', 'installed'].includes(value.kind) && /^[a-f0-9]{40}$/.test(value.expectedRevision), 'Invalid expected source revision');
  return value;
}
export function receiptInput(value) {
  shape(value, ['sourceRef', 'sha256', 'observedAt', 'capturedAt', 'observer', 'coverage', 'scope'], 'receipt');
  insist(text(value.sourceRef) && hash(value.sha256) && stamp(value.observedAt) && stamp(value.capturedAt) && text(value.observer), 'Invalid receipt attribution');
  shape(value.coverage, ['complete', 'gaps'], 'receipt coverage');
  insist(typeof value.coverage.complete === 'boolean' && Array.isArray(value.coverage.gaps) && value.coverage.gaps.length <= 64 && value.coverage.gaps.every(text) && (!value.coverage.complete || value.coverage.gaps.length === 0), 'Invalid receipt coverage');
  shape(value.scope, ['service', 'account', 'environment', 'surface', 'resource'], 'receipt scope');
  for (const key of ['service', 'environment', 'surface', 'resource']) insist(text(value.scope[key]), `Missing receipt scope ${key}`);
  if (value.scope.account !== undefined) insist(text(value.scope.account), 'Invalid receipt account');
  return value;
}
export function captureInput(value, semanticsVersion = 1) {
  shape(value, ['entityId', 'condition', 'issueKey', 'nextAction', 'receipt', 'execution', 'enabled', 'runRef', 'runDueAt', 'outcomeRef', 'deliveryRef', 'protectedContent', 'authResponse', 'actualDigest', 'actualRevision', ...(semanticsVersion === 2 ? ['actionIdentity', 'invocation'] : [])], 'capture');
  insist(id(value.entityId) && conditions.includes(value.condition) && !['recovered', 'stale-source'].includes(value.condition) && text(value.issueKey) && text(value.nextAction), 'Invalid capture condition');
  receiptInput(value.receipt);
  if (semanticsVersion === 2) {
    shape(value.actionIdentity, ['kind', 'target'], 'action identity');
    insist(id(value.actionIdentity.kind) && text(value.actionIdentity.target), 'Invalid structured action identity');
    if (value.invocation !== undefined) {
      shape(value.invocation, ['origin', 'occurrenceId'], 'invocation');
      insist(['scheduled', 'manual', 'unknown'].includes(value.invocation.origin), 'Invalid invocation origin');
      insist(value.invocation.origin === 'scheduled' ? text(value.invocation.occurrenceId) : value.invocation.occurrenceId === undefined, 'Scheduled invocation requires exact occurrence identity');
    }
  }
  if (value.execution !== undefined) insist(['configured', 'running', 'completed', 'suspended', 'unknown'].includes(value.execution), 'Invalid execution state');
  for (const key of ['enabled', 'protectedContent']) if (value[key] !== undefined) insist(typeof value[key] === 'boolean', `Invalid ${key}`);
  for (const key of ['runRef', 'outcomeRef', 'deliveryRef', 'authResponse']) if (value[key] !== undefined) insist(text(value[key]), `Invalid ${key}`);
  if (value.runDueAt !== undefined) insist(stamp(value.runDueAt), 'Invalid declared run window');
  if (value.actualDigest !== undefined) insist(hash(value.actualDigest), 'Invalid actual source digest');
  if (value.actualRevision !== undefined) insist(/^[a-f0-9]{40}$/.test(value.actualRevision), 'Invalid actual source revision');
  insist(value.condition !== 'login-expired' || text(value.authResponse), 'Expired login needs an attributable authentication response');
  return value;
}
export function jobInput(value, config) {
  shape(value, ['id', 'kind', 'occurrence', 'priority', 'entityIds', 'purpose', 'maxReads', 'maxBytes', 'steps'], 'parent job');
  insist(id(value.id) && ['health-read', 'briefing-source-read'].includes(value.kind) && text(value.occurrence) && priorities.includes(value.priority) && text(value.purpose), 'Invalid parent job identity');
  insist(Array.isArray(value.entityIds) && value.entityIds.length > 0 && value.entityIds.length <= config.maxEntities && value.entityIds.every(id) && new Set(value.entityIds).size === value.entityIds.length, 'Invalid parent read scopes');
  insist(integer(value.maxReads, 1, 32) && integer(value.maxBytes, 1, 262144) && integer(value.steps, 1, Math.min(16, value.maxReads)), 'Invalid parent read budget');
  insist(Buffer.byteLength(JSON.stringify(value)) <= config.maxRequestBytes, 'Parent request exceeds byte bound');
  return value;
}
export function actionInput(value, semanticsVersion = 1) {
  const fields = { upgrade: ['semanticsVersion', 'stateDigest', 'sourceRef', 'reason'], archive: ['stateDigest', 'jobKeys', 'runIds', 'alertIds', 'groupSendRefs', 'entityIds', 'policyHistory', 'sourceRef', 'reason'], morning: ['command'], 'policy-revise': ['version', 'previousDigest', 'maxAgeMs', 'entities', 'sourceRef', 'reason'], 'group-send-intent': ['alertIds', 'bodyDigest', 'sendRef', 'delivery'], 'group-send-ack': ['alertIds', 'bodyDigest', 'sendRef', 'readbackRef', 'deliveredBodyDigest', 'nativeId', 'scope', 'acquiredAt'], 'group-send-resolve': ['alertIds', 'bodyDigest', 'sendRef', 'sourceRef', 'reason', 'outcome', 'scope', 'acquiredAt'], configure: ['config', 'entities', 'semanticsVersion'], inventory: ['entities', 'sourceRef', 'reason'], assess: ['captures'], submit: ['job'], claim: ['ownerRef'], result: ['jobKey', 'ticket', 'checkpoint', 'outcome', 'receipt', 'usage', 'reason', 'sourceRef', 'failure'], resolve: ['jobKey', 'ticket', 'checkpoint', 'outcome', 'receipt', 'usage', 'reason', 'sourceRef', 'failure'], dismiss: ['alertId', 'sourceRef', 'reason'], correct: ['entityId', 'sourceRef', 'reason'], 'send-intent': ['alertId', 'bodyDigest', 'sendRef'], 'send-ack': ['alertId', 'bodyDigest', 'sendRef', 'readbackRef'], 'send-resolve': ['alertId', 'bodyDigest', 'sendRef', 'sourceRef', 'reason', 'outcome'], suspend: ['sourceRef', 'reason'], resume: ['sourceRef', 'reason'], status: [] };
  insist(object(value) && Object.hasOwn(fields, value.operation), 'Invalid fleet operation'); shape(value, ['operation', ...fields[value.operation]], 'fleet action');
  if (value.operation === 'upgrade') insist(value.semanticsVersion === 2 && hash(value.stateDigest) && text(value.sourceRef) && text(value.reason), 'Upgrade requires version two, exact predecessor and attributable source');
  if (value.operation === 'configure') {
    insist(value.semanticsVersion === undefined || value.semanticsVersion === 2, 'Unsupported fleet semantics version');
  }
  if (value.operation === 'archive') {
    insist(hash(value.stateDigest) && text(value.sourceRef) && text(value.reason), 'Archival requires exact state digest and attributable reason');
    for (const [field, valid, limit] of [['jobKeys', hash, 64], ['runIds', text, 32], ['alertIds', hash, 1024], ['groupSendRefs', text, 1024], ['entityIds', id, 64]]) {
      if (value[field] !== undefined) insist(Array.isArray(value[field]) && value[field].length <= limit && value[field].every(valid) && new Set(value[field]).size === value[field].length, `Invalid archive ${field}`);
    }
    if (value.policyHistory !== undefined) insist(typeof value.policyHistory === 'boolean', 'Invalid archive policy history');
    insist(['jobKeys', 'runIds', 'alertIds', 'groupSendRefs', 'entityIds'].some(field => value[field]?.length) || value.policyHistory === true, 'Empty archive selection');
  }
  if (value.operation === 'morning') morningInput(value.command);
  if (value.operation === 'policy-revise') {
    insist(integer(value.version, 1, 1024) && (value.previousDigest === null || hash(value.previousDigest)) && integer(value.maxAgeMs, 1, 86400000) && text(value.sourceRef) && text(value.reason), 'Invalid audited policy revision');
    insist(Array.isArray(value.entities) && value.entities.length > 0 && value.entities.length <= defaults.maxEntities && new Set(value.entities.map(row => row.entityId)).size === value.entities.length, 'Invalid policy scope set');
    for (const row of value.entities) { shape(row, ['entityId', 'scope', 'maxAgeMs'], 'policy scope'); insist(id(row.entityId) && object(row.scope) && integer(row.maxAgeMs, 1, value.maxAgeMs), 'Invalid policy scope window'); }
  }
  if (value.operation === 'group-send-intent' && value.delivery) deliveryInput(value.delivery);
  if (value.operation.startsWith('group-send-')) {
    insist(Array.isArray(value.alertIds) && value.alertIds.length > 0 && value.alertIds.length <= 64 && value.alertIds.every(hash) && new Set(value.alertIds).size === value.alertIds.length && hash(value.bodyDigest) && text(value.sendRef), 'Invalid atomic alert group');
    if (value.operation === 'group-send-ack') insist(text(value.readbackRef) && hash(value.deliveredBodyDigest) && text(value.nativeId), 'Group delivery requires separate readback');
    if (value.operation === 'group-send-resolve') insist(value.outcome === 'known-unexecuted' && text(value.sourceRef) && text(value.reason), 'Group uncertainty requires no-effect reconciliation');
  }
  if (['configure', 'inventory'].includes(value.operation)) {
    if (semanticsVersion === 2 || value.semanticsVersion === 2) for (const entity of value.entities ?? []) insist((!entity.dueAt && entity.kind !== 'schedule') || stamp(entity.dueAt) && text(entity.occurrenceId), 'Expected run requires explicit occurrence identity and due time');
    const config = fleetConfig(value.operation === 'configure' ? value.config : {}); insist(Array.isArray(value.entities) && value.entities.length > 0 && value.entities.length <= config.maxEntities, 'Invalid inventory bound'); value.entities.forEach(entityInput);
    insist(new Set(value.entities.map(entity => entity.id)).size === value.entities.length, 'Duplicate entity');
    if (value.operation === 'configure') for (const entity of value.entities) { insist((entity.maxAgeMs ?? config.maxAgeMs) <= config.maxAgeMs, 'Entity age cannot weaken configured freshness'); if (entity.monitorId) insist(value.entities.some(monitor => monitor.id === entity.monitorId && monitor.kind === 'monitor'), 'Unknown monitor'); }
  }
  if (value.operation === 'assess') { insist(Array.isArray(value.captures) && value.captures.length <= defaults.maxEntities && new Set(value.captures.map(capture => capture.entityId)).size === value.captures.length, 'Invalid capture set'); value.captures.forEach(capture => captureInput(capture, semanticsVersion)); }
  if (value.operation === 'submit') jobInput(value.job, defaults);
  if (['result', 'resolve'].includes(value.operation)) { insist(hash(value.jobKey) && hash(value.ticket), 'Invalid parent result binding'); receiptInput(value.receipt); insist(integer(value.checkpoint, 0, 16), 'Invalid parent checkpoint'); shape(value.usage, ['reads', 'bytes', 'knownBytesLowerBound'], 'parent usage'); insist(integer(value.usage.reads, 0, 32), 'Invalid cumulative attempt reads');
    if (value.usage.bytes === null) { shape(value.failure, ['kind', 'sourceRef', 'sha256', 'reason'], 'known-ended read failure'); insist(value.outcome === 'blocked' && value.failure.kind === 'read-only-known-ended' && text(value.failure.sourceRef) && hash(value.failure.sha256) && text(value.failure.reason) && integer(value.usage.knownBytesLowerBound, 0, 262144), 'Unknown bytes require an attributable blocked read-only-known-ended failure'); }
    else insist(value.failure === undefined && value.usage.knownBytesLowerBound === undefined && integer(value.usage.bytes, 1, 262144), 'Invalid cumulative attempt usage'); }
  if (value.operation === 'result') insist(['completed', 'checkpoint', 'known-unexecuted', 'uncertain', 'blocked'].includes(value.outcome), 'Invalid parent outcome');
  if (value.operation === 'resolve') insist(['completed', 'checkpoint', 'known-unexecuted', 'blocked'].includes(value.outcome) && text(value.reason), 'Invalid reconciliation');
  if (['inventory', 'dismiss', 'correct', 'suspend', 'resume'].includes(value.operation)) insist(text(value.sourceRef) && text(value.reason), 'A scoped source and reason are required');
  if (value.operation === 'dismiss') insist(hash(value.alertId), 'Invalid dismissed episode');
  if (value.operation === 'correct') insist(id(value.entityId), 'Invalid correction scope');
  if (['send-intent', 'send-ack', 'send-resolve'].includes(value.operation)) insist(hash(value.alertId) && hash(value.bodyDigest) && text(value.sendRef), 'Invalid send binding');
  if (value.operation === 'send-ack') insist(text(value.readbackRef), 'Delivery requires separate parent readback');
  if (value.operation === 'send-resolve') insist(value.outcome === 'known-unexecuted' && text(value.sourceRef) && text(value.reason), 'Uncertain delivery requires attributable no-effect reconciliation');
  if (value.operation === 'claim') insist(text(value.ownerRef), 'Admission requires a parent owner reference');
  return value;
}
export function parseFleetRecord(record) {
  insist(record.schemaVersion === 1 && ['fleet-root', 'fleet-step'].includes(record.type) && id(record.responsibilityId) && hash(record.definitionHash) && hash(record.effectKey) && hash(record.requestDigest) && stamp(record.at), 'Invalid fleet record');
  insist(record.epochHash === null || hash(record.epochHash), 'Invalid fleet epoch');
  if (record.type === 'fleet-root') { insist(record.action.operation === 'configure', 'Invalid fleet root'); actionInput(record.action); }
  else { insist(hash(record.rootHash) && hash(record.parentHash) && integer(record.seq, 1, Number.MAX_SAFE_INTEGER) && hash(record.requestDigest) && object(record.state), 'Invalid fleet lineage'); actionInput(record.action, record.state.semanticsVersion ?? 1); insist(!['configure', 'status'].includes(record.action.operation), 'Invalid fleet step action'); }
  return record;
}
