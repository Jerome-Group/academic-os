import { assessBriefingPresentation } from './briefing.mjs';
import { renderCompactMorning } from './morning-presentation.mjs';
import { canonical, digest } from './records.mjs';
import { insist, shape, text, hash, stamp, receiptInput } from './fleet-schema.mjs';

const list = (value, limit = 500) => Array.isArray(value) && value.length <= limit;
const unique = values => new Set(values).size === values.length;
const oneLine = value => text(value) && !/[\r\n\x00-\x1f\x7f]/.test(value);
const same = (left, right) => canonical(left) === canonical(right);
const roles = ['gmail', 'outlook', 'calendar-inventory', 'task-inventory', 'calendar', 'tasks'];
const protectedFlags = ['actionRequired', 'reviewRequired', 'ambiguous', 'seriousSecurity', 'unresolved', 'consequential', 'academic', 'research', 'personal', 'billing', 'terms', 'securityWarning'];
export const mailRules = {
  'foodpanda-promotions': { version: 1, sender: 'contact@info.foodpanda.sg', category: 'promotion' },
  'linkedin-feed': { version: 1, sender: 'updates-noreply@linkedin.com', category: 'feed' },
  'linkedin-network': { version: 1, sender: 'messages-noreply@linkedin.com', category: 'automated-network' },
  'merewards-promotions': { version: 1, sender: 'delights@enews.merewards.sg', category: 'promotion' },
  'casetify-launches': { version: 1, sender: 'info@news.casetify.com', category: 'launch' },
  'seerr-available': { version: 1, category: 'self-notification' },
  'successful-login-fyi': { version: 1, category: 'successful-login' }
};
export const mailPolicies = Object.freeze({
  1: Object.freeze({ version: 1, name: 'legacy-morning-mail-v1', unknownLogin: 'informational-fallback', digest: '8ad3996a98ab9af02ef02f265365a1300d7e09fc354540527e2b9fdd08db0029' }),
  2: Object.freeze({ version: 2, name: 'conservative-morning-mail-v2', unknownLogin: 'keep', ruleSetVersion: 1, protectedContextVersion: 1, routineNotice: 'useful-facts-before-archive' })
});
export function deliveryInput(value, slackOnly = false) {
  shape(value, ['scope', 'ownerRef'], 'delivery target'); insist(oneLine(value.ownerRef), 'Delivery target requires retained owner authority');
  shape(value.scope, ['service', 'account', 'environment', 'surface', 'resource'], 'delivery scope');
  for (const key of ['service', 'account', 'environment', 'surface', 'resource']) insist(oneLine(value.scope[key]), `Missing exact delivery ${key}`);
  insist(value.scope.service === 'slack' && value.scope.surface === 'connector' || !slackOnly && value.scope.service === 'chatgpt' && value.scope.surface === 'native', 'Delivery requires an authorized Slack or parent native-message scope');
}
export function deliveryReadback(command, intent, at) {
  insist(intent && intent.scope && command.scope && same(command.scope, intent.scope) && stamp(command.acquiredAt) && Date.parse(command.acquiredAt) >= Date.parse(intent.at) && Date.parse(command.acquiredAt) <= Date.parse(at), 'Delivery readback must match exact destination and acquisition interval');
}
const planDigest = item => digest({ before: item.before, context: item.context, facts: item.facts, classification: item.classification, correction: item.correction });
const planMap = run => Object.fromEntries(run.items.map(item => [item.key, planDigest(item)]));
const uncertainRun = run => run.delivery?.status === 'uncertain' || run.summary?.delivery?.status === 'uncertain' || run.items.some(item => item.attempts.at(-1)?.status === 'uncertain');
const terminalItem = item => item.attempts.some(attempt => attempt.status === 'verified');
const globalGaps = (run, at) => [...(run.sealed?.gaps ?? []).map(gap => `Initial delivered coverage gap. ${gap}`), ...run.sources.flatMap(source => !source.capture ? [`${source.id} missing global acquisition`] : [!source.capture.paginationComplete || source.capture.cached || !source.capture.receipt.coverage.complete || source.capture.receipt.coverage.gaps.length ? `${source.id} incomplete global coverage` : null, Date.parse(at) - Date.parse(source.capture.receipt.observedAt) > 300000 ? `${source.id} stale global source` : null].filter(Boolean))];
const outcomeDigest = run => digest(run.items.map(item => ({ key: item.key, correction: item.correction, outcome: item.attempts.at(-1)?.status ?? 'not-attempted' })));
export function mailSnapshot(value, adapter) {
  shape(value, adapter === 'gmail' ? ['nativeId', 'threadId', 'subject', 'sender', 'unread', 'labels'] : ['nativeId', 'threadId', 'subject', 'sender', 'unread', 'folder', 'folderId'], 'mail snapshot');
  for (const key of ['nativeId', 'threadId', 'subject', 'sender']) insist(oneLine(value[key]), `Invalid mail ${key}`);
  insist(typeof value.unread === 'boolean', 'Mail unread state must be known');
  if (adapter === 'gmail') insist(list(value.labels, 64) && value.labels.every(oneLine) && unique(value.labels), 'Invalid Gmail label readback');
  else insist(oneLine(value.folder) && oneLine(value.folderId), 'Outlook requires a stable native ID and folder readback');
}
function reviewInput(value) {
  shape(value, ['adapter', 'before', 'receipt', 'context', 'ruleId', 'facts'], 'mail review');
  insist(['gmail', 'outlook'].includes(value.adapter), 'Unknown mail adapter'); mailSnapshot(value.before, value.adapter); receiptInput(value.receipt);
  shape(value.context, ['complete', 'safeUnreadInspection', ...protectedFlags, 'informational', 'orderReceipt', 'invitation', 'directMessage', 'recognizedLogin', 'category', 'threadDigest'], 'mail context');
  for (const key of ['complete', 'safeUnreadInspection', ...protectedFlags, 'informational', 'orderReceipt', 'invitation', 'directMessage', 'recognizedLogin']) insist(typeof value.context[key] === 'boolean', `Missing conservative mail context ${key}`);
  insist(hash(value.context.threadDigest) && oneLine(value.context.category), 'Invalid thread context attribution');
  insist(value.ruleId === null || Object.hasOwn(mailRules, value.ruleId), 'Unknown owner rule');
  insist(list(value.facts, 20) && value.facts.every(oneLine) && unique(value.facts), 'Invalid useful mail facts');
}
export function classifyMail(review, account, grants, policyVersion = 2) {
  reviewInput(review); const { context, before, ruleId, adapter } = review;
  const policy = mailPolicies[policyVersion]; insist(policy, 'Unsupported pinned classification policy');
  const decision = (action, reason, rule = null) => ({ action, reason, rule, policyVersion: policy.version, policyDigest: policy.digest ?? digest(policy) });
  const keep = reason => decision('keep', reason);
  if (adapter === 'gmail' ? !before.labels.includes('INBOX') : before.folder !== 'Inbox') return keep('already-outside-inbox');
  if (!context.complete || !context.safeUnreadInspection) return keep('incomplete-or-unsafe-thread-inspection');
  if (protectedFlags.some(key => context[key]) || context.invitation || context.directMessage) return keep('protected-context');
  if (policy.unknownLogin === 'keep' && context.category === 'successful-login' && !context.recognizedLogin) return keep('unrecognized-successful-login-notice');
  if ((context.orderReceipt || context.recognizedLogin || context.category === 'account-notice') && review.facts.length === 0) return keep('useful-receipt-facts-required');
  const rule = ruleId && mailRules[ruleId]; const grant = rule && grants.find(value => value.id === ruleId && value.version === rule.version);
  if (context.recognizedLogin || context.category === 'account-notice') return context.informational ? decision('archive', 'delivered-routine-account-notice') : keep('insufficient-judgment');
  if (adapter === 'gmail' && grant && !context.orderReceipt) {
    const sender = before.sender.toLowerCase();
    const exactSender = rule.sender ? sender === rule.sender : ruleId === 'seerr-available' ? sender === account.toLowerCase() && before.subject.includes('[Seerr]') && before.subject.includes('Request Now Available') : context.recognizedLogin && !context.securityWarning;
    if (exactSender && context.category === rule.category) return decision('trash', ruleId, { ...grant });
  }
  return context.informational ? decision('archive', context.orderReceipt ? 'delivered-useful-receipt' : 'harmless-informational') : keep('insufficient-judgment');
}
export function morningInput(command) {
  const fields = { open: ['day', 'accounts', 'sources', 'rules', 'ownerRef', 'policyVersion', 'delivery', 'cleanupMode'], refresh: ['generation', 'items', 'sourceRef', 'reason'], source: ['sourceId', 'jobKey', 'receipt', 'paginationComplete', 'cached', 'resourceIds', 'messageIds', 'window', 'generation', 'acquisition'], review: ['items', 'generation'], correct: ['adapter', 'nativeId', 'sourceRef', 'reason', 'disposition'], seal: ['briefing', 'calendar', 'presentation'], 'send-intent': ['sendRef', 'bodyDigest'], 'send-ack': ['sendRef', 'bodyDigest', 'readbackRef', 'deliveredBodyDigest', 'nativeId', 'scope', 'acquiredAt'], 'send-resolve': ['sendRef', 'bodyDigest', 'sourceRef', 'reason', 'outcome', 'scope', 'acquiredAt'], 'action-intent': ['adapter', 'nativeId', 'action', 'before', 'receipt', 'destination', 'generation'], 'action-result': ['adapter', 'nativeId', 'intentDigest', 'after', 'receipt', 'outcome'], summary: [], 'edit-intent': ['editRef', 'bodyDigest', 'nativeId'], 'edit-ack': ['editRef', 'bodyDigest', 'nativeId', 'readbackRef', 'deliveredBodyDigest', 'scope', 'acquiredAt'], 'edit-resolve': ['editRef', 'bodyDigest', 'nativeId', 'priorBodyDigest', 'readbackRef', 'sourceRef', 'reason', 'outcome', 'scope', 'acquiredAt'], 'edit-gap': ['sourceRef', 'reason'], status: [] };
  insist(command && Object.hasOwn(fields, command.step), 'Invalid morning step'); shape(command, ['step', 'runId', ...fields[command.step]], 'morning command'); insist(oneLine(command.runId), 'Invalid morning run identity');
  if (command.step === 'open') {
    insist(command.cleanupMode === undefined || command.cleanupMode === 'batched-v1', 'Unsupported cleanup mode');
    insist(command.policyVersion === undefined || Object.hasOwn(mailPolicies, command.policyVersion), 'Unknown pinned mail policy version'); if (command.delivery) deliveryInput(command.delivery, true); insist(command.policyVersion !== 2 || command.delivery, 'Current morning policy requires an exact delivery target');
    insist(/^\d{4}-\d\d-\d\d$/.test(command.day) && new Date(`${command.day}T00:00:00.000Z`).toISOString().startsWith(command.day) && command.runId === command.day, 'One morning run per Singapore day');
    shape(command.accounts, ['gmail', 'outlook'], 'authorized morning accounts');
    for (const adapter of ['gmail', 'outlook']) { shape(command.accounts[adapter], ['account', 'entityId'], 'morning account'); insist(oneLine(command.accounts[adapter]?.account) && oneLine(command.accounts[adapter]?.entityId), 'Both exact authorized accounts are required'); }
    insist(command.accounts.gmail.account !== command.accounts.outlook.account && oneLine(command.ownerRef), 'Distinct accounts and retained owner source are required');
    insist(list(command.sources, 64) && command.sources.length >= 4 && unique(command.sources.map(row => row.id)), 'Invalid morning source inventory');
    for (const row of command.sources) { shape(row, ['id', 'role', 'entityId'], 'morning source'); insist(oneLine(row.id) && roles.includes(row.role) && oneLine(row.entityId), 'Invalid morning source'); }
    insist(list(command.rules, 16) && unique(command.rules.map(row => row.id)), 'Invalid versioned owner rule set');
    for (const rule of command.rules) { shape(rule, ['id', 'version', 'ownerRef'], 'owner mail rule'); insist(Object.hasOwn(mailRules, rule.id) && rule.version === mailRules[rule.id].version && oneLine(rule.ownerRef), 'Rule requires exact version and applicable owner source'); }
  }
  if (command.generation !== undefined) insist(Number.isSafeInteger(command.generation) && command.generation > 0 && command.generation <= 32, 'Invalid cleanup generation');
  if (command.step === 'refresh') { insist(Number.isSafeInteger(command.generation) && command.generation > 0 && command.generation <= 32 && list(command.items, 20) && command.items.length > 0 && oneLine(command.sourceRef) && oneLine(command.reason), 'Invalid bounded refresh'); for (const item of command.items) { shape(item, ['adapter', 'nativeId'], 'refresh item'); insist(['gmail', 'outlook'].includes(item.adapter) && oneLine(item.nativeId), 'Invalid selected refresh ID'); } insist(unique(command.items.map(item => itemKey(item.adapter, item.nativeId))), 'Duplicate selected refresh ID'); }
  if (command.step === 'source') {
    insist(oneLine(command.sourceId) && (hash(command.jobKey) || command.jobKey === null && command.acquisition?.provenance === 'ordinary-authorized'), 'Invalid morning source job');
    if (command.acquisition !== undefined) { shape(command.acquisition, ['provenance', 'ownerRef', 'collectionRef'], 'source acquisition'); insist(['ordinary-authorized', 'admitted'].includes(command.acquisition.provenance) && oneLine(command.acquisition.ownerRef) && oneLine(command.acquisition.collectionRef), 'Source acquisition requires explicit provenance and retained authority'); } receiptInput(command.receipt);
    insist(typeof command.paginationComplete === 'boolean' && typeof command.cached === 'boolean', 'Missing pagination/cache declaration');
    for (const key of ['resourceIds', 'messageIds']) insist(list(command[key]) && command[key].every(oneLine) && unique(command[key]), 'Invalid acquired source IDs');
    if (command.window !== null) { shape(command.window, ['start', 'end'], 'morning source window'); insist(stamp(command.window.start) && stamp(command.window.end), 'Invalid source window'); }
  }
  if (command.step === 'review') { insist(list(command.items) && command.items.length > 0, 'Invalid reviewed item batch'); command.items.forEach(reviewInput); insist(unique(command.items.map(row => `${row.adapter}:${row.before.nativeId}`)), 'Duplicate reviewed ID'); }
  if (['correct', 'action-intent', 'action-result'].includes(command.step)) insist(['gmail', 'outlook'].includes(command.adapter) && oneLine(command.nativeId), 'Invalid scoped mail item');
  if (command.step === 'correct') insist(['complete', 'dismissed'].includes(command.disposition) && oneLine(command.sourceRef) && oneLine(command.reason), 'Correction requires exact scope and owner source');
  if (command.step === 'seal') insist(command.presentation === undefined || command.presentation === 'compact-v1', 'Unknown morning presentation version');
  if (command.step === 'seal') for (const key of ['briefing', 'calendar']) { shape(command[key], key === 'briefing' ? ['receipt', 'result', 'inputReceipt', 'input', 'assessmentReceipt', 'assessment'] : ['receipt', 'result', 'inputReceipt', 'input'], `${key} acceptance`); receiptInput(command[key].receipt); receiptInput(command[key].inputReceipt); if (key === 'briefing') receiptInput(command[key].assessmentReceipt); insist(command[key].result && typeof command[key].result === 'object', 'Missing declared assessment'); }
  if (['send-intent', 'send-ack', 'send-resolve'].includes(command.step)) insist(oneLine(command.sendRef) && hash(command.bodyDigest), 'Invalid morning delivery binding');
  if (command.step === 'send-ack') insist(oneLine(command.readbackRef) && hash(command.deliveredBodyDigest) && oneLine(command.nativeId), 'Missing exact delivered message readback');
  if (command.step === 'send-resolve') insist(command.outcome === 'known-unexecuted' && oneLine(command.sourceRef) && oneLine(command.reason), 'Uncertain send requires attributable no-effect reconciliation');
  if (command.step === 'action-intent') { insist(['archive', 'trash'].includes(command.action), 'Only reversible mail intents are supported'); mailSnapshot(command.before, command.adapter); receiptInput(command.receipt); if (command.adapter === 'outlook') { shape(command.destination, ['folderId', 'folder'], 'Outlook destination'); insist(oneLine(command.destination.folderId) && command.destination.folder === 'Archive', 'Outlook archive requires an explicit native folder destination'); } else insist(command.destination === null, 'Gmail uses labels, not a folder destination'); }
  if (command.step === 'action-result') { insist(hash(command.intentDigest) && ['verified', 'uncertain', 'known-unexecuted'].includes(command.outcome), 'Invalid action outcome'); if (command.after !== null) mailSnapshot(command.after, command.adapter); receiptInput(command.receipt); }
  if (['edit-intent', 'edit-ack', 'edit-resolve'].includes(command.step)) insist(oneLine(command.editRef) && hash(command.bodyDigest) && oneLine(command.nativeId), 'Invalid same-message edit binding');
  if (command.step === 'edit-ack') insist(oneLine(command.readbackRef) && hash(command.deliveredBodyDigest), 'Edit acknowledgement requires exact body readback');
  if (command.step === 'edit-resolve') insist(command.outcome === 'known-unexecuted' && hash(command.priorBodyDigest) && oneLine(command.sourceRef) && oneLine(command.reason) && oneLine(command.readbackRef), 'Edit uncertainty requires exact same-message no-effect evidence');
  if (command.step === 'edit-gap') insist(oneLine(command.sourceRef) && oneLine(command.reason), 'Unsupported edit requires attributable platform gap');
  return command;
}
export function morningEvidence(command) {
  morningInput(command);
  const receipts = command.receipt ? [command.receipt] : command.step === 'review' ? command.items.map(row => row.receipt) : command.step === 'seal' ? [command.briefing.receipt, command.briefing.inputReceipt, command.briefing.assessmentReceipt, command.calendar.receipt, command.calendar.inputReceipt] : [];
  const refs = command.step === 'open' ? [command.ownerRef, ...(command.delivery ? [command.delivery.ownerRef] : []), ...command.rules.map(rule => rule.ownerRef)] : ['correct', 'send-resolve', 'edit-gap', 'refresh'].includes(command.step) ? [command.sourceRef] : command.step === 'edit-resolve' ? [command.sourceRef, command.readbackRef] : ['send-ack', 'edit-ack'].includes(command.step) ? [command.readbackRef] : [];
  if (command.step === 'source' && command.acquisition) refs.push(command.acquisition.ownerRef, command.acquisition.collectionRef);
  return { receipts, refs };
}
const runWindow = day => { const start = new Date(Date.parse(`${day}T00:00:00.000Z`) - 28800000).toISOString(); return { start, end: new Date(Date.parse(start) + 86400000).toISOString() }; };
function fresh(receipt, run, at) { insist(Date.parse(receipt.observedAt) >= Date.parse(run.openedAt) && Date.parse(receipt.observedAt) <= Date.parse(receipt.capturedAt) && Date.parse(receipt.capturedAt) <= Date.parse(at) && Date.parse(at) - Date.parse(receipt.observedAt) <= 300000, 'Morning acquisition needs fresh source time after this run opened'); }
const itemKey = (adapter, nativeId) => digest({ adapter, nativeId });
const md = value => value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
export function renderMorning(run, briefingBody, gaps) {
  const lines = [`# Morning ${run.day} · Asia/Singapore`, '', briefingBody.trim(), '', '## Mail review', ''];
  for (const adapter of ['gmail', 'outlook']) for (const action of ['keep', 'archive', 'trash', 'complete', 'dismissed']) {
    const rows = run.items.filter(row => row.adapter === adapter && (row.correction?.disposition ?? row.classification.action) === action);
    if (rows.length) lines.push(`- ${adapter} ${['archive', 'trash'].includes(action) ? `planned ${action}` : action} (${rows.length}). ${rows.map(row => `${md(row.before.sender)}; ${md(row.before.subject)} [${md(row.before.nativeId)}] (${md(row.correction?.reason ?? row.classification.reason)})`).join('; ')}.`);
  }
  const facts = run.items.flatMap(row => row.facts.map(fact => `- ${md(row.before.nativeId)}. ${fact}`));
  if (facts.length) lines.push('', '## Useful receipt facts', '', ...facts);
  lines.push('', '## Coverage and cleanup', '', `Reviewed ${run.items.length} IDs. Native cleanup outcomes require subsequent same-ID readback.`, ...run.sources.map(row => `- ${md(row.id)}. ${row.capture ? `${row.capture.receipt.coverage.complete && row.capture.paginationComplete && !row.capture.cached ? 'Declared complete' : 'Partial or cached'}; source ${row.capture.receipt.observedAt}; fetched ${row.capture.receipt.capturedAt}.` : 'Not acquired.'}`), ...gaps.map(gap => `- Gap. ${md(gap)}.`));
  return `${lines.join('\n')}\n`;
}
export function morningTransition(state, command, root, at) {
  morningInput(command); state.morningRuns ??= [];
  let run = state.morningRuns.find(row => row.id === command.runId);
  const entity = id => { const row = state.entities.find(value => value.expected.id === id); insist(row, 'Unknown morning fleet entity'); return row.expected; };
  if (command.step === 'open') {
    insist(command.day === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)), 'Morning run must use the actual Singapore day');
    const specification = digest(command);
    if (run) { insist(run.specification === specification, 'Conflicting morning run under the same day; inspect existing run'); return 'coalesced'; }
    insist(state.morningRuns.length < 32, 'Morning retention bound reached; prior runs cannot be discarded');
    for (const adapter of ['gmail', 'outlook']) { const account = command.accounts[adapter]; const expected = entity(account.entityId); insist(expected.scope.account === account.account && expected.scope.surface === (adapter === 'gmail' ? 'connector' : 'browser') && expected.scope.service === adapter, 'Morning account must match its exact authorized fleet adapter'); }
    for (const source of command.sources) entity(source.entityId);
    for (const role of ['gmail', 'outlook', 'calendar-inventory', 'task-inventory']) insist(command.sources.filter(row => row.role === role).length === 1, 'Required account and full calendar/Task inventories must be declared once');
    for (const adapter of ['gmail', 'outlook']) insist(command.sources.find(row => row.role === adapter).entityId === command.accounts[adapter].entityId, 'Mail source crosses authorized account');
    state.morningRuns.push({ id: command.runId, day: command.day, openedAt: at, specification, effectKey: digest({ responsibility: root.effectKey, day: command.day }), accounts: command.accounts, ...(command.policyVersion !== undefined ? { policyVersion: command.policyVersion } : {}), ...(command.delivery ? { deliveryTarget: command.delivery } : {}), ...(command.cleanupMode ? { cleanupMode: command.cleanupMode } : {}), rules: command.rules, ownerRef: command.ownerRef, sources: command.sources.map(row => ({ ...row, capture: null })), items: [], delivery: null, sealed: null });
    return 'morning-opened';
  }
  insist(run, 'Morning run is not open'); if (command.step === 'status') return 'retained';
  const row = () => { const found = run.items.find(value => value.key === itemKey(command.adapter, command.nativeId)); insist(found, 'Unknown reviewed mail ID'); return found; };
  const scopeReceipt = (receipt, adapter) => insist(same(receipt.scope, entity(run.accounts[adapter].entityId).scope), 'Mail receipt crosses exact adapter/account scope');
  if (command.step === 'refresh') {
    insist(run.policyVersion === 2 && run.delivery?.status === 'delivered' && !uncertainRun(run), 'Refresh requires resolved delivery, edits and mail effects');
    insist(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)) === run.day, 'Refresh must remain on the same Singapore day');
    insist(command.generation === (run.cleanup?.generation ?? 0) + 1, 'Refresh must advance the exact cleanup generation');
    for (const selected of command.items) { const item = run.items.find(row => row.key === itemKey(selected.adapter, selected.nativeId)); insist(!item || !terminalItem(item), 'Verified moves are terminal and cannot be refreshed or repeated'); }
    run.cleanupHistory ??= []; if (run.cleanup) run.cleanupHistory.push(run.cleanup);
    run.cleanup = { kind: 'selected-mail-batch-v1', generation: command.generation, openedAt: at, sourceRef: command.sourceRef, reason: command.reason, items: command.items, acquisitions: [], globalGapProvenance: { bodyDigest: run.sealed.bodyDigest, sealedAt: run.sealed.at, gaps: [...run.sealed.gaps] }, globalGaps: globalGaps(run, at), deliveredPlans: run.cleanup?.deliveredPlans ?? planMap(run), deliveryBodyDigest: run.cleanup?.deliveryBodyDigest ?? run.delivery.bodyDigest };
  }
  if (command.step === 'source') {
    const ordinary = command.acquisition?.provenance === 'ordinary-authorized';
    if (ordinary) insist(command.jobKey === null && command.acquisition.ownerRef === run.ownerRef && !uncertainRun(run) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)) === run.day, 'Ordinary acquisition requires existing owner scope, same day and resolved effects');
    if (run.delivery) {
      insist(run.delivery.status === 'delivered' && run.cleanup && !uncertainRun(run) && command.generation === run.cleanup.generation, 'Same-run acquisition requires the current resolved refresh generation');
      const source = run.sources.find(row => row.id === command.sourceId); insist(source && ['gmail', 'outlook'].includes(source.role), 'A cleanup batch acquires only explicitly selected mail IDs');
      const job = state.jobs.find(row => row.key === command.jobKey);
      insist(ordinary || job?.status === 'completed' && job.input.kind === 'briefing-source-read' && job.input.occurrence === `${run.id}/refresh/${run.cleanup.generation}` && job.input.entityIds.includes(source.entityId) && job.receipts.some(receipt => same(receipt, command.receipt)), 'Refresh requires a new generation-bound completed fleet acquisition');
      insist(same(command.receipt.scope, entity(source.entityId).scope), 'Refresh source crosses exact account scope'); fresh(command.receipt, run, at);
      insist(Date.parse(command.receipt.observedAt) > Date.parse(run.cleanup.openedAt) && (!source.capture || Date.parse(command.receipt.observedAt) > Date.parse(source.capture.receipt.observedAt)), 'Refresh source must be genuinely newer than original source and generation');
      insist(command.paginationComplete && !command.cached && command.receipt.coverage.complete && !command.receipt.coverage.gaps.length && command.window === null && command.resourceIds.length === 0 && command.messageIds.length > 0 && command.messageIds.every(id => run.cleanup.items.some(item => item.adapter === source.role && item.nativeId === id)), 'Refresh coverage must be complete only for selected IDs, never a new whole-inbox inventory');
      insist(run.cleanup.acquisitions.length < 64 && !run.cleanup.acquisitions.some(acquisition => (ordinary ? acquisition.acquisition?.collectionRef === command.acquisition.collectionRef : acquisition.jobKey === command.jobKey)), 'Refresh acquisition is already retained or exceeds its bound');
      run.cleanup.acquisitions.push({ ...command, coverageKind: 'selected-ids' }); return 'morning-refresh-acquired';
    }
    insist(!run.delivery, 'Delivered or uncertain morning body is immutable; inspect existing delivery'); const source = run.sources.find(row => row.id === command.sourceId); insist(source, 'Unknown morning source');
    const job = state.jobs.find(row => row.key === command.jobKey); insist(ordinary || job?.status === 'completed' && job.input.kind === 'briefing-source-read' && job.input.entityIds.includes(source.entityId) && job.receipts.some(receipt => same(receipt, command.receipt)), 'Morning acquisition requires its completed fleet read and exact retained receipt');
    insist(same(command.receipt.scope, entity(source.entityId).scope), 'Morning source crosses fleet scope'); fresh(command.receipt, run, at);
    if (['calendar', 'tasks'].includes(source.role)) insist(same(command.window, runWindow(run.day)), 'Calendar/Task acquisition must cover the full Singapore day');
    insist(!source.capture || Date.parse(source.capture.receipt.observedAt) <= Date.parse(command.receipt.observedAt), 'Morning source cannot rewind');
    if (ordinary && source.capture) { source.captureHistory ??= []; insist(source.captureHistory.length < 32, 'Source acquisition history bound reached'); source.captureHistory.push(source.capture); }
    source.capture = command; run.sealed = null;
  }
  if (command.step === 'review') {
    if (run.delivery) {
      insist(run.delivery.status === 'delivered' && run.cleanup && !uncertainRun(run) && command.generation === run.cleanup.generation, 'Review requires the current resolved refresh generation');
      for (const review of command.items) {
        insist(run.cleanup.items.some(item => item.adapter === review.adapter && item.nativeId === review.before.nativeId), 'Review ID is outside the selected batch'); scopeReceipt(review.receipt, review.adapter); fresh(review.receipt, run, at);
        const source = run.sources.find(source => source.role === review.adapter);
        insist(run.cleanup.acquisitions.some(acquisition => acquisition.sourceId === source.id && acquisition.messageIds.includes(review.before.nativeId) && same(acquisition.receipt, review.receipt)), 'Refreshed context and before state must bind the exact admitted selected-ID acquisition');
        const key = itemKey(review.adapter, review.before.nativeId); let existing = run.items.find(item => item.key === key);
        if (existing) {
          insist(!terminalItem(existing) && Date.parse(review.receipt.observedAt) > Date.parse(existing.receipt.observedAt), 'Review must be genuinely new and cannot reopen a verified move');
          existing.reviewHistory ??= []; insist(existing.reviewHistory.length < 32, 'Review history bound reached'); existing.reviewHistory.push({ before: existing.before, receipt: existing.receipt, context: existing.context, facts: existing.facts, ruleId: existing.ruleId, classification: existing.classification, reviewDigest: existing.reviewDigest, generation: existing.cleanupGeneration ?? null });
          Object.assign(existing, review, { reviewDigest: digest(review), classification: classifyMail(review, run.accounts[review.adapter].account, run.rules, run.policyVersion), cleanupGeneration: run.cleanup.generation });
        } else { insist(run.items.length < 500, 'Morning reviewed-ID bound reached'); existing = { ...review, key, reviewDigest: digest(review), classification: classifyMail(review, run.accounts[review.adapter].account, run.rules, run.policyVersion), correction: null, attempts: [], cleanupGeneration: run.cleanup.generation, reviewHistory: [] }; run.items.push(existing); }
      }
      return 'morning-refresh-reviewed';
    }
    insist(!run.delivery, 'Sealed delivery already attempted; review existing run');
    for (const review of command.items) {
      scopeReceipt(review.receipt, review.adapter); fresh(review.receipt, run, at);
      const source = run.sources.find(row => row.role === review.adapter); insist(source.capture?.messageIds.includes(review.before.nativeId), 'Every reviewed ID must belong to acquired mail inventory');
      if (source.capture?.acquisition?.provenance === 'ordinary-authorized') insist(same(source.capture.receipt, review.receipt), 'Ordinary review must bind current full-thread acquisition receipt');
      const key = itemKey(review.adapter, review.before.nativeId); const existing = run.items.find(row => row.key === key);
      if (existing) {
        if (existing.reviewDigest === digest(review)) continue;
        insist(source.capture?.acquisition?.provenance === 'ordinary-authorized' && same(source.capture.receipt, review.receipt) && !terminalItem(existing) && Date.parse(review.receipt.observedAt) > Date.parse(existing.receipt.observedAt), 'Changed unsent review requires genuinely new ordinary acquisition and exact current thread receipt');
        existing.reviewHistory ??= []; insist(existing.reviewHistory.length < 32, 'Review history bound reached'); existing.reviewHistory.push({ before: existing.before, receipt: existing.receipt, context: existing.context, facts: existing.facts, ruleId: existing.ruleId, classification: existing.classification, reviewDigest: existing.reviewDigest });
        Object.assign(existing, review, { classification: classifyMail(review, run.accounts[review.adapter].account, run.rules, run.policyVersion), reviewDigest: digest(review) }); continue;
      }
      insist(run.items.length < 500, 'Morning reviewed-ID bound reached');
      run.items.push({ ...review, key, reviewDigest: digest(review), classification: classifyMail(review, run.accounts[review.adapter].account, run.rules, run.policyVersion ?? 1), correction: null, attempts: [] });
    }
    run.sealed = null;
  }
  if (command.step === 'correct') {
    insist(!run.delivery || run.delivery.status === 'delivered' && run.cleanup && !uncertainRun(run), 'Correction requires a resolved same-run refresh'); const item = row();
    if (run.delivery) { item.correctionHistory ??= []; if (item.correction) item.correctionHistory.push(item.correction); }
    item.correction = { disposition: command.disposition, sourceRef: command.sourceRef, reason: command.reason, at }; if (!run.delivery) run.sealed = null;
  }
  if (command.step === 'seal') {
    insist(!run.delivery, 'Morning delivery already attempted');
    const briefing = command.briefing.result; const calendar = command.calendar.result;
    insist(briefing.mode === 'draft' && ['checked', 'degraded'].includes(briefing.status) && typeof briefing.body === 'string' && briefing.body.length > 0 && Buffer.byteLength(briefing.body) <= 131072 && digest(briefing.body) === briefing.bodyDigest, 'Exact rendered briefing assessment is required');
    const briefingReceipt = command.briefing.assessment;
    insist(briefingReceipt?.schemaVersion === 1 && briefingReceipt.mode === 'draft' && briefingReceipt.status === briefing.status && briefingReceipt.assurance === 'advisory-reported-inputs' && stamp(briefingReceipt.checkedAt) && briefingReceipt.inputDigest === command.briefing.inputReceipt.sha256 && briefingReceipt.bodyDigest === briefing.bodyDigest && command.briefing.receipt.observedAt === briefingReceipt.checkedAt, 'Briefing needs its actual generated receipt, input and original assessment time');
    insist(calendar.schemaVersion === 1 && calendar.ruleVersion === 1 && calendar.execution === 'none' && calendar.assurance === 'declared-calendar-evidence' && stamp(calendar.evaluatedAt) && calendar.inputDigest === command.calendar.inputReceipt.sha256 && command.calendar.receipt.observedAt === calendar.evaluatedAt && ['checked', 'needs-evidence', 'revise'].includes(calendar.status) && Array.isArray(calendar.findings) && Array.isArray(calendar.fieldResults) && Array.isArray(calendar.inventoryResults) && (calendar.morningResults === null || Array.isArray(calendar.morningResults)), 'Existing complete calendar assessment with original evaluation time is required');
    fresh({ ...command.briefing.receipt, observedAt: briefingReceipt.checkedAt }, run, at); fresh({ ...command.calendar.receipt, observedAt: calendar.evaluatedAt }, run, at);
    const calendarWindow = command.calendar.input?.intent?.window;
    insist(calendarWindow?.timeZone === 'Asia/Singapore' && Date.parse(calendarWindow.start) === Date.parse(runWindow(run.day).start) && Date.parse(calendarWindow.end) === Date.parse(runWindow(run.day).end), 'Calendar assessment input must bind this full Singapore day');
    for (const acceptance of [command.briefing, command.calendar]) { fresh(acceptance.receipt, run, at); fresh(acceptance.inputReceipt, run, at); }
    const gaps = run.items.filter(item => !item.context.complete || !item.context.safeUnreadInspection).map(item => `${item.adapter} ${item.before.nativeId} incomplete or unsafe unread-preserving context inspection`);
    if (run.cleanupMode === 'batched-v1') for (const item of run.items) { try { fresh(item.receipt, run, at); } catch { gaps.push(`${item.adapter} ${item.before.nativeId} stale thread context`); } }
    for (const source of run.sources) {
      if (!source.capture) { gaps.push(`${source.id} missing acquisition`); continue; }
      try { fresh(source.capture.receipt, run, at); } catch { gaps.push(`${source.id} stale source`); }
      if (!source.capture.paginationComplete || source.capture.cached || !source.capture.receipt.coverage.complete || source.capture.receipt.coverage.gaps.length) gaps.push(`${source.id} incomplete pagination, cache, or source coverage`);
      if (['gmail', 'outlook'].includes(source.role)) for (const id of source.capture.messageIds) if (!run.items.some(item => item.adapter === source.role && item.before.nativeId === id)) gaps.push(`${source.id} unreviewed ID ${id}`);
    }
    for (const item of run.items) { const source = run.sources.find(source => source.role === item.adapter); if (source.capture?.acquisition?.provenance === 'ordinary-authorized') { if (!source.capture.messageIds.includes(item.before.nativeId)) gaps.push(`${item.adapter} ${item.before.nativeId} not in current mail inventory; earlier review held, actor unknown`); else if (!same(source.capture.receipt, item.receipt)) gaps.push(`${item.adapter} ${item.before.nativeId} current full-thread context not reviewed; earlier review held`); } }
    for (const [inventoryRole, sourceRole] of [['calendar-inventory', 'calendar'], ['task-inventory', 'tasks']]) {
      const inventory = run.sources.find(row => row.role === inventoryRole);
      if (inventory.capture) for (const id of inventory.capture.resourceIds) if (!run.sources.some(row => row.role === sourceRole && entity(row.entityId).scope.resource === id && row.capture)) gaps.push(`${sourceRole} inventory resource ${id} not acquired`);
    }
    if (briefing.status !== 'checked' || calendar.status !== 'checked') gaps.push('briefing/calendar declared assessment degraded');
    const diagnosticBody = renderMorning(run, briefing.body, gaps); const assessed = command.presentation === 'compact-v1' ? assessBriefingPresentation(command.briefing.input, briefing, briefingReceipt.checkedAt) : null;
    const body = assessed ? renderCompactMorning(run, assessed, { at, gaps, internalIds: state.jobs.flatMap(job => [job.key, job.ticket]) }) : diagnosticBody; insist(Buffer.byteLength(body) <= 131072, 'Morning presentation body exceeds byte bound'); run.sealed = { body, bodyDigest: digest(body), ...(assessed ? { presentation: command.presentation, diagnostic: { body: diagnosticBody, bodyDigest: digest(diagnosticBody), assessment: assessed } } : {}), gaps, at, briefing: command.briefing, calendar: command.calendar }; return gaps.length ? 'morning-degraded' : 'morning-sealed';
  }
  if (command.step === 'send-intent') {
    if (run.sealed) { for (const source of run.sources) if (source.capture) { try { fresh(source.capture.receipt, run, at); } catch (error) { insist(run.cleanupMode === 'batched-v1' && run.sealed.gaps.includes(`${source.id} stale source`), error.message); } } for (const assessment of [run.sealed.briefing, run.sealed.calendar]) fresh(assessment.receipt, run, at); }
    insist(run.sealed && !run.delivery && run.sealed.bodyDigest === command.bodyDigest, 'Send requires exact sealed body and no prior uncertain delivery');
    run.delivery = { ...(run.deliveryTarget ? { scope: run.deliveryTarget.scope, ownerRef: run.deliveryTarget.ownerRef } : {}), status: 'uncertain', sendRef: command.sendRef, bodyDigest: command.bodyDigest, at, readbackRef: null, nativeId: null };
  }
  if (['send-ack', 'send-resolve'].includes(command.step)) {
    insist(run.delivery?.status === 'uncertain' && run.delivery.sendRef === command.sendRef && run.delivery.bodyDigest === command.bodyDigest, 'Morning acknowledgement crosses exact send attempt');
    if (run.deliveryTarget) deliveryReadback(command, run.delivery, at);
    if (command.step === 'send-ack') { insist(command.readbackRef !== command.sendRef && command.deliveredBodyDigest === run.delivery.bodyDigest, 'Delivery requires separate exact-body readback'); Object.assign(run.delivery, { status: 'delivered', readbackRef: command.readbackRef, nativeId: command.nativeId, acknowledgedAt: at }); }
    else { run.deliveryHistory ??= []; run.deliveryHistory.push({ ...run.delivery, resolution: command }); run.delivery = null; }
  }
  if (command.step === 'action-intent') {
    const item = row(); scopeReceipt(command.receipt, command.adapter); fresh(command.receipt, run, at);
    if (run.cleanup) {
      insist(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)) === run.day, 'Cleanup must remain on the same Singapore day');
      insist(!uncertainRun(run) && command.generation === run.cleanup.generation && item.cleanupGeneration === run.cleanup.generation && run.cleanup.items.some(selected => item.key === itemKey(selected.adapter, selected.nativeId)), 'Cleanup requires a current resolved selected-ID review');
      insist(same(command.receipt, item.receipt) && same(command.before, item.before), 'Cleanup must bind the fresh full-thread review and before state, not a newer header-only wrapper'); fresh(item.receipt, run, at);
      insist(run.cleanup.deliveredPlans[item.key] === planDigest(item), 'New or changed cleanup plans and facts require a verified same-message edit first');
      insist(!item.correction && command.action === item.classification.action && ['archive', 'trash'].includes(item.classification.action), 'Mail intent violates conservative classified scope');
      insist(item.attempts.every(attempt => attempt.status === 'known-unexecuted'), 'Mail action already verified or uncertain; inspect same ID before retry');
    } else {
    for (const source of run.sources) { insist(source.capture, 'Cleanup needs complete acquired coverage'); fresh(source.capture.receipt, run, at); }
    if (run.sealed) for (const assessment of [run.sealed.briefing, run.sealed.calendar]) fresh(assessment.receipt, run, at);
    insist(!item.correction && command.action === item.classification.action && ['archive', 'trash'].includes(item.classification.action), 'Mail intent violates conservative classified scope');
    insist(same(command.before, item.before), 'Mail before-state race; inspect same ID and retain the discrepancy');
    insist(item.attempts.every(attempt => attempt.status === 'known-unexecuted'), 'Mail action already verified or uncertain; inspect same ID before retry');
    insist(run.delivery?.status === 'delivered' && run.sealed && !run.sealed.gaps.length, 'Cleanup requires delivered/read-back brief with complete fresh coverage');
    }
    for (const fact of item.facts) insist((run.cleanup ? [run.sealed.body, ...run.summaryHistory?.filter(summary => summary.delivery?.status === 'delivered').map(summary => summary.body) ?? [], ...(run.summary?.delivery?.status === 'delivered' ? [run.summary.body] : [])].some(body => body.includes(fact)) : run.sealed.body.includes(fact)), 'Useful receipt facts must be in the delivered exact body before archive');
    insist(command.action !== 'trash' || item.classification.rule?.ownerRef, 'Recoverable Trash needs versioned applicable owner authority');
    const attempt = { status: 'uncertain', action: command.action, before: command.before, destination: command.destination, receipt: command.receipt, rule: item.classification.rule, policyVersion: item.classification.policyVersion, policyDigest: item.classification.policyDigest, reason: item.classification.reason, at };
    attempt.intentDigest = digest({ runId: run.id, itemKey: item.key, attempt: item.attempts.length + 1, ...attempt }); item.attempts.push(attempt);
  }
  if (command.step === 'action-result') {
    const item = row(); const attempt = item.attempts.at(-1); insist(attempt?.status === 'uncertain' && attempt.intentDigest === command.intentDigest, 'Mail readback crosses action intent');
    scopeReceipt(command.receipt, command.adapter); fresh(command.receipt, run, at); insist(Date.parse(command.receipt.observedAt) >= Date.parse(attempt.at), 'Mail readback predates action intent');
    if (command.outcome === 'verified') {
      const after = command.after; insist(after && after.nativeId === item.before.nativeId && after.threadId === item.before.threadId && after.subject === item.before.subject && after.sender === item.before.sender && after.unread === item.before.unread, 'Mail readback must preserve same ID, thread, subject, sender and unread');
      if (command.adapter === 'gmail') { const expected = item.before.labels.filter(label => label !== 'INBOX' && (attempt.action !== 'trash' || label !== 'TRASH')); if (attempt.action === 'trash') expected.push('TRASH'); insist(same([...after.labels].sort(), [...expected].sort()), 'Gmail saved labels differ from exact reversible intent'); }
      else insist(after.folder === attempt.destination.folder && after.folderId === attempt.destination.folderId, 'Outlook saved folder differs from intent');
    }
    if (command.outcome === 'known-unexecuted') insist(command.after && same(command.after, item.before), 'No-effect reconciliation needs exact original same-ID state');
    Object.assign(attempt, { status: command.outcome, result: command, resolvedAt: command.outcome === 'uncertain' ? null : at });
  }
  if (command.step === 'summary') {
    insist(run.delivery?.status === 'delivered' && run.sealed && run.summary?.delivery?.status !== 'uncertain', 'Inspect delivered brief and any uncertain same-message edit first');
    const lines = [run.cleanup ? `# Morning ${run.day} · Asia/Singapore\n\n## Historical assessed day view\n\n${run.sealed.briefing.result.body.trimEnd()}\n\nThe day view is historical. Current mail decisions below supersede its mail-related reminders. Assessment source time ${run.sealed.briefing.assessment.checkedAt}.` : run.sealed.body.trimEnd()];
    if (run.cleanup) {
      run.cleanup.globalGaps = globalGaps(run, at);
      lines.push('', `## Selected-ID refresh ${run.cleanup.generation}`, '', 'The day view above retains its original assessment/source times. This batch is not whole-inbox or calendar coverage.', ...run.cleanup.globalGaps.map(gap => `- Gap. ${md(gap)}.`));
      lines.push(...run.sources.map(source => `- Global ${md(source.id)}. Source ${source.capture?.receipt.observedAt ?? 'unknown'}; fetched ${source.capture?.receipt.capturedAt ?? 'unknown'}.`), '', '## Current mail decisions and cleanup outcomes', '');
      for (const item of run.items) lines.push(`- ${md(item.before.sender)}; ${md(item.before.subject)} [${md(item.before.nativeId)}]. ${item.cleanupGeneration === run.cleanup.generation ? 'Selected current review' : 'Retained earlier review'} at ${item.receipt.observedAt}. ${md(item.correction?.disposition ?? (terminalItem(item) ? `verified ${item.attempts.find(attempt => attempt.status === 'verified').action}` : item.classification.action === 'keep' ? 'keep' : `proposed ${item.classification.action}`))}. Outcome ${item.attempts.at(-1)?.status ?? 'not-attempted'}. ${md(item.correction?.reason ?? item.classification.reason)}.`, ...item.facts.map(fact => `  - ${fact}`));
    }
    if (!run.cleanup) lines.push('', '## Cleanup outcomes', '');
    if (!run.cleanup) for (const adapter of ['gmail', 'outlook']) for (const outcome of ['verified', 'uncertain', 'known-unexecuted', 'not-attempted']) {
      const rows = run.items.filter(item => item.adapter === adapter && (item.attempts.at(-1)?.status ?? 'not-attempted') === outcome);
      if (rows.length) lines.push(`- ${adapter} ${outcome} (${rows.length}). ${rows.map(item => `${md(item.before.sender)}; ${md(item.before.subject)} [${md(item.before.nativeId)}]`).join('; ')}.`);
    }
    const diagnosticBody = `${lines.join('\n')}\n`; const body = run.sealed.presentation === 'compact-v1' ? renderCompactMorning(run, run.sealed.diagnostic.assessment, { at, gaps: run.cleanup?.globalGaps ?? run.sealed.gaps, summary: true, internalIds: state.jobs.flatMap(job => [job.key, job.ticket]) }) : diagnosticBody; insist(Buffer.byteLength(body) <= 131072, 'Morning presentation body exceeds byte bound'); run.summaryHistory ??= []; if (run.summary) run.summaryHistory.push(run.summary);
    run.summary = { body, bodyDigest: digest(body), ...(run.sealed.presentation ? { presentation: run.sealed.presentation, diagnostic: { body: diagnosticBody, bodyDigest: digest(diagnosticBody) } } : {}), ...(run.policyVersion === 2 ? { outcomeDigest: outcomeDigest(run) } : {}), ...(run.cleanup ? { generation: run.cleanup.generation, plans: planMap(run), planDigest: digest(planMap(run)) } : {}), at, delivery: null, platformGap: null };
  }
  if (command.step === 'edit-intent') {
    insist(run.delivery?.status === 'delivered' && run.summary && !run.summary.delivery && command.nativeId === run.delivery.nativeId && command.bodyDigest === run.summary.bodyDigest, 'Edit requires exact rendered cleanup summary on the same delivered native message');
    if (run.cleanup) insist(run.summary.generation === run.cleanup.generation && run.summary.planDigest === digest(planMap(run)), 'Refreshed summary plans are stale');
    if (run.policyVersion === 2) insist(run.summary.outcomeDigest === outcomeDigest(run), 'Cleanup summary is stale; render current outcomes before editing');
    insist(!run.summary.editAttempts?.some(attempt => attempt.editRef === command.editRef), 'Retained failed edit reference cannot be replayed');
    const priorBodyDigest = [...(run.summaryHistory ?? [])].reverse().find(summary => summary.delivery?.status === 'delivered')?.bodyDigest ?? run.delivery.bodyDigest;
    run.summary.delivery = { ...(run.deliveryTarget ? { scope: run.deliveryTarget.scope, ownerRef: run.deliveryTarget.ownerRef } : {}), priorBodyDigest, status: 'uncertain', editRef: command.editRef, nativeId: command.nativeId, bodyDigest: command.bodyDigest, at };
  }
  if (command.step === 'edit-ack') {
    const edit = run.summary?.delivery;
    if (run.deliveryTarget) deliveryReadback(command, edit, at);
    insist(edit?.status === 'uncertain' && edit.nativeId === command.nativeId && edit.editRef === command.editRef && edit.bodyDigest === command.bodyDigest && command.bodyDigest === command.deliveredBodyDigest && command.readbackRef !== command.editRef, 'Edit readback must retain exact same message, edit and body');
    Object.assign(edit, { status: 'delivered', readbackRef: command.readbackRef, acknowledgedAt: at });
    if (run.cleanup && run.summary.plans) { run.cleanup.deliveredPlans = run.summary.plans; run.cleanup.deliveryBodyDigest = run.summary.bodyDigest; }
  }
  if (command.step === 'edit-resolve') {
    const edit = run.summary?.delivery;
    if (run.deliveryTarget) deliveryReadback(command, edit, at);
    insist(edit?.status === 'uncertain' && edit.nativeId === command.nativeId && edit.editRef === command.editRef && edit.bodyDigest === command.bodyDigest && edit.priorBodyDigest === command.priorBodyDigest && command.readbackRef !== command.editRef, 'Edit no-effect reconciliation must retain exact prior body and native message');
    run.summary.editAttempts ??= []; run.summary.editAttempts.push({ ...edit, outcome: 'known-unexecuted', resolution: command, resolvedAt: at }); run.summary.delivery = null;
  }
  if (command.step === 'edit-gap') {
    insist(run.summary && !run.summary.delivery, 'An uncertain edit needs actual same-message inspection'); run.summary.platformGap = { sourceRef: command.sourceRef, reason: command.reason, at };
  }
  return 'morning-retained';
}

