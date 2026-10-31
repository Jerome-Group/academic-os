#!/usr/bin/env node
import { resolve } from 'node:path';
import { boundedJson } from '../src/bounded-json.mjs';
import { academicOsPlanningReadyStatuses, readAcademicOsPlanningRequest } from '../src/academic-os-planning-io.mjs';

const [command, option, file, ...extra] = process.argv.slice(2);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
try {
  requireValue(command === 'calendar-register' && option === '--file' && typeof file === 'string' && !file.startsWith('--') && extra.length === 0, 'Use calendar-register --file <service-owned envelope>');
  const envelope = await boundedJson(resolve(file), 1024 * 1024);
  requireValue(envelope?.schemaVersion === 1 && envelope.action === 'academic-os', 'Use calendar-register schemaVersion 1 with action academic-os');
  requireValue(Object.keys(envelope).every(key => ['schemaVersion', 'action', 'requestFile'].includes(key)) && typeof envelope.requestFile === 'string', 'Academic OS adapter requires only requestFile');
  const data = await readAcademicOsPlanningRequest(envelope.requestFile);
  process.stdout.write(`${JSON.stringify({ ok: true, command, data })}\n`);
  process.exitCode = academicOsPlanningReadyStatuses.includes(data.status) ? 0 : 3;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, command: command ?? 'calendar-register', error: error.message })}\n`);
  process.exitCode = 2;
}
