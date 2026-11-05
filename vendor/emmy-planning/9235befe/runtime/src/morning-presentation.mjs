const groups = { gmail: 'Gmail', outlook: 'School Outlook', 'calendar-inventory': 'Calendars', calendar: 'Calendars', 'task-inventory': 'Tasks', tasks: 'Tasks' };
const keepContext = item => {
  const c = item.context; const reasons = [[!c.complete, 'incomplete thread context'], [!c.safeUnreadInspection, 'unread-preserving inspection unavailable'], [c.actionRequired, 'action required'], [c.reviewRequired, 'review required'], [c.ambiguous, 'ambiguous'], [c.seriousSecurity || c.securityWarning, 'security review needed'], [c.unresolved, 'unresolved'], [c.consequential, 'consequential item'], [c.academic, 'academic item'], [c.research, 'research item'], [c.personal, 'personal item'], [c.billing, 'billing item'], [c.terms, 'terms review'], [c.invitation, 'invitation'], [c.directMessage, 'direct message']].filter(([yes]) => yes).map(([, reason]) => reason);
  const fallback = { 'already-outside-inbox': 'already outside inbox', 'unrecognized-successful-login-notice': 'login notice not recognized', 'useful-receipt-facts-required': 'useful details not retained', 'insufficient-judgment': 'judgment incomplete' };
  return `keep${reasons.length ? `; ${reasons.join(', ')}` : fallback[item.classification.reason] ? `; ${fallback[item.classification.reason]}` : ''}`;
};
const unique = values => [...new Set(values)];
const clock = (value, day) => { const sameDay = day && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) === day; return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', ...(!sameDay ? { day: '2-digit', month: 'short', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); };
const range = (values, day) => { const ordered = unique(values.filter(Boolean)).sort(); return ordered.length ? `${clock(ordered[0], day)}${ordered.at(-1) !== ordered[0] ? ` to ${clock(ordered.at(-1), day)}` : ''} SGT` : 'not acquired'; };
function privateNames(run, assessment, internalIds) {
  const replacements = new Map(internalIds.filter(Boolean).map(id => [id, 'private read reference']));
  for (const [index, item] of run.items.entries()) { for (const id of [item.key, item.reviewDigest, item.receipt.sourceRef, item.receipt.sha256, item.context.threadDigest]) if (id) replacements.set(id, 'private mail evidence'); replacements.set(item.before.nativeId, `mail item ${index + 1}`); replacements.set(item.before.threadId, `mail conversation ${index + 1}`); }
  const counts = {};
  for (const source of run.sources) {
    const group = groups[source.role]; for (const id of [source.capture?.jobKey, source.capture?.receipt.sourceRef, source.capture?.receipt.sha256]) if (id) replacements.set(id, `${group} read reference`); replacements.set(source.id, group); replacements.set(source.entityId, group);
    for (const id of source.capture?.messageIds ?? []) if (!replacements.has(id)) { counts[group] = (counts[group] ?? 0) + 1; replacements.set(id, `unreviewed ${group} message ${counts[group]}`); }
    for (const id of source.capture?.resourceIds ?? []) if (!replacements.has(id)) { counts[group] = (counts[group] ?? 0) + 1; replacements.set(id, `${group === 'Calendars' ? 'calendar' : 'Task list'} ${counts[group]}`); }
  }
  for (const { source } of assessment.sources) if (!replacements.has(source.id)) replacements.set(source.id, `${assessment.entries.filter(row => row.entry.sourceIds.includes(source.id)).map(row => row.entry.label).join(', ') || 'Assessed item'} source`);
  return [...replacements].filter(([id, replacement]) => id && id !== replacement).sort((a, b) => b[0].length - a[0].length);
}
export function renderCompactMorning(run, assessment, { at, gaps = [], summary = false, internalIds = [] } = {}) {
  const names = privateNames(run, assessment, internalIds);
  const escaped = ids => ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const lookup = new Map(names); const visibleNames = names.filter(([id]) => id.length >= 3 && !Object.hasOwn(groups, id));
  const matcher = visibleNames.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped(visibleNames.map(([id]) => id))})(?![\\p{L}\\p{N}_])`, 'gu') : null;
  const nativeIds = run.items.flatMap(item => [item.before.nativeId, item.before.threadId]);
  const sensitiveIds = [...new Set([...nativeIds, ...names.filter(([id]) => id.length >= 3 && !Object.hasOwn(groups, id)).map(([id]) => id)])];
  const sensitive = sensitiveIds.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped(sensitiveIds)})(?![\\p{L}\\p{N}_])`, 'u') : null;
  const publicText = value => { if (/[\r\n\u2028\u2029\x00]|```|~~~/.test(value)) throw new Error('Compact presentation held: unsupported line control in human text'); if (sensitive?.test(value)) throw new Error('Compact presentation held: human label, sender, subject or exact required fact contains an internal identifier'); return value; };
  const readable = original => { const raw = original.replace(/[\r\n\u2028\u2029\x00-\x1f]/g, ' ').replace(/```|~~~/g, '[formatting omitted]'); const source = run.sources.find(source => raw.startsWith(`${source.id} `) && /^(?:stale|missing|incomplete|unreviewed|inventory)\b/.test(raw.slice(source.id.length + 1))); const value = source ? groups[source.role] + raw.slice(source.id.length) : raw; return matcher ? value.replace(matcher, id => lookup.get(id)) : value; };
  const historical = summary && Date.parse(at) > Date.parse(assessment.checkedAt) + 300000;
  const lines = [`Morning ${run.day} (Singapore).`];
  for (const { entry, decision } of assessment.entries) {
    const closed = entry.state === 'complete' || decision.kind === 'older-reminder-suppressed';
    const status = decision.kind === 'conflict' ? 'conflicting completion and later pending evidence; check required' : decision.kind === 'unknown' ? 'current state unknown' : closed && ['cancelled', 'dismissed'].includes(entry.scope.effect) ? `${entry.scope.effect}, reported` : decision.kind === 'older-reminder-suppressed' ? 'completed, reported; earlier reminder closed' : entry.state === 'complete' ? 'completed, reported' : entry.state === 'pending' ? 'pending, reported' : `${entry.state}, reported`;
    const selectedTimes = assessment.sources.filter(({ source }) => entry.sourceIds.includes(source.id)).map(({ source }) => source.contentAt).filter(Boolean);
    const earlier = historical || selectedTimes.some(time => Date.parse(at) - Date.parse(time) > 300000);
    lines.push(`Day: ${publicText(entry.label)}; ${earlier ? 'historical assessment; ' : ''}${status}.`);
  }
  for (const item of run.items) {
    const attempt = item.attempts.at(-1); const verified = item.attempts.find(attempt => attempt.status === 'verified');
    const inventory = run.sources.find(source => source.role === item.adapter)?.capture;
    const absent = inventory?.acquisition?.provenance === 'ordinary-authorized' && !inventory.messageIds.includes(item.before.nativeId);
    const pendingContext = inventory?.acquisition?.provenance === 'ordinary-authorized' && inventory.receipt.sha256 !== item.receipt.sha256;
    const disposition = absent && !verified && !item.correction ? 'earlier review; absent from current Inbox inventory; cleanup held, actor unknown' : pendingContext && !verified && !item.correction ? 'earlier review; current full-thread context not reviewed; cleanup held' : item.correction ? item.correction.disposition === 'complete' ? 'completed; no cleanup owed' : 'dismissed; no cleanup owed' : verified ? `${verified.action === 'trash' ? 'recoverable Trash' : 'archive'} verified; unread preserved` : attempt?.status === 'uncertain' ? `${attempt.action} outcome unknown; held` : item.classification.action === 'keep' ? keepContext(item) : `${item.classification.action === 'trash' ? 'recoverable Trash' : 'archive'} proposed; not yet verified`;
    const stale = Date.parse(at) - Date.parse(item.receipt.observedAt) > 300000;
    lines.push(`${groups[item.adapter]}: ${publicText(item.before.sender)}; ${publicText(item.before.subject)}; ${disposition}${stale && !verified && !item.correction ? '; earlier review, reacquire before cleanup' : ''}.`);
    for (const fact of item.facts) lines.push(`Fact: ${publicText(fact)}`);
  }
  const rawGaps = unique([...gaps.map(gap => gap.replace(/^(?:Initial delivered coverage gap\.\s*)+/, '').replace(/\bstale global source\b/g, 'stale source')), ...assessment.coverage.gaps, ...assessment.sources.flatMap(({ source, qualifications }) => [...source.coverage.gaps, ...qualifications.map(reason => `${source.id}: ${reason}`)]), ...assessment.limits.filter(limit => limit.kind === 'correction').map(limit => `Correction recovery ${limit.state}; persistence unverified`)]);
  const groupedGaps = new Map(); const ungroupedGaps = [];
  for (const gap of rawGaps) {
    const mailSource = run.sources.find(source => ['gmail', 'outlook'].includes(source.role) && gap.startsWith(`${source.id} unreviewed ID `));
    const missing = /^(calendar|tasks) inventory resource (.+) not acquired$/.exec(gap);
    const key = mailSource ? `${groups[mailSource.role]}:unreviewed` : missing ? `${missing[1]}:missing` : null;
    if (!key) { ungroupedGaps.push(gap); continue; }
    const ids = groupedGaps.get(key) ?? new Set(); ids.add(mailSource ? gap.slice(`${mailSource.id} unreviewed ID `.length) : missing[2]); groupedGaps.set(key, ids);
  }
  const groupedReasons = [...groupedGaps].map(([key, ids]) => key.endsWith(':unreviewed') ? `${key.slice(0, -11)}: ${ids.size} inventory entries lack full-context review` : key.startsWith('calendar:') ? `Calendars: ${ids.size} listed calendar${ids.size === 1 ? '' : 's'} not acquired` : `Tasks: ${ids.size} listed Task list${ids.size === 1 ? '' : 's'} not acquired`);
  const translatedGaps = [...ungroupedGaps.map(readable), ...groupedReasons];
  const signature = values => unique(values.filter(Boolean)).sort().join('|');
  const describe = (observed, fetched, day) => `${range(observed, day)}; fetched ${signature(observed) === signature(fetched) ? 'same' : range(fetched, day)}`;
  lines.push(`Coverage day view: content ${describe(assessment.sources.map(({ source }) => source.contentAt), assessment.sources.map(({ source }) => source.retrievedAt), historical ? null : run.day)}.`);
  const coverageGroups = new Map();
  for (const group of unique(Object.values(groups))) {
    const sources = run.sources.filter(source => groups[source.role] === group);
    const selected = (run.cleanup?.acquisitions ?? []).filter(acquisition => sources.some(source => source.id === acquisition.sourceId));
    const observed = sources.map(source => source.capture?.receipt.observedAt); const fetched = sources.map(source => source.capture?.receipt.capturedAt);
    const selectedObserved = selected.map(acquisition => acquisition.receipt.observedAt); const selectedFetched = selected.map(acquisition => acquisition.receipt.capturedAt);
    const key = JSON.stringify([signature(observed), signature(fetched), signature(selectedObserved), signature(selectedFetched)]);
    const coverage = coverageGroups.get(key) ?? { names: [], observed, fetched, selectedObserved, selectedFetched }; coverage.names.push(group); coverageGroups.set(key, coverage);
  }
  for (const coverage of coverageGroups.values()) lines.push(`Coverage ${coverage.names.join(', ')}: global reads ${describe(coverage.observed, coverage.fetched, summary ? null : run.day)}${coverage.selectedObserved.length ? `; selected-message reads ${describe(coverage.selectedObserved, coverage.selectedFetched, run.day)}, not whole-source coverage` : ''}.`);
  const gapCounts = new Map(); for (const gap of translatedGaps) gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
  const materialGaps = [...gapCounts].map(([gap, count]) => `${gap}${count > 1 ? ` (${count} distinct gaps)` : ''}`);
  if (materialGaps.length) lines.push(`Coverage gaps: ${materialGaps.join('; ')}.`);
  const missingLinks = assessment.limits.find(limit => limit.kind === 'source-link'); if (missingLinks) lines.push(`Source links unavailable for ${missingLinks.sourceIds.length} sources; references retained privately.`);
  if (!['current', 'pinned'].includes(assessment.guidance.state)) lines.push('Guidance is unavailable or cached; current guidance remains unverified.');
  if (historical) lines.push(`Day assessment as of ${clock(assessment.checkedAt, historical ? null : run.day)} SGT; current commitments are not reacquired by selected mail reads.`);
  return `${lines.join('\n')}\n`;
}