export function morningView(runs = [], at = null) {
  return runs.map(run => {
    const uncertain = run.delivery?.status === 'uncertain' || run.summary?.delivery?.status === 'uncertain' || run.items.some(item => item.attempts.at(-1)?.status === 'uncertain');
    const pending = run.items.filter(item => !item.correction && item.classification.action !== 'keep' && item.attempts.at(-1)?.status !== 'verified').length;
    const currentSummary = (run.policyVersion === 2 ? run.summary?.outcomeDigest === outcomeDigest(run) : true) && (!run.cleanup || run.summary?.planDigest === digest(planMap(run)));
    const selected = run.cleanup ? run.cleanup.items.map(selection => { const item = run.items.find(item => item.key === itemKey(selection.adapter, selection.nativeId)); const ageMs = item && at ? Date.parse(at) - Date.parse(item.receipt.observedAt) : null; const state = !item || item.cleanupGeneration !== run.cleanup.generation ? 'needs-acquisition-review' : terminalItem(item) ? 'verified' : item.correction || item.classification.action === 'keep' ? 'kept' : ageMs !== null && (ageMs < 0 || ageMs > 300000) ? 'stale-needs-refresh' : run.cleanup.deliveredPlans[item.key] !== planDigest(item) ? 'needs-same-message-plan-edit' : 'ready-for-fresh-intent'; return { ...selection, state, ageMs }; }) : [];
    const status = uncertain ? 'uncertain' : run.delivery?.status !== 'delivered' ? 'needs-delivery' : !run.cleanup && run.sealed?.gaps.length ? 'degraded' : pending ? 'needs-cleanup' : currentSummary && (run.summary?.delivery?.status === 'delivered' || run.summary?.platformGap) ? 'complete' : 'needs-summary';
    const nextAction = run.cleanup && !uncertain ? 'Global coverage remains historical or degraded. Act only on selected IDs whose fresh full-thread plan is delivered; reacquire stale or missing selected reviews and edit changed plans on the same message.' : uncertain ? 'Inspect the same native send, edit or mail ID; never replay uncertain effects.' : status === 'needs-delivery' ? 'Acquire fresh sources, seal and send/read back the exact brief once.' : status === 'degraded' ? 'Retain source gaps; no cleanup permission from this run.' : status === 'needs-cleanup' ? 'Re-fetch each same-ID before state, retain intent, then verify unread-preserved result.' : status === 'needs-summary' ? 'Render cleanup outcomes and edit/read back the same native brief, or retain a platform gap.' : 'Inspect retained outcome evidence; no duplicate run or resend.';
    return { id: run.id, day: run.day, status, reviewed: run.items.length, pending, gaps: run.cleanup?.globalGaps ?? run.sealed?.gaps ?? [], ...(run.cleanup ? { cleanup: { kind: run.cleanup.kind, generation: run.cleanup.generation, selectedIds: selected, globalCoverage: run.cleanup.globalGaps.length ? 'degraded' : 'historical', acquisitionCoverage: 'selected-ids-only' } } : {}), delivery: run.delivery?.status ?? 'not-attempted', summary: run.summary?.delivery?.status ?? (run.summary?.platformGap ? 'unsupported' : 'not-attempted'), nextAction, assurance: 'reported-parent-contract' };
  });
}
