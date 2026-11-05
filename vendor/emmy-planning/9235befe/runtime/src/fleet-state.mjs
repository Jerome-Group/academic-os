import { morningTransition, morningView, deliveryReadback } from './morning.mjs';
import { canonical, digest } from './records.mjs';
import { actionInput, fleetConfig, insist, jobInput, priorities } from './fleet-schema.mjs';

const unfinished = job => !['completed', 'dead', 'blocked'].includes(job.status);
const bad = condition => !['healthy', 'recovered'].includes(condition);
export function fleetInitial(root) {
  const state = { lifecycle: 'active', epochHash: root.epochHash, entities: root.action.entities.map(expected => ({ expected, capture: null, condition: 'unknown', issueKey: 'not-checked', episode: 0, fingerprint: null, alertId: null, corrections: [] })), jobs: [], alerts: [] };
  if (root.action.semanticsVersion === 2) state.semanticsVersion = 2;
  insist(Buffer.byteLength(canonical(state)) <= 1048576, 'Fleet state retention byte bound reached'); return state;
}
export function captureCondition(entity, capture, state, config, at) {
  const ageMs = capture ? Date.parse(at) - Date.parse(capture.receipt.observedAt) : null;
  const result = (condition, issueKey, nextAction) => ({ condition, issueKey, nextAction, ageMs, ...(state.semanticsVersion === 2 ? { actionIdentity: condition === capture?.condition && issueKey === capture?.issueKey && capture.actionIdentity ? capture.actionIdentity : { kind: 'inspect', target: `${entity.expected.id}/${issueKey}` } } : {}) });
  if (!capture) return result('unknown', 'not-checked', 'Parent must acquire a fresh scoped read and retain its receipt.');
  const receipt = capture.receipt;
  if (state.resumedAt && Date.parse(receipt.observedAt) < Date.parse(state.resumedAt)) return result('unknown', 'restore-needs-fresh-read', 'Parent must reacquire this exact source after resume.');
  if (Date.parse(receipt.capturedAt) > Date.parse(at) || ageMs < 0 || Date.parse(receipt.observedAt) > Date.parse(receipt.capturedAt)) return result('unknown', 'future-source', 'Reacquire source timestamps in the actual executor.');
  if (ageMs > Math.min(state.policy?.entities.find(row => row.entityId === entity.expected.id)?.maxAgeMs ?? entity.expected.maxAgeMs ?? config.maxAgeMs, entity.expected.maxAgeMs ?? 86400000)) return result('stale-source', 'source-age', 'Parent must refresh this source in its actual environment.');
  if (bad(capture.condition)) return result(capture.condition, capture.issueKey, capture.nextAction);
  if (!receipt.coverage.complete || receipt.coverage.gaps.length) return result('unknown', 'coverage-gap', 'Parent must obtain complete scoped coverage or retain the exact gap.');
  const identity = [['expectedDigest', 'actualDigest'], ['expectedRevision', 'actualRevision']].filter(([expected]) => entity.expected[expected]);
  if (['repository', 'installed'].includes(entity.expected.kind) && identity.length === 0) return result('unknown', 'expected-source-identity-needed', 'Parent must bind the intended published revision or installed artifact digest.');
  if (identity.some(([, actual]) => !capture[actual])) return result('unknown', 'source-identity-needed', 'Parent must retain actual source bytes or the current repository revision.');
  if (identity.some(([expected, actual]) => entity.expected[expected] !== capture[actual])) return result('stale-source', 'source-identity-drift', 'Parent must reconcile published and installed source identity before claiming current guidance.');
  if (entity.expected.monitorId) {
    const monitor = state.entities.find(row => row.expected.id === entity.expected.monitorId);
    const monitored = captureCondition(monitor, monitor.capture, state, config, at);
    if (bad(monitored.condition)) return result('unknown', 'monitor-unavailable', 'Restore the monitor and reacquire this source.');
  }
  if (entity.expected.kind === 'authentication' && capture.protectedContent !== true) return result('unknown', 'protected-content-unverified', 'Verify protected same-account content through this exact browser or connector.');
  if (capture.enabled === false) return result(entity.expected.kind === 'monitor' ? 'monitoring-failed' : 'workflow-failed', 'disabled-run', 'Parent must inspect the disabled schedule and obtain scoped owner direction.');
  if (state.semanticsVersion === 2 && (entity.expected.dueAt || entity.expected.kind === 'schedule')) {
    if (!entity.expected.occurrenceId || !capture.invocation || capture.invocation.origin === 'unknown') return result('unknown', 'invocation-origin-unverified', 'Retain actual scheduled invocation provenance for this exact occurrence.');
    if (capture.invocation.origin === 'manual') return result('workflow-failed', 'manual-run-only', 'Retain this manual rescue separately and inspect the expected scheduled occurrence.');
    if (capture.invocation.occurrenceId !== entity.expected.occurrenceId) return result('workflow-failed', 'occurrence-mismatch', 'Acquire the actual invocation for this exact expected occurrence.');
  }
  if (entity.expected.dueAt && Date.parse(at) > Date.parse(entity.expected.dueAt)) {
    if (Date.parse(receipt.observedAt) < Date.parse(entity.expected.dueAt)) return result('unknown', 'post-window-coverage-needed', 'Acquire a complete read after the expected run window.');
    if (!capture.runRef || capture.runDueAt !== entity.expected.dueAt) return result(entity.expected.kind === 'monitor' ? 'monitoring-failed' : 'workflow-failed', 'missed-run', 'Parent must inspect this exact expected run window and retain its actual outcome.');
  }
  if (capture.execution === 'configured') return result('pending', 'configuration-only', 'Parent must inspect actual execution and outcome receipts.');
  if (capture.execution === 'suspended' || capture.execution === 'unknown') return result(capture.execution, 'execution-unverified', 'Inspect executor state. A live PID or quiet stdout does not establish progress or failure.');
  if ((capture.execution === 'completed' || capture.runRef) && !capture.outcomeRef) return result('workflow-failed', 'outcome-missing', 'Parent must inspect the actual result. Completed execution does not establish delivery.');
  if (entity.expected.requiresDelivery && !capture.deliveryRef) return result('workflow-failed', 'delivery-unverified', 'Parent must inspect the delivered artifact and its native readback.');
  return result('healthy', 'current', capture.nextAction);
}
function addAlert(state, scope, condition, issueKey, nextAction, at, episode, receipt = null, actionIdentity = null) {
  const id = digest({ scope, condition, issueKey, episode });
  if (!state.alerts.some(alert => alert.id === id)) state.alerts.push({ id, scope, condition, issueKey, nextAction, episode, firstAt: at, receipt, ...(actionIdentity ? { actionIdentity } : {}), disposition: null, delivery: 'pending', bodyDigest: null, sendRef: null, readbackRef: null });
  return id;
}
const fingerprintOf = (current, version) => digest(version === 2 ? { condition: current.condition, issueKey: current.issueKey, actionIdentity: current.actionIdentity } : { condition: current.condition, issueKey: current.issueKey, nextAction: current.nextAction });
const recoveryBaseline = (entity, at) => ({ alertId: entity.alertId, at, observedAt: entity.capture?.receipt.observedAt ?? null, receiptDigest: entity.capture ? digest(entity.capture.receipt) : null });
function evaluate(state, root, at, freshIds = []) {
  const config = fleetConfig(root.action.config);
  for (const entity of state.entities) {
    const current = captureCondition(entity, entity.capture, state, config, at);
    const fingerprint = fingerprintOf(current, state.semanticsVersion);
    if (state.semanticsVersion === 2) {
      if (bad(current.condition)) {
        if (fingerprint !== entity.fingerprint) {
          entity.episode++; entity.alertId = addAlert(state, entity.expected.id, current.condition, current.issueKey, current.nextAction, at, entity.episode, entity.capture?.receipt ?? null, current.actionIdentity);
          entity.recoveryPending = recoveryBaseline(entity, at);
        }
      } else if (entity.recoveryPending && freshIds.includes(entity.expected.id)) {
        const pending = entity.recoveryPending; const receipt = entity.capture.receipt;
        if (Date.parse(receipt.observedAt) >= Date.parse(pending.at) && (!pending.observedAt || Date.parse(receipt.observedAt) > Date.parse(pending.observedAt)) && digest(receipt) !== pending.receiptDigest) {
          entity.episode++; entity.alertId = addAlert(state, entity.expected.id, 'recovered', current.issueKey, current.nextAction, at, entity.episode, receipt, current.actionIdentity); entity.recoveryPending = null;
        }
      }
      entity.fingerprint = fingerprint;
    } else if (fingerprint !== entity.fingerprint) {
      const previousFailure = entity.fingerprint !== null && bad(entity.condition);
      if (bad(current.condition) || previousFailure) {
        entity.episode++;
        entity.alertId = addAlert(state, entity.expected.id, previousFailure && current.condition === 'healthy' ? 'recovered' : current.condition, current.issueKey, current.nextAction, at, entity.episode, entity.capture?.receipt ?? null);
      }
      entity.fingerprint = fingerprint;
    }
    Object.assign(entity, current);
  }
  for (const job of state.jobs) {
    if (job.status === 'attempted' && Date.parse(at) > Date.parse(job.deadline)) job.status = 'uncertain';
    if (['queued', 'retry-wait'].includes(job.status) && (job.usedReads >= job.input.maxReads || job.usedBytes >= job.input.maxBytes)) job.status = 'blocked';
    if (['uncertain', 'blocked', 'dead'].includes(job.status)) addAlert(state, job.key, job.status === 'uncertain' ? 'pending' : 'workflow-failed', `parent-job-${job.status}`, job.status === 'uncertain' ? 'Parent must inspect this ticket and reconcile attributable receipts before another read.' : 'Parent must inspect retained failure and owner scope. No automatic replay.', at, job.attempts);
  }
  insist(state.alerts.length <= config.maxAlerts, 'Fleet alert retention bound reached. No state was discarded.');
  return state;
}
export function fleetHistory(records, head) {
  const known = records instanceof Map ? records : new Map(records.map(record => [record.hash, record]));
  const history = { jobs: new Map(), runs: new Map(), sends: new Set() }; const visited = new Set();
  let current = head;
  while (current?.type === 'fleet-step') {
    insist(!visited.has(current.hash), 'Fleet ancestry cycle'); visited.add(current.hash);
    for (const job of current.state.jobs) if (!history.jobs.has(job.key)) history.jobs.set(job.key, job);
    for (const run of current.state.morningRuns ?? []) {
      if (!history.runs.has(run.id)) history.runs.set(run.id, run);
      for (const ref of [run.delivery?.sendRef, run.summary?.delivery?.editRef]) if (ref) history.sends.add(ref);
    }
    for (const row of [...current.state.alerts, ...(current.state.deliveryGroups ?? [])]) if (row.sendRef) history.sends.add(row.sendRef);
    const parent = known.get(current.parentHash); insist(parent && (parent.type === 'fleet-root' ? parent.hash === current.rootHash : parent.rootHash === current.rootHash), 'Fleet history requires complete scoped ancestry'); current = parent;
  }
  return history;
}
function archiveState(state, action, at) {
  insist(action.stateDigest === digest(state), 'Archival state digest differs; reread current head');
  const select = (rows, ids, key, predicate, message) => {
    for (const id of ids ?? []) { const row = rows.find(row => row[key] === id); insist(row && predicate(row), message); }
    return rows.filter(row => !(ids ?? []).includes(row[key]));
  };
  state.morningRuns = select(state.morningRuns ?? [], action.runIds, 'id', run => { const view = morningView([run], at)[0]; return view.status === 'complete' && (view.cleanup?.selectedIds ?? []).every(item => ['kept', 'verified'].includes(item.state)); }, 'Archival requires a complete resolved morning run');
  state.jobs = select(state.jobs, action.jobKeys, 'key', job => job.status === 'completed' && !(state.morningRuns ?? []).some(run => JSON.stringify(run).includes(job.key) || job.input.kind === 'briefing-source-read' && (job.input.occurrence === run.id || job.input.occurrence.startsWith(`${run.id}/refresh/`))), 'Archival requires completed work without retained morning dependencies');
  state.deliveryGroups = select(state.deliveryGroups ?? [], action.groupSendRefs, 'sendRef', group => group.status !== 'uncertain' && group.alertIds.every(id => action.alertIds?.includes(id) || !state.alerts.some(alert => alert.id === id)), 'Archival cannot detach a delivery group from retained alerts');
  state.alerts = select(state.alerts, action.alertIds, 'id', alert => alert.delivery !== 'uncertain' && (alert.disposition || alert.delivery === 'delivered') && !(state.deliveryGroups ?? []).some(group => group.alertIds.includes(alert.id)), 'Archival requires a resolved delivered or dismissed alert');
  for (const id of action.entityIds ?? []) { const row = state.entities.find(row => row.expected.id === id); insist(row, 'Unknown archive entity'); row.corrections = row.corrections.slice(-1); }
  if (action.policyHistory) state.policyHistory = [];
  state.archived = true;
}
export function fleetTransition(original, action, root, at, epochHash = original.epochHash, history = null) {
  actionInput(action, original.semanticsVersion ?? 1); const state = structuredClone(original); const config = fleetConfig(root.action.config);
  let outcome = 'retained'; let ticket = null;
  const entity = id => { const value = state.entities.find(row => row.expected.id === id); insist(value, 'Unknown fleet entity'); return value; };
  const alert = id => { const value = state.alerts.find(row => row.id === id); insist(value, 'Unknown fleet alert'); return value; };
  if (action.operation === 'upgrade') {
    insist(state.semanticsVersion !== 2, 'Fleet semantics already upgraded');
    insist(action.stateDigest === digest(original), 'Upgrade predecessor state digest differs');
    state.semanticsVersion = 2; state.semanticsUpgrade = { sourceRef: action.sourceRef, reason: action.reason, at, predecessorDigest: action.stateDigest };
    for (const row of state.entities) {
      const current = captureCondition(row, row.capture, state, config, at);
      row.recoveryPending = bad(row.condition) || bad(current.condition) ? recoveryBaseline(row, at) : null;
      Object.assign(row, current); row.fingerprint = fingerprintOf(current, 2);
    }
    insist(Buffer.byteLength(canonical(state)) <= 1048576, 'Fleet state retention byte bound reached');
    return { state, outcome: 'upgraded', ticket: null };
  }
  if (action.operation === 'resume') { state.lifecycle = 'active'; if (state.epochHash !== epochHash) { state.epochHash = epochHash; state.resumedAt = at; for (const job of state.jobs) if (job.status === 'attempted') job.status = 'uncertain'; } }
  else if (action.operation === 'suspend') { state.lifecycle = 'suspended'; }
  else {
    insist(state.lifecycle === 'active' || ['send-ack', 'send-resolve', 'dismiss', 'correct', 'result', 'resolve'].includes(action.operation), 'Fleet is explicitly suspended');
    if (action.operation === 'archive') { archiveState(state, action, at); outcome = 'archived'; }
    if (action.operation === 'policy-revise') {
      insist(action.version === (state.policy?.version ?? 0) + 1 && action.previousDigest === (state.policy?.digest ?? null), 'Policy revision must name exact previous version and digest');
      insist(action.entities.length === state.entities.length, 'Policy revision must retain every existing exact scope');
      for (const window of action.entities) insist(canonical(entity(window.entityId).expected.scope) === canonical(window.scope), 'Policy revision cannot rebind an entity scope');
      state.policyHistory ??= []; if (state.policy) state.policyHistory.push(state.policy);
      state.policy = { ...action, at, digest: digest(action) };
    }
    if (action.operation === 'morning') {
      if (state.archived && ['send-intent', 'edit-intent'].includes(action.command.step)) {
        insist(history, 'Archived identity lookup requires verified ancestry');
        const ref = action.command.sendRef ?? action.command.editRef;
        insist(!history.sends.has(ref), 'Historical morning send or edit reference cannot be reused');
      }
      if (action.command.step === 'open' && state.archived) insist(history, 'Archived identity lookup requires verified ancestry');
      const old = action.command.step === 'open' && !state.morningRuns?.some(run => run.id === action.command.runId) ? history?.runs.get(action.command.runId) : null;
      if (old) { insist(old.specification === digest(action.command), 'Conflicting archived morning identity'); outcome = 'coalesced'; }
      else outcome = morningTransition(state, action.command, root, at);
    }
    if (action.operation.startsWith('group-send-')) {
      const ids = [...action.alertIds].sort(); const rows = ids.map(alert);
      state.deliveryGroups ??= [];
      if (action.operation === 'group-send-intent') {
        insist(!state.archived || history, 'Archived identity lookup requires verified ancestry');
        insist(!state.archived || !history?.sends.has(action.sendRef), 'Historical send reference cannot be reused');
        insist(rows.every(row => !row.disposition && row.delivery === 'pending'), 'Group contains an already attempted, delivered or dismissed episode');
        insist(!state.deliveryGroups.some(group => group.sendRef === action.sendRef) && !state.alerts.some(row => row.sendRef === action.sendRef), 'Group send reference already retained; inspect actual conversation');
        const group = { ...(action.delivery ? { delivery: action.delivery } : {}), alertIds: ids, bodyDigest: action.bodyDigest, sendRef: action.sendRef, status: 'uncertain', at }; state.deliveryGroups.push(group);
        for (const row of rows) { row.delivery = 'uncertain'; row.bodyDigest = action.bodyDigest; row.sendRef = action.sendRef; }
      } else {
        const group = state.deliveryGroups.find(row => row.sendRef === action.sendRef);
        insist(group?.status === 'uncertain' && group.bodyDigest === action.bodyDigest && canonical(group.alertIds) === canonical(ids) && rows.every(row => row.delivery === 'uncertain' && row.sendRef === action.sendRef && row.bodyDigest === action.bodyDigest), 'Group acknowledgement must preserve every exact episode and send');
        if (group.delivery) deliveryReadback(action, { scope: group.delivery.scope, at: group.at }, at);
        if (action.operation === 'group-send-ack') {
          insist(action.readbackRef !== action.sendRef && action.deliveredBodyDigest === action.bodyDigest, 'Group delivery requires separate exact-body readback'); group.status = 'delivered'; group.readbackRef = action.readbackRef; group.nativeId = action.nativeId;
          for (const row of rows) { row.delivery = 'delivered'; row.readbackRef = action.readbackRef; }
        } else {
          group.status = 'known-unexecuted'; group.resolution = action;
          for (const row of rows) { row.delivery = 'pending'; row.reconciliation = { sourceRef: action.sourceRef, reason: action.reason, at }; }
        }
      }
    }
    if (action.operation === 'inventory') {
      for (const expected of action.entities) {
        insist((expected.maxAgeMs ?? config.maxAgeMs) <= config.maxAgeMs, 'Entity age cannot weaken configured freshness');
        const existing = state.entities.find(row => row.expected.id === expected.id);
        if (existing) { insist(existing.expected.kind === expected.kind && canonical(existing.expected.scope) === canonical(expected.scope), 'Inventory revision cannot rebind an entity scope or kind'); insist(existing.corrections.length < config.maxAlerts, 'Correction retention bound reached'); existing.corrections.push({ sourceRef: action.sourceRef, reason: action.reason, at, priorExpected: existing.expected }); existing.expected = expected; }
        else { insist(state.entities.length < config.maxEntities, 'Fleet inventory retention bound reached'); state.entities.push({ expected, capture: null, condition: 'unknown', issueKey: 'not-checked', episode: 0, fingerprint: null, alertId: null, corrections: [{ sourceRef: action.sourceRef, reason: action.reason, at }] }); }
      }
      for (const row of state.entities) if (row.expected.monitorId) insist(state.entities.some(monitor => monitor.expected.id === row.expected.monitorId && monitor.expected.kind === 'monitor'), 'Unknown revised monitor');
    }
    if (action.operation === 'assess') for (const capture of action.captures) {
      const row = entity(capture.entityId);
      if (state.semanticsVersion === 2 && (row.expected.dueAt || row.expected.kind === 'schedule')) insist(capture.invocation, 'Current run capture requires explicit invocation origin');
      insist(canonical(row.expected.scope) === canonical(capture.receipt.scope), 'Capture crosses exact source, account or environment scope');
      insist(!row.capture || Date.parse(capture.receipt.observedAt) >= Date.parse(row.capture.receipt.observedAt), 'Capture predates retained source');
      insist(!row.capture || capture.receipt.observedAt !== row.capture.receipt.observedAt || canonical(row.capture) === canonical(capture), 'Contradictory same-time capture requires a fresh attributable read');
      row.capture = capture;
    }
    if (action.operation === 'submit') {
      const input = jobInput(action.job, config); input.entityIds.forEach(entity);
      const key = digest({ effectKey: root.effectKey, kind: input.kind, occurrence: input.occurrence, id: input.id });
      insist(!state.archived || history, 'Archived identity lookup requires verified ancestry');
      const inputDigest = digest(input); const existing = state.jobs.find(job => job.key === key) ?? history?.jobs.get(key);
      if (existing) { insist(existing.inputDigest === inputDigest, 'Conflicting request under a stable job identity'); outcome = 'coalesced'; }
      else {
        const pending = state.jobs.filter(unfinished); const bytes = pending.reduce((sum, job) => sum + Buffer.byteLength(canonical(job.input)), 0);
        const capacity = config.maxPending - (input.priority === 'heavy' ? 2 : input.priority === 'morning' ? 1 : 0);
        if (state.jobs.length >= config.maxJobs || pending.length >= capacity || bytes + Buffer.byteLength(canonical(input)) > config.maxPendingBytes) outcome = 'backpressure';
        else state.jobs.push({ key, input, inputDigest, status: 'queued', order: state.jobs.length, attempts: 0, failures: 0, checkpoint: 0, usedReads: 0, usedBytes: 0, attemptReads: 0, attemptBytes: 0, nextAt: at, ticket: null, deadline: null, receipts: [], resultDigests: [], ownerRef: null });
      }
    }
    if (action.operation === 'claim') {
      evaluate(state, root, at);
      const active = state.jobs.some(job => ['attempted', 'uncertain'].includes(job.status));
      const pressured = state.entities.some(row => row.condition === 'resource-pressure');
      const job = !active && !pressured && state.jobs.filter(job => ['queued', 'retry-wait'].includes(job.status) && Date.parse(job.nextAt) <= Date.parse(at)).sort((a, b) => priorities.indexOf(a.input.priority) - priorities.indexOf(b.input.priority) || a.order - b.order)[0];
      if (job) {
        job.attempts++; job.status = 'attempted'; job.ownerRef = action.ownerRef; job.attemptReads = 0; job.attemptBytes = 0;
        job.ticket = digest({ jobKey: job.key, inputDigest: job.inputDigest, attempt: job.attempts, checkpoint: job.checkpoint, epochHash: state.epochHash, ownerRef: action.ownerRef });
        job.deadline = new Date(Date.parse(at) + config.attemptMs).toISOString(); ticket = { ...job, remainingReads: job.input.maxReads - job.usedReads, remainingBytes: job.input.maxBytes - job.usedBytes, assurance: 'reported-parent-contract', execute: 'Parent performs only the declared bounded read. This ticket grants no tools or access.' }; outcome = 'admitted';
      } else outcome = active ? 'reconcile-before-admission' : pressured ? 'resource-pressure' : 'no-eligible-work';
    }
    if (['result', 'resolve'].includes(action.operation)) {
      evaluate(state, root, at);
      const currentJob = state.jobs.find(job => job.key === action.jobKey); const job = currentJob ?? history?.jobs.get(action.jobKey); insist(job && job.ticket === action.ticket, 'Result does not match the retained attempt ticket');
      const resultDigest = digest(action);
      if (job.resultDigests.includes(resultDigest)) outcome = 'coalesced';
      else {
        insist(currentJob, 'Archived work is immutable; no new result or attempt');
        insist(action.operation === 'resolve' ? job.status === 'uncertain' : job.status === 'attempted', 'Uncertain or terminal work requires exact reconciliation. No duplicate execution.');
        insist(job.input.entityIds.some(id => canonical(entity(id).expected.scope) === canonical(action.receipt.scope)), 'Result crosses admitted source scope');
        insist(Date.parse(action.receipt.observedAt) <= Date.parse(action.receipt.capturedAt) && Date.parse(action.receipt.capturedAt) <= Date.parse(at) && Date.parse(action.receipt.capturedAt) >= Date.parse(job.deadline) - config.attemptMs, 'Result acquisition is outside this attempt window');
        insist(!['completed', 'checkpoint'].includes(action.outcome) || Date.parse(action.receipt.capturedAt) <= Date.parse(job.deadline), 'Successful read acquisition occurred after the ticket deadline');
        insist(action.checkpoint === job.checkpoint + (['completed', 'checkpoint'].includes(action.outcome) ? 1 : 0), 'Result skips or rewinds a checkpoint');
        insist(action.checkpoint <= job.input.steps && (action.outcome !== 'completed' || action.checkpoint === job.input.steps) && (action.outcome !== 'checkpoint' || action.checkpoint < job.input.steps), 'Invalid final checkpoint');
        insist(!['completed', 'checkpoint'].includes(action.outcome) || action.receipt.coverage.complete && action.receipt.coverage.gaps.length === 0, 'Partial source coverage cannot complete a parent read');
        if (action.usage.bytes === null) {
          insist(['health-read', 'briefing-source-read'].includes(job.input.kind) && action.outcome === 'blocked' && action.failure.kind === 'read-only-known-ended', 'Unknown measurements can close only a known-ended read-only failure');
          const readDelta = action.usage.reads - job.attemptReads; const previousBytes = job.usedBytes - job.attemptBytes; const knownBytesLowerBound = previousBytes + action.usage.knownBytesLowerBound;
          insist(readDelta >= 0 && job.usedReads + readDelta <= job.input.maxReads && action.usage.knownBytesLowerBound >= job.attemptBytes && knownBytesLowerBound <= job.input.maxBytes, 'Known usage rewinds or exceeds original admitted caps');
          job.usedReads += readDelta; job.attemptReads = action.usage.reads;
          job.byteAccounting = { measuredTotalBytes: null, knownBytesLowerBound, knownAttemptBytesLowerBound: action.usage.knownBytesLowerBound, previouslyMeasuredBytes: previousBytes, budgetReservedBytes: job.input.maxBytes, reservedUnknownBytes: job.input.maxBytes - knownBytesLowerBound, budgetCompliance: 'unverified', failure: action.failure };
          job.usedBytes = null; job.attemptBytes = null;
        } else {
        const readDelta = action.usage.reads - job.attemptReads; const byteDelta = action.usage.bytes - job.attemptBytes;
        insist(readDelta >= 0 && byteDelta >= 0 && job.usedReads + readDelta <= job.input.maxReads && job.usedBytes + byteDelta <= job.input.maxBytes, 'Parent usage rewinds or exceeds the admitted total budget');
        insist(!['completed', 'checkpoint'].includes(action.outcome) || action.usage.reads > 0, 'A successful checkpoint requires a declared actual read');
        insist(action.outcome !== 'known-unexecuted' || action.usage.reads === 0, 'Known-unexecuted evidence cannot erase a declared read');
        job.usedReads += readDelta; job.usedBytes += byteDelta; job.attemptReads = action.usage.reads; job.attemptBytes = action.usage.bytes;
        }
        job.resultDigests.push(resultDigest); job.receipts.push(action.receipt); job.checkpoint = action.checkpoint;
        if (action.outcome === 'completed') job.status = 'completed';
        else if (action.outcome === 'checkpoint') job.status = 'queued';
        else if (action.outcome === 'uncertain') job.status = 'uncertain';
        else if (action.outcome === 'blocked') job.status = 'blocked';
        else { insist(action.reason, 'A known-unexecuted retry requires attributable reason'); job.failures++; job.status = job.failures >= config.maxAttempts ? 'dead' : 'retry-wait'; job.nextAt = new Date(Date.parse(at) + config.retryMs * job.failures).toISOString(); }
        outcome = job.status;
      }
    }
    if (action.operation === 'correct') { const row = entity(action.entityId); insist(row.corrections.length < config.maxAlerts, 'Correction retention bound reached'); row.corrections.push({ sourceRef: action.sourceRef, reason: action.reason, at }); }
    if (action.operation === 'dismiss') { const row = alert(action.alertId); row.disposition = { sourceRef: action.sourceRef, reason: action.reason, at }; }
    if (action.operation === 'send-intent') {
      insist(!state.archived || history, 'Archived identity lookup requires verified ancestry');
      insist(!state.archived || !history?.sends.has(action.sendRef), 'Historical send reference cannot be reused');
      insist(!state.deliveryGroups?.some(group => group.sendRef === action.sendRef), 'A retained group send cannot be reused for another alert');
      const row = alert(action.alertId); insist(!row.disposition && row.delivery === 'pending', 'Alert send already attempted or dismissed. Inspect the actual conversation before retry.');
      row.delivery = 'uncertain'; row.bodyDigest = action.bodyDigest; row.sendRef = action.sendRef;
    }
    if (action.operation === 'send-ack') {
      insist(!state.deliveryGroups?.some(group => group.status === 'uncertain' && group.alertIds.includes(action.alertId)), 'Atomic group cannot be acknowledged or resolved one episode at a time');
      const row = alert(action.alertId); insist(row.delivery === 'uncertain' && row.bodyDigest === action.bodyDigest && row.sendRef === action.sendRef && action.readbackRef !== action.sendRef, 'Send/readback does not match the exact pending attempt');
      row.delivery = 'delivered'; row.readbackRef = action.readbackRef;
    }
    if (action.operation === 'send-resolve') {
      insist(!state.deliveryGroups?.some(group => group.status === 'uncertain' && group.alertIds.includes(action.alertId)), 'Atomic group cannot be acknowledged or resolved one episode at a time');
      const row = alert(action.alertId); insist(row.delivery === 'uncertain' && row.bodyDigest === action.bodyDigest && row.sendRef === action.sendRef, 'Send reconciliation crosses alert or attempt');
      row.delivery = 'pending'; row.reconciliation = { sourceRef: action.sourceRef, reason: action.reason, at };
    }
  }
  if (state.lifecycle === 'active') evaluate(state, root, at, action.operation === 'assess' ? action.captures.map(row => row.entityId) : []);
  insist(Buffer.byteLength(canonical(state)) <= 1048576, 'Fleet state retention byte bound reached. No prior history was discarded.');
  return { state, outcome, ticket };
}
export function fleetState(records, responsibilityId) {
  const roots = records.filter(record => record.type === 'fleet-root');
  if (roots.length > 1) return { status: 'unknown', reason: 'multiple-home-fleet-controllers', roots: roots.map(root => root.hash) };
  const root = roots.find(record => record.responsibilityId === responsibilityId);
  if (!root) return { status: 'unconfigured', state: null };
  const steps = records.filter(record => record.type === 'fleet-step' && record.rootHash === root.hash);
  const replaced = new Set(steps.map(record => record.parentHash)); const heads = [root, ...steps].filter(record => !replaced.has(record.hash));
  if (heads.length !== 1) return { status: 'unknown', reason: 'fleet-head-conflict', roots: heads.map(head => head.hash) };
  const head = heads[0]; return { status: 'ready', root, head, state: head.type === 'fleet-root' ? fleetInitial(root) : head.state };
}
export function fleetView(records, responsibilityId, at, { semanticsVersion = 2 } = {}) {
  const projected = fleetState(records, responsibilityId);
  if (projected.status !== 'ready') return projected;
  const { root, head } = projected; const state = structuredClone(projected.state); const config = fleetConfig(root.action.config);
  const epoch = records.filter(record => record.type === 'epoch').sort((a, b) => a.restoredAt.localeCompare(b.restoredAt) || a.hash.localeCompare(b.hash)).at(-1);
  const restored = Boolean(epoch && state.epochHash !== epoch.hash);
  const viewState = { ...state, semanticsVersion };
  const inventory = state.entities.map(entity => ({ ...entity, ...captureCondition(entity, entity.capture, viewState, config, at), ...(semanticsVersion === 2 && entity.recoveryPending ? { recoveryStatus: 'fresh-recovery-unverified' } : {}), ...(semanticsVersion === 2 && entity.expected.dueAt ? { invocationOrigin: entity.capture?.invocation?.origin ?? 'unknown' } : {}), assurance: 'reported', sourceAgeMs: entity.capture ? Date.parse(at) - Date.parse(entity.capture.receipt.observedAt) : null, capturedAt: entity.capture?.receipt.capturedAt ?? null, coverage: entity.capture?.receipt.coverage ?? { complete: false, gaps: ['No source receipt'] }, ...(restored ? { condition: 'unknown', issueKey: 'restore-needs-fresh-read' } : {}) }));
  const needsAssessment = inventory.some(entity => fingerprintOf(entity, semanticsVersion === 2 ? state.semanticsVersion : 1) !== state.entities.find(row => row.expected.id === entity.expected.id).fingerprint) || state.jobs.some(job => job.status === 'attempted' && Date.parse(at) > Date.parse(job.deadline));
  return { status: restored || state.lifecycle === 'suspended' ? 'suspended' : inventory.some(row => bad(row.condition)) || needsAssessment || semanticsVersion === 2 && state.entities.some(row => row.recoveryPending) || state.alerts.some(alert => !alert.disposition && alert.delivery !== 'delivered') || state.jobs.some(job => ['uncertain', 'blocked', 'dead'].includes(job.status)) || state.morningRuns?.some(run => morningView([run], at)[0].status !== 'complete') ? 'needs-attention' : 'ready', responsibilityId, rootHash: root.hash, headHash: head.hash, state, inventory, needsAssessment, ...(state.morningRuns ? { morning: morningView(state.morningRuns, at) } : {}), pendingAlerts: state.alerts.filter(alert => !alert.disposition && alert.delivery === 'pending'), uncertainAlerts: state.alerts.filter(alert => !alert.disposition && alert.delivery === 'uncertain'), delivery: 'parent-owned', assurance: 'reported', limits: ['Receipts are attributable parent claims. Code does not authenticate their truth or own connectors, browsers, schedules or Dot sends.', 'A completed read is not delivery. No provider-wide admission, automatic retry of uncertain actions or total-dormancy detection.'] };
}
