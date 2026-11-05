const insist = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const cloudDefaults = { maxPending: 4, reservedInteractive: 1, reservedMorning: 1, maxJobs: 64, maxPayloadBytes: 65536, maxPendingBytes: 262144, maxAttempts: 3, backoffMs: 100, maxBackoffMs: 5000, maxSampleAgeMs: 30000, maxLoadPerCpu: 0.8, minFreeMemoryBytes: 67108864, minFreeDiskBytes: 16777216 };
export const cloudPriorities = ['interactive', 'morning', 'heavy'];
export function cloudConfig(value = {}) {
  insist(object(value) && Object.keys(value).every(key => Object.hasOwn(cloudDefaults, key)), 'Unknown cloud configuration');
  const config = { ...cloudDefaults, ...value };
  for (const key of ['maxPending', 'maxJobs']) insist(integer(config[key], 1, 256), `Invalid ${key}`);
  for (const key of ['reservedInteractive', 'reservedMorning']) insist(integer(config[key], 0, config.maxPending - 1), `Invalid ${key}`);
  insist(config.reservedInteractive + config.reservedMorning < config.maxPending, 'Reservations leave no heavy pending capacity');
  insist(config.maxJobs >= config.maxPending, 'maxJobs is below maxPending');
  insist(integer(config.maxPayloadBytes, 1, 65536) && integer(config.maxPendingBytes, 1, 16777216), 'Invalid cloud byte bounds');
  insist(integer(config.maxAttempts, 1, 8) && integer(config.backoffMs, 1, 60000) && integer(config.maxBackoffMs, config.backoffMs, 60000), 'Invalid retry bounds');
  insist(integer(config.maxSampleAgeMs, 1, 300000), 'Invalid sample freshness');
  insist(Number.isFinite(config.maxLoadPerCpu) && config.maxLoadPerCpu > 0 && config.maxLoadPerCpu <= 100, 'Invalid load threshold');
  for (const key of ['minFreeMemoryBytes', 'minFreeDiskBytes']) insist(integer(config[key], 0, Number.MAX_SAFE_INTEGER), `Invalid ${key}`);
  return config;
}
export function cloudJobInput(value, config) {
  insist(object(value) && Object.keys(value).every(key => ['id', 'priority', 'payload', 'units', 'transientFailures'].includes(key)), 'Invalid cloud job fields');
  insist(typeof value.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.id), 'Invalid cloud job ID');
  insist(cloudPriorities.includes(value.priority), 'Invalid cloud priority');
  insist(typeof value.payload === 'string' && Buffer.byteLength(value.payload) <= config.maxPayloadBytes, 'Cloud payload exceeds byte bound');
  insist(integer(value.units, 1, 16) && integer(value.transientFailures ?? 0, 0, 8), 'Invalid workload bounds');
  return { ...value, transientFailures: value.transientFailures ?? 0 };
}
export function parseCloudRecord(record) {
  insist(object(record) && record.schemaVersion === 1 && ['cloud-request', 'cloud-step'].includes(record.type), 'Invalid cloud record');
  insist(typeof record.responsibilityId === 'string' && /^[a-z][a-z0-9-]*$/.test(record.responsibilityId) && hash(record.definitionHash), 'Invalid cloud responsibility binding');
  insist(stamp(record.at), 'Invalid cloud record time');
  if (record.type === 'cloud-request') { cloudConfig(record.config); insist(hash(record.effectKey), 'Invalid cloud effect identity'); return record; }
  insist(hash(record.rootHash) && hash(record.parentHash) && integer(record.seq, 1, Number.MAX_SAFE_INTEGER), 'Invalid cloud lineage');
  insist(text(record.operation) && object(record.state), 'Invalid cloud transition');
  const state = record.state;
  insist(['active', 'suspended'].includes(state.lifecycle) && text(state.reason), 'Invalid cloud lifecycle');
  insist(state.epochHash === null || hash(state.epochHash), 'Invalid cloud epoch');
  insist(Array.isArray(state.jobs) && state.jobs.length <= 256 && Array.isArray(state.escalations) && state.escalations.length <= 1024, 'Invalid cloud state bounds');
  const keys = new Set();
  for (const job of state.jobs) {
    insist(object(job) && hash(job.key) && !keys.has(job.key), 'Invalid or duplicate cloud effect'); keys.add(job.key);
    cloudJobInput(job.input, cloudDefaults);
    insist(hash(job.inputDigest) && integer(job.order, 0, 255) && ['queued', 'running', 'retry-wait', 'finished', 'dead', 'unknown'].includes(job.status), 'Invalid cloud job state');
    insist(integer(job.completedUnits, 0, job.input.units) && hash(job.accumulator) && integer(job.failures, 0, 8) && stamp(job.nextEligibleAt), 'Invalid cloud checkpoint');
    insist(job.output === null || hash(job.output), 'Invalid terminal output');
    insist((job.status === 'finished') === (job.output !== null) && (job.status !== 'finished' || job.completedUnits === job.input.units), 'Invalid terminal checkpoint');
  }
  insist(state.jobs.filter(job => job.status === 'running').length <= 1, 'Multiple cooperative active jobs');
  const alerts = new Set();
  for (const entry of state.escalations) {
    insist(object(entry) && hash(entry.id) && !alerts.has(entry.id) && text(entry.code) && text(entry.scope) && stamp(entry.firstAt) && entry.delivery === 'pending', 'Invalid pending escalation'); if (entry.sourceRef !== undefined) insist(text(entry.sourceRef) && text(entry.reportedScope), 'Invalid escalation provenance'); alerts.add(entry.id);
  }
  return record;
}
export function cloudEnvelope(input) {
  insist(object(input) && input.schemaVersion === 1 && ['configure', 'submit', 'tick', 'status', 'suspend', 'resume', 'recover', 'health'].includes(input.operation), 'Invalid cloud operation');
  insist(Object.keys(input).every(key => ['schemaVersion', 'operation', 'responsibilityId', 'config', 'job', 'capacity', 'reason', 'expectedOwnerToken', 'issue'].includes(key)), 'Unknown cloud envelope field');
  insist(typeof input.responsibilityId === 'string' && /^[a-z][a-z0-9-]*$/.test(input.responsibilityId), 'Invalid cloud responsibility ID');
  if (input.operation === 'configure') cloudConfig(input.config);
  if (['suspend', 'resume'].includes(input.operation)) insist(text(input.reason), 'Cloud lifecycle change requires a reason');
  if (input.expectedOwnerToken !== undefined) insist(hash(input.expectedOwnerToken), 'Invalid turn owner token');
  if (input.capacity !== undefined) {
    const sample = input.capacity;
    insist(object(sample) && sample.synthetic === true && ['available', 'pressure', 'unknown', 'suspended', 'dead'].includes(sample.state) && stamp(sample.observedAt), 'Only explicitly synthetic capacity injection is accepted');
    insist(Object.keys(sample).every(key => ['synthetic', 'state', 'observedAt'].includes(key)), 'Unknown synthetic capacity field');
  }
  if (input.operation === 'health') insist(object(input.issue) && ['signin-blocked', 'monitor-failed', 'work-failed'].includes(input.issue.code) && text(input.issue.scope) && text(input.issue.sourceRef), 'Invalid reported health issue');
  return input;
}
