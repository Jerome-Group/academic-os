import { canonical, digest } from './records.mjs';

const same = (a, b) => canonical(a) === canonical(b);
const hash = value => digest(canonical(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16384;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && date(value.slice(0, 10)) && +value.slice(11, 13) < 24 && +value.slice(14, 16) < 60 && +value.slice(17, 19) < 60;
const list = value => Array.isArray(value) && value.length <= 2000;
const unique = rows => new Set(rows).size === rows.length;
const identity = value => object(value) && ['environment', 'accountId', 'containerKind', 'containerId', 'nativeId'].every(key => text(value[key])) && ['calendar', 'task-list'].includes(value.containerKind);
const evidence = (row, at) => stamp(row.observedAt) && Date.parse(row.observedAt) <= Date.parse(at) && text(row.evidenceRef);
const fields = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
const fieldEqual = (key, left, right) => ['start', 'end'].includes(key) ? stamp(left) && stamp(right) && Date.parse(left) === Date.parse(right) : same(left, right);

export const sourceLabel = (title, label) => typeof title === 'string' && typeof label === 'string' && label.length > 0 && [...title.matchAll(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'))].some(match => !/[\p{L}\p{N}\p{M}]/u.test([...title.slice(0, match.index)].at(-1) ?? '') && !/[\p{L}\p{N}\p{M}]/u.test([...title.slice(match.index + label.length)][0] ?? ''));

export function assessCalendarPolicy(policy, baseline, scope, selectors, evaluatedAt) {
  const findings = [];
  const add = (code, target = null) => { if (!findings.some(row => row.code === code && same(row.target, target))) findings.push({ code, target }); };
  const dependencies = new Map();
  if (!policy || !baseline) { add('calendar-policy-required'); return { findings, dependencies }; }
  if (!same(policy, baseline)) add('calendar-policy-baseline-mismatch');
  const valid = fields(policy, ['schemaVersion', 'scope', 'assignments', 'occurrences', 'bindings', 'ownerRules']) && policy.schemaVersion === 1 && same(policy.scope, scope) && ['assignments', 'occurrences', 'bindings', 'ownerRules'].every(key => list(policy[key]));
  if (!valid) { add('calendar-policy-invalid'); return { findings, dependencies }; }
  const assignments = new Map(); const occurrences = new Map();
  for (const row of policy.assignments) {
    if (!fields(row, ['id', 'reference', 'orderedUnits', 'observedAt', 'evidenceRef']) || !text(row.id) || !text(row.reference) || !list(row.orderedUnits) || !row.orderedUnits.every(text) || !unique(row.orderedUnits) || !evidence(row, evaluatedAt) || assignments.has(row.id)) { add('assignment-policy-invalid'); continue; }
    assignments.set(row.id, row);
  }
  for (const row of policy.occurrences) {
    if (!fields(row, ['id', 'assignmentId', 'name', 'range', 'kind', 'unitIds', 'predecessors', 'state', 'observedAt', 'evidenceRef']) || !text(row.id) || !text(row.assignmentId) || !text(row.name) || !text(row.range) || !['whole-source', 'timed-attempt', 'correction', 'ongoing-research'].includes(row.kind) || !list(row.unitIds) || !row.unitIds.every(text) || !unique(row.unitIds) || !list(row.predecessors) || !row.predecessors.every(text) || !unique(row.predecessors) || !['open', 'completed', 'dismissed', 'superseded'].includes(row.state) || !evidence(row, evaluatedAt) || occurrences.has(row.id)) { add('occurrence-policy-invalid'); continue; }
    occurrences.set(row.id, row);
    const assignment = assignments.get(row.assignmentId);
    if (!assignment) { add('assignment-policy-missing', row.id); continue; }
    const indices = row.unitIds.map(id => assignment.orderedUnits.indexOf(id));
    if (indices.some((index, i) => index < 0 || i > 0 && index !== indices[i - 1] + 1) || assignment.orderedUnits.length > 0 && row.unitIds.length === 0) add('question-group-not-contiguous', row.id);
  }
  const visited = new Set(); const stack = new Set();
  const visit = id => {
    if (stack.has(id)) { add('occurrence-dependency-cycle', id); return; }
    if (visited.has(id)) return;
    const row = occurrences.get(id);
    if (!row) { add('occurrence-dependency-invalid', id); return; }
    stack.add(id); row.predecessors.forEach(visit); stack.delete(id); visited.add(id);
  };
  occurrences.forEach(row => visit(row.id));
  const activeBindings = [];
  for (const row of policy.bindings) {
    if (!fields(row, ['identity', 'occurrenceId', 'observedAt', 'evidenceRef', 'supersedes']) || !identity(row.identity) || !occurrences.has(row.occurrenceId) || !evidence(row, evaluatedAt) || !(row.supersedes === null || /^[a-f0-9]{64}$/.test(row.supersedes))) { add('source-binding-invalid'); continue; }
    if (row.identity.environment !== scope.environment || row.identity.accountId !== scope.accountId) add('source-binding-scope-mismatch');
    if (row.supersedes !== null) {
      const prior = policy.bindings.find(entry => hash(entry) === row.supersedes);
      if (!prior || !same(prior.identity, row.identity) || Date.parse(prior.observedAt) >= Date.parse(row.observedAt) || policy.bindings.filter(entry => entry.supersedes === row.supersedes).length !== 1 || prior.occurrenceId !== row.occurrenceId && occurrences.get(prior.occurrenceId)?.state !== 'superseded') add('source-binding-supersession-invalid');
    }
    if (!policy.bindings.some(entry => entry.supersedes === hash(row))) activeBindings.push(row);
  }
  if (!unique(activeBindings.map(row => canonical(row.identity))) || !unique(activeBindings.map(row => row.occurrenceId))) add('ambiguous-source-binding');
  const activeRules = [];
  for (const row of policy.ownerRules) {
    if (!fields(row, ['id', 'identity', 'occurrenceId', 'changes', 'observedAt', 'evidenceRef', 'supersedes']) || !text(row.id) || !identity(row.identity) || !occurrences.has(row.occurrenceId) || !evidence(row, evaluatedAt) || !fields(row.changes, ['title', 'date', 'start', 'end', 'durationMinutes', 'timeZone', 'completed']) || Object.keys(row.changes).length === 0 || !(row.supersedes === null || /^[a-f0-9]{64}$/.test(row.supersedes))) { add('owner-rule-invalid'); continue; }
    if (row.identity.environment !== scope.environment || row.identity.accountId !== scope.accountId) add('owner-rule-scope-mismatch');
    if (['start', 'end'].some(key => Object.hasOwn(row.changes, key) && !stamp(row.changes[key]))) add('owner-rule-invalid');
    if (row.supersedes !== null) {
      const prior = policy.ownerRules.find(entry => hash(entry) === row.supersedes);
      if (!prior || !same(prior.identity, row.identity) || prior.occurrenceId !== row.occurrenceId || !same(Object.keys(prior.changes).sort(), Object.keys(row.changes).sort()) || Date.parse(prior.observedAt) >= Date.parse(row.observedAt) || policy.ownerRules.filter(entry => entry.supersedes === row.supersedes).length !== 1) add('owner-rule-supersession-invalid');
    }
    if (!policy.ownerRules.some(entry => entry.supersedes === hash(row))) activeRules.push(row);
  }
  if (!unique(policy.ownerRules.map(row => row.id))) add('owner-rule-invalid');
  for (const selector of selectors) {
    const source = selector.source;
    const occurrence = occurrences.get(source?.occurrenceId);
    if (!occurrence || source.assignmentId !== occurrence.assignmentId) { add('source-occurrence-required', selector.id); continue; }
    const assignment = assignments.get(occurrence.assignmentId);
    if (!assignment || source.name !== occurrence.name || source.reference !== assignment.reference || source.range !== occurrence.range || source.kind !== occurrence.kind) add('source-semantic-mismatch', selector.id);
    if (occurrence.state !== 'open') add('source-occurrence-terminal', selector.id);
    if (source.completed !== (occurrence.state === 'completed')) add('source-completion-policy-mismatch', selector.id);
    if (occurrence.kind === 'correction' && !occurrence.predecessors.some(id => { const prior = occurrences.get(id); return prior?.kind === 'timed-attempt' && prior.assignmentId === occurrence.assignmentId && occurrence.unitIds.every(unit => prior.unitIds.includes(unit)); })) add('correction-attempt-policy-required', selector.id);
    if (selector.create ? activeBindings.some(row => row.occurrenceId === occurrence.id) : !activeBindings.some(row => row.occurrenceId === occurrence.id && same(row.identity, selector.identity))) add('source-binding-mismatch', selector.id);
    const required = new Set(occurrence.predecessors);
    const first = assignment?.orderedUnits.indexOf(occurrence.unitIds[0]) ?? -1;
    if (first > 0 && occurrence.kind !== 'correction') {
      for (const unit of assignment.orderedUnits.slice(0, first)) {
        const earlier = [...occurrences.values()].filter(row => row.assignmentId === occurrence.assignmentId && row.kind === occurrence.kind && row.unitIds.includes(unit));
        if (earlier.length !== 1) add('ordered-question-evidence-missing', selector.id);
        else required.add(earlier[0].id);
      }
    }
    const unresolved = [];
    for (const id of required) {
      const prior = occurrences.get(id);
      if (!prior || id === occurrence.id || ['dismissed', 'superseded'].includes(prior.state)) add('occurrence-dependency-invalid', selector.id);
      if (prior?.state !== 'completed') {
        const predecessor = selectors.find(row => row.source?.occurrenceId === id);
        if (!predecessor) add('ordered-question-dependency-unmet', selector.id);
        else unresolved.push(predecessor.source.id);
      }
    }
    dependencies.set(source.id, unresolved);
    const rules = activeRules.filter(row => row.occurrenceId === occurrence.id && same(row.identity, selector.identity));
    if (selector.baselineIntervals?.length && Object.hasOwn(selector.changes, 'start') && !selector.baselineIntervals.some(row => row.start === Date.parse(selector.changes.start) && row.end === Date.parse(selector.changes.end)) && !rules.some(rule => fieldEqual('start', rule.changes.start, selector.changes.start) && fieldEqual('end', rule.changes.end, selector.changes.end))) add('existing-interval-change-needs-owner-policy', selector.id);
    for (const rule of rules) {
      if (Object.entries(rule.changes).some(([key, value]) => Object.hasOwn(selector.changes, key) && !fieldEqual(key, selector.changes[key], value))) add('owner-policy-protected', selector.id);
    }
  }
  return { findings, dependencies };
}
