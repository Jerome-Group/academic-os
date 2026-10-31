import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { boundedFile, strictJson } from './bounded-json.mjs';
import { digest } from './records.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const fields = ['release', 'revision', 'installationSha256', 'bundleSha256', 'guidanceDigest', 'authorityRef'];
function shape(value, required, optional = []) {
  need(value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), 'Unknown or missing guidance pin field');
}
function selection(pin) {
  need(typeof pin.release === 'string' && /^emmy-[a-z0-9-]{1,100}$/.test(pin.release) && revision(pin.revision) && ['installationSha256', 'bundleSha256', 'guidanceDigest'].every(key => sha(pin[key])) && typeof pin.authorityRef === 'string' && pin.authorityRef.trim().length > 0 && pin.authorityRef.length <= 1000, 'Invalid approved local release selection');
}
async function directory(path, create = false) {
  if (create) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'Guidance pin directory must be ordinary');
}
async function sourceFile(base, path, maxBytes = 8 * 1024 * 1024) {
  need(typeof path === 'string' && path.length <= 1024 && !/[\\\x00]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe installed source path');
  const parts = path.split('/');
  let parent = base;
  for (const part of parts.slice(0, -1)) { parent = join(parent, part); await directory(parent); }
  return boundedFile(join(parent, parts.at(-1)), maxBytes);
}
async function rawPin(home) {
  try { const bytes = await boundedFile(join(home, 'guidance-pin.json'), 8192); return { bytes, digest: digest(bytes) }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function verifyRelease(home, pin, parseBundle) {
  selection(pin);
  const root = join(home, 'installed-runners');
  await directory(root);
  need(await realpath(root) === join(await realpath(home), 'installed-runners'), 'Installed release root escaped its private home');
  const path = join(root, pin.release);
  await directory(path);
  need(await realpath(path) === join(await realpath(root), pin.release), 'Untrusted installed release target');
  const manifestBytes = await sourceFile(path, 'installation.json', 2 * 1024 * 1024);
  need(digest(manifestBytes) === pin.installationSha256, 'Installation manifest hash mismatch');
  const manifest = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  need(manifest.revision === pin.revision && typeof manifest.privateHome === 'string' && resolve(manifest.privateHome) === resolve(home), 'Installed release revision/private-home mismatch');
  need(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 2000, 'Invalid installation source inventory');
  const seen = new Set(); let total = 0; let bundleBytes;
  for (const file of manifest.files) {
    need(file && !seen.has(file.path) && sha(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 8 * 1024 * 1024 && ['100644', '100755'].includes(file.mode), 'Invalid or duplicate installed source entry');
    seen.add(file.path); total += file.bytes; need(total <= 64 * 1024 * 1024, 'Installed source inventory exceeds bound');
    const bytes = await sourceFile(path, file.path);
    need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Installed source integrity mismatch');
    if (file.path === 'docs/briefing-guidance.json') bundleBytes = bytes;
  }
  need(manifest.launchers && Object.keys(manifest.launchers).length === 2 && ['run-agent', 'run-briefing'].every(name => sha(manifest.launchers[name]?.sha256)), 'Invalid installed launcher inventory');
  for (const name of ['run-agent', 'run-briefing']) need(digest(await sourceFile(path, name, 8192)) === manifest.launchers[name].sha256, 'Installed launcher integrity mismatch');
  need(bundleBytes && digest(bundleBytes) === pin.bundleSha256, 'Approved guidance bundle hash mismatch');
  const parsed = parseBundle(bundleBytes);
  need(parsed.digest === pin.guidanceDigest, 'Approved guidance semantic digest mismatch');
  return { parsed, filesVerified: seen.size, releasePath: path };
}
function parsePin(raw) {
  const pin = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes));
  shape(pin, ['schemaVersion', ...fields, 'activatedAt']);
  need(pin.schemaVersion === 1 && typeof pin.activatedAt === 'string' && Number.isFinite(Date.parse(pin.activatedAt)), 'Invalid guidance pin version/time');
  selection(pin); return pin;
}
export async function selectedGuidance(home, parseBundle) {
  let raw;
  try {
    raw = await rawPin(home);
    if (!raw) return null;
    const pin = parsePin(raw);
    const verified = await verifyRelease(home, pin, parseBundle);
    need((await rawPin(home))?.digest === raw.digest, 'Guidance pin changed during verification');
    const verifiedAt = new Date().toISOString();
    return { guidance: { state: 'pinned', source: 'approved-local-release', ...verified.parsed, release: pin.release, revision: pin.revision, installationSha256: pin.installationSha256, bundleSha256: pin.bundleSha256, pinDigest: raw.digest, activatedAt: pin.activatedAt, verifiedAt, authorityRef: pin.authorityRef }, refresh: { source: 'approved-local-release', result: 'pinned', verifiedAt, attempts: [], pinDigest: raw.digest, filesVerified: verified.filesVerified } };
  } catch (error) {
    return { guidance: { state: 'unavailable', source: 'approved-local-release', pinDigest: raw?.digest ?? null, refreshError: 'Active local guidance pin failed integrity verification' }, refresh: { source: 'approved-local-release', result: 'pin-invalid', attempts: [], terminalFailure: { stage: 'local-pin', kind: 'integrity', summary: error.message } } };
  }
}
async function archive(history, raw) {
  if (!raw) return;
  const path = join(history, `${raw.digest}.json`);
  try { await writeFile(path, raw.bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; need((await boundedFile(path, 8192)).equals(raw.bytes), 'Guidance pin history collision'); }
}
export async function manageGuidancePin(home, request, parseBundle) {
  shape(request, ['schemaVersion', 'action'], request?.action === 'activate' ? [...fields, 'expectedPinDigest'] : request?.action === 'deactivate' ? ['expectedPinDigest'] : []);
  need(request.schemaVersion === 1 && ['status', 'activate', 'deactivate'].includes(request.action), 'Unsupported guidance pin request');
  if (request.action === 'status') {
    const selected = await selectedGuidance(home, parseBundle);
    return selected ? { status: selected.guidance.state, pinDigest: selected.guidance.pinDigest, guidance: selected.guidance, refresh: selected.refresh } : { status: 'remote-default', pinDigest: null };
  }
  need(Object.hasOwn(request, 'expectedPinDigest') && (request.expectedPinDigest === null || sha(request.expectedPinDigest)), 'Pin changes require the observed exact pin digest or null');
  await directory(home, true);
  const lock = join(home, '.guidance-pin.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Guidance pin administration is locked; inspect any interrupted operation before retry'); throw error; }
  let temporary;
  try {
    const current = await rawPin(home);
    need((current?.digest ?? null) === request.expectedPinDigest, 'Guidance pin changed; inspect status before retry');
    let candidate; let verified;
    if (request.action === 'activate') {
      shape(request, ['schemaVersion', 'action', ...fields, 'expectedPinDigest']);
      candidate = Object.fromEntries(['schemaVersion', ...fields].map(key => [key, request[key]])); candidate.activatedAt = new Date().toISOString();
      verified = await verifyRelease(home, candidate, parseBundle);
    }
    const history = join(home, 'guidance-pins'); await directory(history, true); await archive(history, current);
    need((await rawPin(home))?.digest === current?.digest, 'Guidance pin changed during administration');
    const path = join(home, 'guidance-pin.json');
    if (request.action === 'deactivate') {
      if (current) await rm(path);
      return { status: 'remote-default', pinDigest: null, previousPinDigest: current?.digest ?? null, changed: current !== null };
    }
    const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
    temporary = join(home, `.pending-guidance-pin-${randomUUID()}`);
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path);
    need((await rawPin(home))?.digest === digest(bytes), 'Activated guidance pin readback mismatch');
    return { status: 'pinned', pinDigest: digest(bytes), previousPinDigest: current?.digest ?? null, release: candidate.release, revision: candidate.revision, guidanceDigest: candidate.guidanceDigest, filesVerified: verified.filesVerified, authority: 'operator-reference-retained-not-authenticated' };
  } finally { if (temporary) await rm(temporary, { force: true }); await rm(lock, { recursive: true }); }
}
