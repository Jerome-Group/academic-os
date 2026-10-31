import { canonical, canonicalRepository, digest } from './records.mjs';

export const subjectFields = ['projectId', 'repository', 'executor', 'hostId', 'nativeProjectId', 'nativeId', 'path', 'revision', 'dirtyDigest'];
export const subjectKey = subject => Object.fromEntries(subjectFields.map(field => [field, subject[field] ?? null]));
export const sameSubject = (left, right) => canonical(subjectKey(left)) === canonical(subjectKey(right));
export const criterionHash = criterion => digest(criterion);
export const reviewAsOf = (requestedAsOf, completedAt, observationTimes = []) => new Date(Math.max(Date.parse(requestedAsOf), Date.parse(completedAt), ...observationTimes.map(value => Date.parse(value)))).toISOString();

export function observationStatus(observation, target, asOf, maxAgeMs) {
  const reasons = [];
  const ageMs = Date.parse(asOf) - Date.parse(observation.observedAt);
  if (!sameSubject(observation.subject, target)) reasons.push('foreign-subject');
  if (ageMs < 0) reasons.push('future-observation');
  if (ageMs > maxAgeMs) reasons.push('stale-observation');
  if (!observation.coverage.complete || observation.coverage.gaps.length) reasons.push('partial-observation');
  if (observation.availability !== 'available') reasons.push('unavailable-observation');
  return { hash: observation.hash, eligible: reasons.length === 0, reasons, ageMs, assurance: observation.origin === 'observed-local' ? 'observed-local' : 'reported' };
}

export function routeTarget(definition, { bindings, catalog, machine }) {
  const target = definition.target;
  const binding = Object.hasOwn(bindings.projects, target.projectId) ? bindings.projects[target.projectId] : null;
  const project = catalog.projects.find(item => item.id === target.projectId) ?? (binding ? { id: target.projectId, label: binding.label, repository: binding.repository ?? null, basis: 'reported' } : null);
  const reasons = [];
  if (!project) reasons.push('unknown-project');
  const intendedRepository = binding?.repository ?? project?.repository;
  if (intendedRepository && canonicalRepository(intendedRepository) !== canonicalRepository(target.repository)) reasons.push('repository-binding-mismatch');
  if (target.executor.startsWith('local-')) {
    if (!binding || !Object.hasOwn(bindings.hosts, target.hostId) || binding.hostId !== target.hostId || binding.path !== target.path || binding.nativeProjectId !== target.nativeProjectId) reasons.push('exact-binding-missing');
    if (bindings.localHostId !== target.hostId || !Object.hasOwn(bindings.hosts, target.hostId) || bindings.hosts[target.hostId].machine !== machine) reasons.push('local-host-unverified');
  } else if (target.executor === 'codex-cloud' && (!binding?.cloudEnvironmentId || binding.cloudEnvironmentId !== target.hostId || !definition.cloudReason)) reasons.push('prepared-cloud-needed');
  if ((definition.workClass ?? 'code') === 'code' && !target.executor.startsWith('local-') && (!definition.cloudReason || definition.authorityRef.cloud !== true)) reasons.push('cloud-coding-authority-needed');
  return { project, executor: target.executor, target: subjectKey(target), reasons, status: reasons.length ? 'needs-observation' : 'bound', execution: 'proposal-only' };
}

export function authorityStatus(definition, asOf) {
  const authority = definition.authorityRef;
  const scoped = Boolean(authority && authority.reference && authority.action === definition.action && authority.resource === definition.resource && authority.destination === definition.destination);
  const current = !authority?.expiresAt || Date.parse(authority.expiresAt) >= Date.parse(asOf);
  return { eligible: scoped && current, reason: !scoped ? 'authority-scope-needed' : !current ? 'authority-expired' : null, assurance: 'reported-reference' };
}

export function effectKey(definition) {
  const { revision, dirtyDigest, ...target } = subjectKey(definition.target);
  return digest({ responsibilityId: definition.id, target, intendedEffect: definition.feature.intendedEffect, occurrence: definition.trigger?.nextWindow.start ?? 'ongoing' });
}

export function definitionHeads(definitions) {
  const parents = new Set(definitions.flatMap(definition => definition.parents));
  return definitions.filter(definition => !parents.has(definition.hash)).sort((left, right) => left.hash.localeCompare(right.hash));
}

