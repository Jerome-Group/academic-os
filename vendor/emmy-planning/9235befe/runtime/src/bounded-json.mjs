import { lstat, readFile } from 'node:fs/promises';

export function strictJson(source) {
  let at = 0; let depth = 0;
  const space = () => { while (/[ \t\r\n]/.test(source[at] ?? '') && at < source.length) at++; };
  const string = () => { const start = at++; while (at < source.length) { if (source[at++] === '"') return JSON.parse(source.slice(start, at)); if (source[at - 1] === '\\') at++; } throw new Error('Unterminated JSON string'); };
  const value = () => {
    if (++depth > 64) throw new Error('JSON nesting exceeds bound'); space(); let result;
    if (source[at] === '{') {
      at++; result = {}; const keys = new Set(); space();
      if (source[at] !== '}') while (true) { space(); if (source[at] !== '"') throw new Error('Invalid JSON key'); const key = string(); if (keys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Duplicate or unsafe JSON key'); keys.add(key); space(); if (source[at++] !== ':') throw new Error('Invalid JSON object'); result[key] = value(); space(); if (source[at] !== ',') break; at++; }
      if (source[at++] !== '}') throw new Error('Invalid JSON object');
    } else if (source[at] === '[') {
      at++; result = []; space(); if (source[at] !== ']') while (true) { result.push(value()); space(); if (source[at] !== ',') break; at++; } if (source[at++] !== ']') throw new Error('Invalid JSON array');
    } else if (source[at] === '"') result = string();
    else { const match = source.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/); if (!match) throw new Error('Invalid JSON value'); at += match[0].length; result = JSON.parse(match[0]); if (typeof result === 'number' && !Number.isFinite(result)) throw new Error('Nonfinite JSON number'); }
    depth--; return result;
  };
  const result = value(); space(); if (at !== source.length) throw new Error('Trailing JSON content'); return result;
}
export async function boundedFile(path, maxBytes = 262144) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Input must be a bounded ordinary file');
  const bytes = await readFile(path); if (bytes.length > maxBytes) throw new Error('Input grew beyond bound'); return bytes;
}
export async function boundedJson(path, maxBytes = 262144) { return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, maxBytes))); }
