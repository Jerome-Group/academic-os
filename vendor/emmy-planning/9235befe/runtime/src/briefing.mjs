import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { briefingGuidance } from './metadata.mjs';
import { canonical, digest } from './records.mjs';
import { boundedJson } from './bounded-json.mjs';
import { manageGuidancePin, selectedGuidance } from './guidance-pin.mjs';

const origin = 'https://api.github.com/repos/jerome-queck/emmy';
const maxBytes = 262144;
const maxAgeMs = 86400000;
const states = {
  status: ['complete', 'pending', 'unknown'],
  reminder: ['pending'],
  capability: ['working', 'authentication-required', 'denied', 'untested'],
  budget: ['notice', 'alert', 'spending-stopped']
};
const coverageKinds = { catalogListed: ['catalog'], chatsRead: ['chat'], repositoriesInspected: ['repository'], otherSourcesRead: ['native', 'user', 'budget'] };
const requireValue = (condition, message) => { if (!condition) throw Object.assign(new Error(message), { briefingValidation: true }); };
const shape = (value, name, required, optional = []) => {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  requireValue(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), `${name} has missing or unexpected fields`);
};
const text = (value, name) => requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 1000 && !/[\r\n\x00-\x1f\x7f\u2028\u2029]/.test(value), `${name} must be one nonempty line, at most 1000 characters`);
const hash = (value, name, length = 64) => requireValue(typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value), `${name} must be a ${length === 40 ? 'Git object ID' : 'SHA-256 digest'}`);
const array = (value, name) => requireValue(Array.isArray(value) && value.length <= 128, `${name} must be an array with at most 128 items`);
const strings = (value, name) => { array(value, name); value.forEach(item => text(item, name)); requireValue(new Set(value).size === value.length, `${name} contains duplicates`); };
const choice = (value, choices, name) => requireValue(choices.includes(value), `Unknown ${name}`);
const time = (value, name) => requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'), `${name} must be a real UTC timestamp`);
const scope = (value, name) => {
  shape(value, name, ['subject', 'effect'], ['operation', 'executor', 'host', 'endpoint']);
  Object.values(value).forEach(item => text(item, name));
  if (value.endpoint) webReference(value.endpoint);
};
const sameScope = (left, right) => canonical(left) === canonical(right);
const md = value => value.replaceAll('&', '&amp;').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
const scopeText = value => [value.subject, value.effect, ...['operation', 'executor', 'host', 'endpoint'].filter(key => value[key]).map(key => `${key} ${value[key]}`)].map(md).join(', ');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function webReference(raw) {
  let url;
  try { url = new URL(raw); } catch {}
  requireValue(!(/^\s*https?:[\\/]{2}[^/?#]*@/i.test(raw) || url && ['http:', 'https:'].includes(url.protocol) && (url.username || url.password)), 'Credential-bearing HTTP(S) references are not accepted');
  if (!url || !/^https?:\/\//i.test(raw) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || raw !== raw.trim() || /[\\\x00-\x20\x7f]/.test(raw) || /%(?![a-f0-9]{2})/i.test(raw)) return { kind: 'no-web-link' };
  return { kind: 'link', href: url.href.replace(/["`{}|^]/g, value => encodeURIComponent(value)) };
}

async function boundedFile(path) {
  const stat = await lstat(path);
  requireValue(stat.isFile() && stat.size <= maxBytes, 'Briefing input must be a regular file of at most 262144 bytes');
  const bytes = await readFile(path);
  requireValue(bytes.length <= maxBytes, 'Briefing input exceeds 262144 bytes');
  return bytes;
}

function parseBundle(bytes) {
  const bundle = JSON.parse(bytes.toString('utf8'));
  requireValue(bundle && typeof bundle === 'object' && !Array.isArray(bundle), 'Guidance bundle must be an object');
  if (bundle.schemaVersion !== briefingGuidance.schemaVersion || bundle.checkerVersion !== briefingGuidance.checkerVersion) {
    const error = new Error('Guidance requires an installed checker upgrade; downloaded code was not executed');
    error.upgradeRequired = true; error.briefingValidation = true; throw error;
  }
  shape(bundle, 'Guidance bundle', ['schemaVersion', 'checkerVersion', 'documents', 'digest']);
  requireValue(JSON.stringify(bundle, null, 2) + '\n' === bytes.toString('utf8'), 'Guidance bundle must use the generated encoding without duplicate fields');
  array(bundle.documents, 'Guidance documents');
  requireValue(bundle.documents.length === briefingGuidance.paths.length, 'Guidance must contain exactly the approved documents');
  bundle.documents.forEach((document, index) => {
    shape(document, 'Guidance document', ['path', 'bytes', 'sha256', 'text']);
    requireValue(document.path === briefingGuidance.paths[index], 'Duplicate or unexpected guidance path');
    requireValue(typeof document.text === 'string' && document.text.length > 0, 'Missing readable guidance');
    hash(document.sha256, 'Guidance document digest');
    requireValue(document.bytes === Buffer.byteLength(document.text) && digest(document.text) === document.sha256, 'Guidance document byte/digest mismatch');
  });
  hash(bundle.digest, 'Guidance digest');
  requireValue(bundle.digest === digest(bundle.documents), 'Guidance content digest mismatch');
  return { digest: bundle.digest, text: bundle.documents.map(document => document.text).join('\n'), paths: bundle.documents.map(document => document.path) };
}

async function publish(base, files) {
  await mkdir(base, { recursive: true });
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const pending = join(base, `.pending-${id}`); const destination = join(base, id);
  await mkdir(pending);
  try {
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(pending, name), bytes, { flag: 'wx' });
    await rename(pending, destination);
    return destination;
  } catch (error) { await rm(pending, { recursive: true, force: true }); throw error; }
}

function safeError(error) {
  const causeCodes = []; const pending = [{ value: error, depth: 0 }]; const seen = new Set();
  while (pending.length && seen.size < 12) {
    const { value, depth } = pending.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code) && !causeCodes.includes(value.code)) causeCodes.push(value.code);
    if (depth < 4) {
      pending.push({ value: value.cause, depth: depth + 1 });
      if (Array.isArray(value.errors)) for (const child of value.errors.slice(0, 4)) pending.push({ value: child, depth: depth + 1 });
    }
  }
  return { errorName: typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error', causeCodes };
}

async function refreshGuidance(home) {
  const started = performance.now();
  const signal = AbortSignal.timeout(10000);
  const refresh = { schemaVersion: 1, startedAt: new Date().toISOString(), deadlineMs: 10000, retryAllowance: 1, pin: null, attempts: [], result: 'failed', terminalFailure: null };
  const transientCodes = new Set(['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
  let retryUsed = false;
  const request = async (stage, path, accept) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal.aborted || performance.now() - started >= 10000) {
        refresh.terminalFailure = { stage, phase: 'fetch', kind: 'deadline', summary: 'Canonical guidance deadline exceeded before request', ...safeError(signal.reason), retry: { kind: 'refuse', reason: 'deadline' } };
        throw refresh.terminalFailure;
      }
      let response; let phase = 'fetch'; let kind = 'transport'; let summary = 'Canonical guidance transport failed';
      const attemptStarted = performance.now();
      try {
        signal.throwIfAborted();
        response = await fetch(`${origin}/${path}`, { signal, redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'emmy-briefing' } });
        if (!response.ok) { kind = 'http'; summary = `Canonical guidance request failed with HTTP ${response.status}`; throw new Error(summary); }
        phase = 'read';
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          requireValue(size <= 1048576, 'Guidance response exceeds 1048576 bytes');
          chunks.push(chunk);
        }
        phase = 'decode'; kind = 'json'; summary = 'Canonical guidance response is not valid JSON';
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        phase = 'validate'; kind = 'integrity'; summary = 'Canonical guidance validation failed';
        const accepted = accept(value);
        refresh.attempts.push({ stage, attempt, phase, outcome: 'accepted', elapsedMs: Math.round(performance.now() - attemptStarted) });
        return accepted;
      } catch (error) {
        const diagnostic = safeError(error);
        const failure = { stage, attempt, phase, kind: signal.aborted ? 'deadline' : error.briefingValidation ? error.upgradeRequired ? 'upgrade-required' : 'integrity' : kind, summary: signal.aborted ? 'Canonical guidance deadline exceeded' : error.briefingValidation ? error.message : summary, ...diagnostic, ...(kind === 'http' ? { httpStatus: response.status } : {}) };
        const transient = !signal.aborted && !['AbortError', 'TimeoutError'].includes(diagnostic.errorName) && (kind === 'http' ? [502, 503, 504].includes(response.status) : ['fetch', 'read'].includes(phase) && !error.briefingValidation && diagnostic.causeCodes.length > 0 && diagnostic.causeCodes.every(code => transientCodes.has(code)));
        let delayMs = 0; let refusal = !transient ? signal.aborted ? 'deadline' : 'not-transient' : retryUsed ? 'allowance-used' : null;
        if (!refusal && kind === 'http') {
          const hint = response.headers.get('retry-after');
          if (hint !== null) {
            if (/^\d{1,9}$/.test(hint)) delayMs = Number(hint) * 1000;
            else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d GMT$/.test(hint) && Number.isFinite(Date.parse(hint)) && new Date(hint).toUTCString() === hint) delayMs = Math.max(0, Date.parse(hint) - Date.now());
            else refusal = 'retry-after-invalid';
            if (!refusal) failure.retryAfterMs = delayMs;
          }
        }
        if (!refusal && delayMs >= 10000 - (performance.now() - started)) refusal = delayMs ? 'retry-after-too-long' : 'deadline';
        failure.retry = refusal ? { kind: 'refuse', reason: refusal } : { kind: 'retry', delayMs };
        refresh.attempts.push({ stage, attempt, phase, outcome: 'failed', elapsedMs: Math.round(performance.now() - attemptStarted), failure });
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        if (refusal) { refresh.terminalFailure = failure; throw failure; }
        retryUsed = true;
        try { if (delayMs) await setTimeout(delayMs, undefined, { signal }); signal.throwIfAborted(); }
        catch (delayError) {
          refresh.terminalFailure = { stage, phase: 'retry-delay', kind: 'deadline', summary: 'Canonical guidance deadline exceeded before retry', ...safeError(delayError), retry: { kind: 'refuse', reason: 'deadline' } };
          throw refresh.terminalFailure;
        }
      }
    }
  };
  try {
    refresh.pin = await request('main', 'commits/main', commit => {
      hash(commit?.sha, 'Main commit', 40); hash(commit?.commit?.tree?.sha, 'Main tree', 40);
      return { commit: commit.sha, tree: commit.commit.tree.sha, sourceCheckedAt: new Date().toISOString() };
    });
    const blobId = await request('tree', `git/trees/${refresh.pin.tree}?recursive=1`, tree => {
      requireValue(tree?.sha === refresh.pin.tree && tree.truncated === false && Array.isArray(tree.tree), 'Incomplete or mismatched pinned guidance tree');
      requireValue(tree.tree.every(entry => entry && typeof entry.path === 'string') && new Set(tree.tree.map(entry => entry.path)).size === tree.tree.length, 'Duplicate pinned tree path');
      const entry = tree.tree.find(value => value.path === briefingGuidance.path);
      requireValue(entry?.type === 'blob' && entry.mode === '100644', 'Pinned main does not contain the approved guidance bundle');
      hash(entry.sha, 'Guidance blob', 40);
      return entry.sha;
    });
    refresh.pin.blob = blobId;
    const { bytes, parsed } = await request('blob', `git/blobs/${blobId}`, blob => {
      requireValue(blob?.sha === blobId && blob.encoding === 'base64' && Number.isInteger(blob.size) && blob.size > 0 && blob.size <= maxBytes && typeof blob.content === 'string', 'Malformed pinned guidance blob');
      const encoded = blob.content.replaceAll('\n', '');
      requireValue(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Malformed guidance base64');
      const bytes = Buffer.from(encoded, 'base64');
      requireValue(bytes.toString('base64') === encoded && bytes.length === blob.size && gitBlob(bytes) === blobId, 'Pinned guidance blob byte/identity mismatch');
      return { bytes, parsed: parseBundle(bytes) };
    });
    const receipt = { schemaVersion: 1, ...refresh.pin, bundleSha256: digest(bytes), guidanceDigest: parsed.digest };
    const snapshot = await publish(join(home, 'briefing/guidance'), { 'bundle.json': bytes, 'receipt.json': `${JSON.stringify(receipt, null, 2)}\n` });
    refresh.result = retryUsed ? 'recovered' : 'success';
    return { guidance: { state: 'current', ...parsed, ...receipt, snapshot }, refresh };
  }
  catch (error) {
    refresh.terminalFailure ??= { stage: 'publish', phase: 'publish', kind: 'publication', summary: 'Canonical guidance snapshot publication failed', ...safeError(error), retry: { kind: 'refuse', reason: 'not-transient' } };
    const failure = { refreshError: refresh.terminalFailure.summary, upgradeRequired: refresh.terminalFailure.kind === 'upgrade-required' };
    let directories;
    try { directories = await readdir(join(home, 'briefing/guidance'), { withFileTypes: true }); }
    catch (readError) { if (readError.code === 'ENOENT') return { guidance: { state: 'unavailable', ...failure }, refresh }; throw readError; }
    const candidates = [];
    for (const directory of directories.filter(value => value.isDirectory() && !value.name.startsWith('.')).sort((a, b) => b.name.localeCompare(a.name))) {
      const snapshot = join(home, 'briefing/guidance', directory.name);
      try {
        const bytes = await boundedFile(join(snapshot, 'bundle.json')); const parsed = parseBundle(bytes);
        const receipt = JSON.parse((await boundedFile(join(snapshot, 'receipt.json'))).toString('utf8'));
        shape(receipt, 'Cached receipt', ['schemaVersion', 'commit', 'tree', 'blob', 'sourceCheckedAt', 'bundleSha256', 'guidanceDigest']);
        requireValue(receipt.schemaVersion === 1, 'Unknown cache schema');
        for (const key of ['commit', 'tree', 'blob']) hash(receipt[key], `Cached ${key}`, 40);
        time(receipt.sourceCheckedAt, 'Cached main-check time');
        requireValue(Date.parse(receipt.sourceCheckedAt) <= Date.now() && receipt.bundleSha256 === digest(bytes) && receipt.blob === gitBlob(bytes) && receipt.guidanceDigest === parsed.digest, 'Corrupt cached guidance');
        candidates.push({ state: 'cached', ...parsed, ...receipt, snapshot, ...failure });
      } catch {}
    }
    return { guidance: candidates.sort((a, b) => b.sourceCheckedAt.localeCompare(a.sourceCheckedAt))[0] ?? { state: 'unavailable', ...failure }, refresh };
  } finally { refresh.elapsedMs = Math.round(performance.now() - started); }
}

function parseDraft(bytes) {
  const inputText = bytes.toString('utf8');
  let draft;
  try { draft = JSON.parse(inputText); }
  catch { throw new Error('Draft must be valid JSON'); }
  const frames = [];
  for (let index = 0; index < inputText.length; index++) {
    const character = inputText[index];
    if (character === '"') {
      const start = index++;
      while (inputText[index] !== '"') index += inputText[index] === '\\' ? 2 : 1;
      const frame = frames.at(-1);
      if (frame?.kind === 'object' && frame.expectKey) {
        const key = JSON.parse(inputText.slice(start, index + 1));
        requireValue(!frame.keys.has(key), 'Draft contains duplicate fields');
        frame.keys.add(key); frame.expectKey = false;
      }
    } else if (character === '{') frames.push({ kind: 'object', keys: new Set(), expectKey: true });
    else if (character === '[') frames.push({ kind: 'array' });
    else if (character === '}' || character === ']') frames.pop();
    else if (character === ',') {
      const frame = frames.at(-1);
      if (frame?.kind === 'object') frame.expectKey = true;
    }
  }
  shape(draft, 'Draft', ['schemaVersion', 'authoredUnder', 'sources', 'coverage', 'correctionReadback', 'entries']);
  requireValue(draft.schemaVersion === 1, 'Unknown draft schema'); hash(draft.authoredUnder, 'authoredUnder');
  array(draft.sources, 'Sources'); array(draft.entries, 'Entries'); array(draft.correctionReadback, 'Correction readback');
  const sourceIds = new Set();
  for (const source of draft.sources) {
    shape(source, 'Source', ['id', 'scope', 'reference', 'kind', 'retrievedAt', 'availability', 'coverage', 'claim', 'attribution'], ['contentAt', 'metadataAt']);
    text(source.id, 'Source ID'); requireValue(!sourceIds.has(source.id), 'Duplicate source ID'); sourceIds.add(source.id);
    scope(source.scope, 'Source scope'); text(source.reference, 'Source reference'); webReference(source.reference);
    choice(source.kind, Object.values(coverageKinds).flat(), 'source kind');
    choice(source.claim, Object.values(states).flat(), 'source claim'); choice(source.attribution, ['reported', 'attributed'], 'source attribution');
    choice(source.availability, ['available', 'unavailable', 'denied', 'unknown'], 'source availability');
    for (const key of ['retrievedAt', 'contentAt', 'metadataAt']) if (source[key] !== undefined) time(source[key], `Source ${key}`);
    shape(source.coverage, 'Source coverage', ['complete', 'gaps']); requireValue(typeof source.coverage.complete === 'boolean', 'Coverage complete must be boolean'); strings(source.coverage.gaps, 'Source coverage gaps');
    requireValue(!source.coverage.complete || !source.coverage.gaps.length, 'Complete source coverage cannot have gaps');
  }
  shape(draft.coverage, 'Coverage', ['selection', ...Object.keys(coverageKinds), 'gaps']); text(draft.coverage.selection, 'Coverage selection');
  for (const key of [...Object.keys(coverageKinds), 'gaps']) strings(draft.coverage[key], `Coverage ${key}`);
  const covered = Object.keys(coverageKinds).flatMap(key => draft.coverage[key]); requireValue(new Set(covered).size === covered.length, 'Duplicate coverage source');
  for (const readback of draft.correctionReadback) {
    shape(readback, 'Correction readback', ['scope', 'state'], ['reference', 'completionSourceId']); scope(readback.scope, 'Correction scope');
    choice(readback.state, ['reported-readback', 'conversation-only', 'unavailable'], 'correction readback state');
    if (readback.reference !== undefined) { text(readback.reference, 'Correction readback reference'); webReference(readback.reference); }
    if (readback.completionSourceId !== undefined) text(readback.completionSourceId, 'Correction completion source');
    requireValue(readback.state !== 'reported-readback' || readback.reference !== undefined, 'Reported readback needs an opaque reference');
  }
  requireValue(new Set(draft.correctionReadback.map(value => canonical(value.scope))).size === draft.correctionReadback.length, 'Duplicate correction scope');
  for (const entry of draft.entries) {
    shape(entry, 'Entry', ['kind', 'scope', 'label', 'state', 'sourceIds']); choice(entry.kind, Object.keys(states), 'entry kind');
    scope(entry.scope, 'Entry scope'); text(entry.label, 'Entry label'); choice(entry.state, states[entry.kind], 'entry state'); strings(entry.sourceIds, 'Entry sources');
    if (entry.kind === 'capability') requireValue(['operation', 'executor', 'host', 'endpoint'].every(key => entry.scope[key] !== undefined), 'Capability needs operation, executor, host and endpoint');
  }
  return draft;
}

function support(source, draft, asOf) {
  const reasons = [];
  if (source.availability !== 'available') reasons.push(`source ${source.availability}`);
  if (!source.coverage.complete) reasons.push('partial source coverage');
  if (!Object.keys(coverageKinds).some(key => draft.coverage[key].includes(source.id))) reasons.push('source outside declared read coverage');
  if (source.kind === 'catalog') reasons.push('catalog listing does not inspect current work');
  if (!source.contentAt) reasons.push('content date unknown');
  else if (Date.parse(source.contentAt) > asOf) reasons.push('future content');
  else if (asOf - Date.parse(source.contentAt) > maxAgeMs) reasons.push('historical content');
  if (source.contentAt && Date.parse(source.contentAt) > Date.parse(source.retrievedAt)) reasons.push('content is newer than its retrieval');
  if (Date.parse(source.retrievedAt) > asOf || source.metadataAt && Date.parse(source.metadataAt) > asOf) reasons.push('future retrieval or metadata');
  if (source.metadataAt && (!source.contentAt || Date.parse(source.metadataAt) > Date.parse(source.contentAt))) reasons.push('newer metadata; latest content unverified');
  return reasons;
}

function assessDraft(draft, guidance, checkedAt) {
  const asOf = Date.parse(checkedAt);
  const assessedSources = draft.sources.map(source => ({ source, qualifications: support(source, draft, asOf), webReference: webReference(source.reference) }));
  const sources = new Map(assessedSources.map(value => [value.source.id, value]));
  const assessment = { schemaVersion: 1, checkedAt, guidance: { state: guidance.state, sourceCheckedAt: guidance.sourceCheckedAt ?? null, upgradeRequired: Boolean(guidance.upgradeRequired), ...(guidance.source === 'approved-local-release' ? { source: guidance.source, revision: guidance.revision ?? null, pinDigest: guidance.pinDigest, verifiedAt: guidance.verifiedAt ?? null } : {}) }, coverage: draft.coverage, sources: assessedSources, corrections: [], entries: [], limits: [], findings: [] };
  const { findings, limits } = assessment;
  if (guidance.digest && draft.authoredUnder !== guidance.digest) findings.push('Read the returned guidance and revise authoredUnder before rendering.');
  for (const [key, kinds] of Object.entries(coverageKinds)) for (const id of draft.coverage[key]) {
    if (!sources.has(id) || !kinds.includes(sources.get(id).source.kind)) findings.push(`Coverage ${key} references an absent or differently typed source ${id}.`);
  }
  for (const entry of draft.entries) for (const id of entry.sourceIds) {
    const source = sources.get(id)?.source;
    if (!source || !sameScope(source.scope, entry.scope) || source.claim !== entry.state) findings.push(`Entry ${entry.label} needs matching scoped ${entry.state} support for ${id}.`);
  }
  for (const readback of draft.correctionReadback) if (readback.completionSourceId) {
    const source = sources.get(readback.completionSourceId)?.source;
    if (!source || source.kind !== 'user' || source.claim !== 'complete' || !sameScope(source.scope, readback.scope)) findings.push(`Correction for ${readback.scope.subject} needs its exact user completion source.`);
    else if (!draft.coverage.otherSourcesRead.includes(source.id)) findings.push(`Correction for ${readback.scope.subject} is outside declared read coverage.`);
  }
  if (findings.length) return { ...assessment, status: 'revise' };
  const readbacks = new Map(draft.correctionReadback.map(readback => [canonical(readback.scope), readback]));
  for (const readback of draft.correctionReadback) {
    const completion = sources.get(readback.completionSourceId)?.source;
    const completionCanSuppressOlder = Boolean(completion?.availability === 'available' && completion.coverage.complete && completion.contentAt && Date.parse(completion.contentAt) <= Date.parse(completion.retrievedAt) && Date.parse(completion.retrievedAt) <= asOf && (!completion.metadataAt || Date.parse(completion.metadataAt) <= asOf));
    assessment.corrections.push({ readback, completionCanSuppressOlder });
    if (readback.state !== 'reported-readback') limits.push({ kind: 'correction', scope: readback.scope, state: readback.state });
  }
  const corrections = new Map(assessment.corrections.map(value => [canonical(value.readback.scope), value]));
  if (!['current', 'pinned'].includes(guidance.state)) limits.push({ kind: 'guidance', ...assessment.guidance });
  const usedSources = new Set(Object.keys(coverageKinds).flatMap(key => draft.coverage[key]));
  for (const entry of draft.entries) {
    const selected = entry.sourceIds.map(id => sources.get(id)); entry.sourceIds.forEach(id => usedSources.add(id));
    const scopeKey = canonical(entry.scope); const correction = corrections.get(scopeKey);
    const completion = correction?.completionCanSuppressOlder ? sources.get(correction.readback.completionSourceId).source : null;
    if (completion) usedSources.add(completion.id);
    const contrary = completion ? assessedSources.filter(({ source, qualifications }) => sameScope(source.scope, entry.scope) && source.claim === 'pending' && source.attribution === 'attributed' && !qualifications.length && Date.parse(source.contentAt) > Date.parse(completion.contentAt)) : [];
    const olderReminder = completion && ['reminder', 'status'].includes(entry.kind) && entry.state === 'pending' && selected.length && selected.every(({ source }) => source.contentAt && Date.parse(source.contentAt) <= Date.parse(completion.contentAt));
    const eligible = selected.filter(value => !value.qualifications.length);
    const decision = completion && contrary.length && ['status', 'reminder'].includes(entry.kind)
      ? { kind: 'conflict', completionSourceId: completion.id, contrarySourceIds: contrary.map(value => value.source.id) }
      : olderReminder ? { kind: 'older-reminder-suppressed', completionSourceId: completion.id }
        : !eligible.length ? { kind: 'unknown', sourceIds: entry.sourceIds, qualifications: [...new Set(selected.flatMap(value => value.qualifications))] }
          : { kind: 'reported', sourceIds: eligible.map(value => value.source.id) };
    contrary.forEach(value => usedSources.add(value.source.id));
    assessment.entries.push({ entry, scopeKey, decision });
    if (['status', 'reminder'].includes(entry.kind) && !readbacks.has(scopeKey)) limits.push({ kind: 'correction', scope: entry.scope, state: 'not declared' });
  }
  const missingLinks = [];
  for (const id of usedSources) {
    const value = sources.get(id);
    if (value.webReference.kind !== 'link') missingLinks.push(id);
    if (value.source.coverage.gaps.length) limits.push({ kind: 'source-coverage', sourceId: id, scope: value.source.scope, gaps: value.source.coverage.gaps });
  }
  if (missingLinks.length) limits.push({ kind: 'source-link', sourceIds: missingLinks });
  return { ...assessment, status: limits.some(value => ['guidance', 'correction'].includes(value.kind)) ? 'degraded' : 'checked' };
}

export function renderBriefing(assessment) {
  const sources = new Map(assessment.sources.map(value => [value.source.id, value]));
  const links = ids => ids.map(id => sources.get(id)).filter(value => value.webReference.kind === 'link').map(value => `[${md(`${value.source.kind} source`)}](<${value.webReference.href.replaceAll('&', '&amp;')}>)`).join('; ');
  const lines = ['# Briefing', '', '## Updates', ''];
  for (const { entry, decision } of assessment.entries) {
    let status; let sourceIds = decision.sourceIds ?? [];
    if (decision.kind === 'conflict') {
      sourceIds = [decision.completionSourceId, ...decision.contrarySourceIds];
      status = `Conflict. User-reported complete${links([decision.completionSourceId]) ? ` (${links([decision.completionSourceId])})` : ''}; later attributable pending report${links(decision.contrarySourceIds) ? ` (${links(decision.contrarySourceIds)})` : ''}. Next check: read ${links([decision.contrarySourceIds[0]]) || 'the later pending report'} for this exact scope before another reminder.`;
    } else if (decision.kind === 'older-reminder-suppressed') {
      sourceIds = [decision.completionSourceId];
      status = 'Complete, reported by the user. Older reminder suppressed. Provider completion unverified.';
    } else if (decision.kind === 'unknown') status = `Current state unknown. ${sourceIds.length ? `Declared ${md(entry.state)} is qualified by ${decision.qualifications.map(md).join('; ')}.` : 'No supporting source supplied.'}`;
    else if (entry.kind === 'budget') status = entry.state === 'spending-stopped' ? 'Spending stop reported by the declared source; enforcement unverified.' : `Current ${entry.state} reported. A notice or alert does not establish a spending stop.`;
    else status = `${entry.state === 'complete' ? 'Complete, reported by the declared source; provider completion unverified' : entry.state === 'authentication-required' ? 'Access blocked by authentication, reported' : entry.state === 'untested' ? 'Untested' : `${entry.state}, reported`}.`;
    lines.push(`- ${scopeText(entry.scope)}. ${status}${decision.kind !== 'conflict' && links(sourceIds) ? ` Sources: ${links(sourceIds)}.` : ''}`);
  }
  if (assessment.limits.length) lines.push('', '## Limits', '');
  for (const limit of assessment.limits) {
    if (limit.kind === 'guidance') lines.push(`- ${limit.state === 'cached' ? `Current guidance refresh failed. Last successful main check ${limit.sourceCheckedAt}.` : 'Current guidance is unavailable.'}${limit.upgradeRequired ? ' Upgrade the installed checker before using the new guidance.' : ''}`);
    else if (limit.kind === 'correction') lines.push(`- ${scopeText(limit.scope)}. Correction recovery ${limit.state}; persistence unverified.`);
    else if (limit.kind === 'source-coverage') lines.push(`- ${scopeText(limit.scope)}. Coverage gaps: ${limit.gaps.map(md).join('; ')}.`);
    else if (limit.kind === 'source-link') lines.push(`- Web links unavailable for ${limit.sourceIds.length} declared sources. References retained privately.`);
  }
  lines.push('', '## Coverage', '', `Selection: ${md(assessment.coverage.selection)}.`);
  const coverageNames = { catalogListed: 'Catalog entries listed', chatsRead: 'Chats read', repositoriesInspected: 'Repositories inspected', otherSourcesRead: 'Other sources read' };
  for (const [key, name] of Object.entries(coverageNames)) lines.push(`${name}: ${assessment.coverage[key].length ? `${assessment.coverage[key].length}${links(assessment.coverage[key]) ? ` (${links(assessment.coverage[key])})` : ''}` : 'none'}.`);
  if (assessment.coverage.gaps.length) lines.push(`Gaps: ${assessment.coverage.gaps.map(md).join('; ')}.`);
  return `${lines.join('\n')}\n`;
}

export function assessBriefingDraft(input, guidance, checkedAt) { return assessDraft(parseDraft(Buffer.from(JSON.stringify(input))), guidance, checkedAt); }
export function assessBriefingPresentation(input, result, checkedAt) {
  requireValue(result?.guidance && typeof result.guidance.state === 'string', 'Compact presentation requires actual guidance in the retained briefing result');
  const assessment = assessBriefingDraft(input, result.guidance, checkedAt);
  requireValue(assessment.status === result.status && renderBriefing(assessment) === result.body, 'Compact presentation requires the exact existing assessed briefing result');
  return assessment;
}

export async function briefing(home, { file = null } = {}) {
  const input = file ? await boundedFile(file) : null;
  const draft = input ? parseDraft(input) : null;
  const { guidance, refresh } = await selectedGuidance(home, parseBundle) ?? await refreshGuidance(home);
  const checkedAt = new Date().toISOString();
  const assessment = draft ? assessDraft(draft, guidance, checkedAt) : null;
  const result = draft ? { mode: 'draft', status: assessment.status, findings: assessment.findings, ...(assessment.status !== 'revise' ? { body: renderBriefing(assessment) } : {}), guidance } : { mode: 'guidance', guidance };
  if (result.body !== undefined) result.bodyDigest = digest(result.body);
  const receipt = { schemaVersion: 1, mode: result.mode, status: result.status ?? guidance.state, checkedAt, guidanceState: guidance.state, guidanceDigest: guidance.digest ?? null, inputDigest: input ? digest(input) : null, bodyDigest: result.bodyDigest ?? null, findings: result.findings ?? [], assurance: 'advisory-reported-inputs', nativeInvocation: 'unverified' };
  const refreshBytes = `${JSON.stringify(refresh, null, 2)}\n`;
  const assessmentBytes = assessment ? `${JSON.stringify({ ...assessment, inputDigest: receipt.inputDigest, guidanceDigest: receipt.guidanceDigest, bodyDigest: receipt.bodyDigest }, null, 2)}\n` : null;
  const files = { 'receipt.json': `${JSON.stringify({ ...receipt, refreshDigest: digest(refreshBytes), assessmentDigest: assessmentBytes ? digest(assessmentBytes) : null }, null, 2)}\n`, 'guidance.json': `${JSON.stringify(guidance, null, 2)}\n`, 'refresh.json': refreshBytes, ...(input ? { 'draft.json': input, 'assessment.json': assessmentBytes } : {}), ...(result.body !== undefined ? { 'body.md': result.body } : {}) };
  const directory = await publish(join(home, 'briefing/runs'), files);
  return { ...result, evidence: { directory, receipt: join(directory, 'receipt.json'), refresh: join(directory, 'refresh.json'), ...(assessment ? { assessment: join(directory, 'assessment.json') } : {}), ...(result.body !== undefined ? { body: join(directory, 'body.md') } : {}) } };
}

export async function guidancePin(home, { file }) {
  return manageGuidancePin(home, await boundedJson(file, 8192), parseBundle);
}