export function restoredState(epoch, observations, definition, asOf, { nativeRemote = false } = {}) {
  if (!epoch) return { suspended: false, needed: [] };
  const current = currentObservations(definition, observations, asOf);
  const needed = ['target', 'authority', 'tasks', 'schedule'].filter(category => !current.some(observation => observation.category === category && observation.homeEpoch === epoch.hash && Date.parse(observation.observedAt) >= Date.parse(epoch.restoredAt) && observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible && (category !== 'target' || !definition.target.executor.startsWith('local-') || observation.origin === 'observed-local' || nativeRemote && observation.origin === 'reported' && observation.evidenceRefs.length > 0) && (category !== 'authority' || observation.authority?.reference === definition.authorityRef.reference && observation.authority?.action === definition.action && observation.authority?.resource === definition.resource && observation.authority?.destination === definition.destination && (!observation.authority.expiresAt || Date.parse(observation.authority.expiresAt) >= Date.parse(asOf)) && authorityStatus(definition, asOf).eligible)));
  return { suspended: needed.length > 0, needed, epoch: epoch.hash };
}

export function repairStatus(repair, finding, observations, definition, asOf) {
  const reasons = [];
  if (repair.findingId !== finding.id || !finding.failureRefs.every(ref => repair.failureRefs.includes(ref))) reasons.push('failure-link-mismatch');
  if (!sameSubject(repair.expectedSubject, definition.target)) reasons.push('repair-subject-mismatch');
  if (Date.parse(repair.observedAt) > Date.parse(asOf)) reasons.push('future-repair');
  const failureTime = Math.max(...observations.filter(observation => (finding.evidenceHistoryRefs ?? finding.failureRefs).includes(observation.hash)).map(observation => Date.parse(observation.observedAt)));
  const triggerFinding = ['missed-run', 'run-no-evidence', 'delivery-unverified'].includes(finding.code);
  if (!finding.criteria.length && !triggerFinding) reasons.push('finding-specific-recheck-needed');
  const rechecks = observations.filter(observation => repair.recheckRefs.includes(observation.hash));
  if (rechecks.length !== repair.recheckRefs.length) reasons.push('missing-recheck');
  if (definition.target.executor.startsWith('local-')) {
    const targetChecks = observations.filter(observation => observation.category === 'target' && observation.origin === 'observed-local' && Date.parse(observation.observedAt) <= Date.parse(asOf));
    const latestTime = Math.max(...targetChecks.map(observation => Date.parse(observation.observedAt)));
    if (!targetChecks.length || targetChecks.filter(observation => Date.parse(observation.observedAt) === latestTime).some(observation => !observationStatus(observation, repair.expectedSubject, asOf, definition.freshness.maxAgeMs).eligible)) reasons.push('current-local-subject-unverified');
  }
  if (triggerFinding) {
    const verified = rechecks.some(observation => observation.category === 'schedule' && observationStatus(observation, repair.expectedSubject, asOf, definition.freshness.maxAgeMs).eligible && Date.parse(observation.observedAt) > failureTime && Date.parse(observation.observedAt) <= Date.parse(repair.observedAt) && observation.runs?.some(run => run.nativeId === finding.occurrence.nativeId && run.windowStart === finding.occurrence.windowStart && run.outcomeRefs.length && run.deliveryRefs.length));
    if (!verified) reasons.push('trigger-recheck-needed');
  }
  for (const criterion of finding.criteria) {
    if (criterion.independentReview) { reasons.push('external-review-needed'); continue; }
    const relevant = rechecks.filter(observation => Date.parse(observation.observedAt) > failureTime && Date.parse(observation.observedAt) <= Date.parse(repair.observedAt) && sameSubject(observation.subject, repair.expectedSubject) && observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible);
    const claims = relevant.flatMap(observation => observation.claims.filter(claim => claim.criterionId === criterion.id && claim.kind === criterion.evidence && claim.revision === repair.expectedSubject.revision && claim.specHash === criterionHash(criterion)).map(claim => ({ claim, observation })));
    const passing = claims.some(({ claim, observation }) => claim.outcome === 'pass' && (criterion.evidence === 'reported-check' || observation.origin === 'observed-local'));
    if (!passing || claims.some(({ claim }) => claim.outcome !== 'pass')) reasons.push(`recheck-failed:${criterion.id}`);
  }
  const repeatedFailure = rechecks.some(observation => observation.claims.some(claim => claim.outcome === 'fail' && finding.criteria.some(criterion => claim.criterionId === criterion.id && claim.specHash === criterionHash(criterion))));
  return { repairHash: repair.hash, valid: reasons.length === 0, outcome: reasons.length === 0 ? 'supported' : repeatedFailure ? 'failed' : 'unsupported', reasons: [...new Set(reasons)].sort() };
}

export function triggerStatus(definition, observations, asOf) {
  const trigger = definition.trigger;
  if (!trigger) return { status: 'none', findings: [], occurrence: null };
  const occurrence = { nativeId: trigger.nativeId, windowStart: trigger.nextWindow.start, due: trigger.nextWindow.due, graceMs: trigger.nextWindow.graceMs };
  const current = currentObservations(definition, observations, asOf).filter(observation => observation.category === 'schedule' && observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible && observation.schedule?.nativeId === trigger.nativeId);
  const findings = [];
  const add = (code, refs = []) => findings.push({ code, refs, occurrence });
  if (!current.length) add('schedule-observation-needed');
  for (const observation of current) {
    if (observation.schedule.status !== 'enabled') { add(`schedule-${observation.schedule.status}`, [observation.hash]); continue; }
    if (observation.schedule.promptDigest !== trigger.promptDigest || observation.schedule.timezone !== trigger.timezone || observation.schedule.destination !== trigger.destination) { add('schedule-definition-mismatch', [observation.hash]); continue; }
    if (Date.parse(asOf) <= Date.parse(trigger.nextWindow.due) + trigger.nextWindow.graceMs) continue;
    if (Date.parse(observation.observedAt) < Date.parse(trigger.nextWindow.due) + trigger.nextWindow.graceMs) { add('schedule-observation-needed', [observation.hash]); continue; }
    const runs = (observation.runs ?? []).filter(run => run.nativeId === trigger.nativeId && run.windowStart === trigger.nextWindow.start);
    if (!runs.length) add('missed-run', [observation.hash]);
    for (const run of runs) {
      if (!run.outcomeRefs.length) add('run-no-evidence', [observation.hash]);
      if (!run.deliveryRefs.length) add('delivery-unverified', [observation.hash]);
    }
  }
  return { status: findings.length ? 'needs-observation' : 'reported-current', findings, occurrence, assurance: 'reported', laterWindows: 'Fresh native discovery required. No recurrence or catch-up execution is inferred.' };
}

export function retirementStatus(definition, definitions, observations, asOf) {
  if (definition.lifecycle.status === 'active') return { status: 'active', pendingTriggers: [] };
  const triggerIds = [...new Set(definitions.filter(item => item.trigger).map(item => item.trigger.nativeId))].sort();
  const pendingTriggers = triggerIds.filter(nativeId => !currentObservations(definition, observations, asOf).some(observation => observation.category === 'schedule' && observation.schedule?.nativeId === nativeId && ['disabled', 'missing'].includes(observation.schedule.status) && observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible));
  for (const nativeId of triggerIds) if (!pendingTriggers.includes(nativeId) && currentObservations(definition, observations, asOf).some(observation => observation.category === 'schedule' && observation.schedule?.nativeId === nativeId && observation.schedule.status === 'enabled' && observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible)) pendingTriggers.push(nativeId);
  pendingTriggers.sort();
  return { status: pendingTriggers.length ? 'pending-native-disablement' : 'disablement-readback-reported', pendingTriggers, assurance: 'reported', replacementId: definition.lifecycle.replacementId ?? null, transferredFindingIds: definition.lifecycle.transferFindingIds ?? [] };
}

export function currentObservations(definition, observations, asOf) {
  const byHash = new Map(observations.map(observation => [observation.hash, observation]));
  const replaced = new Set();
  for (const observation of observations) {
    const status = observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs);
    if (status.reasons.some(reason => reason !== 'unavailable-observation')) continue;
    let reference = observation.supersedes?.hash;
    while (reference && !replaced.has(reference)) { replaced.add(reference); reference = byHash.get(reference)?.supersedes?.hash; }
  }
  return observations.filter(observation => !replaced.has(observation.hash));
}

export function currentNativeEffects(definition, observations, asOf) {
  const effectObservations = observations.filter(observation => ['effect', 'tasks'].includes(observation.category) && Date.parse(observation.observedAt) <= Date.parse(asOf) && digest({ ...subjectKey(observation.subject), revision: null, dirtyDigest: null }) === digest({ ...subjectKey(definition.target), revision: null, dirtyDigest: null }));
  const replaced = new Set();
  const effectByHash = new Map(effectObservations.map(observation => [observation.hash, observation]));
  for (const observation of effectObservations.filter(observation => observationStatus(observation, definition.target, asOf, definition.freshness.maxAgeMs).eligible)) {
    let reference = observation.supersedes?.hash;
    while (reference && !replaced.has(reference)) { replaced.add(reference); reference = effectByHash.get(reference)?.supersedes?.hash; }
  }
  return effectObservations.filter(observation => !replaced.has(observation.hash));
}
