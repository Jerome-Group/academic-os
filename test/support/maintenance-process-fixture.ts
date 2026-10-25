import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { learningWorkspacePaths } from "../fixtures/learning-workspace.js";
import { syntheticMaintenanceCoverage } from "../fixtures/maintenance-coverage.js";
import {
  moduleControlContents,
  validModuleControls,
} from "../fixtures/module-controls.js";
import { universalPaths } from "../fixtures/universal-structure.js";

export async function maintenanceProcessFixture(
  t: TestContext,
  input: {
    runner: "repository" | "module" | "check-budget";
    behavior: "normal" | "success" | "ignore-term" | "descendant" | "volume";
    logFault?:
      | "open"
      | "write"
      | "finish"
      | "slow"
      | "paused-write"
      | "paused-close"
      | "paused-stall"
      | "finish-stall";
    timeoutMs?: number;
    unavailable?: boolean;
  },
) {
  const retained = process.env.AOS_MAINTENANCE_PROCESS_EVIDENCE_ROOT;
  const root = await mkdtemp(
    join(retained ?? tmpdir(), "maintenance-process-"),
  );
  if (retained === undefined)
    t.after(() => rm(root, { recursive: true, force: true }));
  const pidFiles = [join(root, "child.pid"), join(root, "descendant.pid")];
  const marker = join(root, "effect");
  const log = join(root, "repository.log");
  const badLog = join(root, "bad-log");
  await mkdir(badLog);
  if (input.logFault === "open") await writeFile(log, "original log\n");
  const executable = join(root, "fake-codex.mjs");
  await writeFile(
    executable,
    `#!${process.execPath}
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
if (process.argv.includes('--warm')) process.exit(0);
writeFileSync(${JSON.stringify(pidFiles[0])}, String(process.pid));
if (${JSON.stringify(input.runner)} === 'check-budget') {
  setTimeout(()=>process.stdout.write(JSON.stringify({checks:[]})),510);
} else {
const behavior = ${JSON.stringify(input.behavior)};
if (behavior === 'success' || behavior === 'volume') {
  const result = process.argv[process.argv.indexOf('--output-last-message')+1];
  if (process.argv.includes('--output-last-message')) writeFileSync(result,${JSON.stringify(JSON.stringify({ maintenance: syntheticMaintenanceCoverage(), curated: [], rederived: [], superseded: [], withdrawn: [], parked: [], docWrites: [], failures: [], noted: [] }))});
}
if (behavior === 'ignore-term' || behavior === 'descendant') process.on('SIGTERM', () => {});
if (behavior === 'descendant') {
  const child = spawn(process.execPath, ['-e', ${JSON.stringify(`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFiles[1])},String(process.pid));process.on('SIGTERM',()=>{});process.stdout.write('descendant ready\\n');setTimeout(()=>process.exit(0),3000);`)}], {stdio:['ignore','inherit','inherit']});
  child.unref();
}
if (behavior !== 'descendant') {
  process.stdout.write('diagnostic stdout\\n');
  process.stderr.write('diagnostic stderr\\n');
}
if (behavior === 'volume') {
  for (let i=0;i<64;i++) for (const stream of [process.stdout,process.stderr]) {
    if (!stream.write(Buffer.alloc(65536,stream===process.stdout?120:121))) await once(stream,'drain');
  }
}
if (behavior === 'normal') process.exitCode = 7;
if (behavior === 'ignore-term' || behavior === 'descendant') {
  setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'effect'), 600);
  setTimeout(() => process.exit(0), behavior === 'descendant' ? 100 : 3000);
}
}
`,
    { mode: 0o700 },
  );
  assert.equal(spawnSync(executable, ["--warm"], { timeout: 5000 }).status, 0);
  const moduleRoot = join(root, "Drive", "Modules", "Y2S1", "MH2100");
  const stateRoot = join(root, "State");
  const checkout = join(root, "checkout");
  const fixtureRoot = join(root, "fixture");
  await mkdir(checkout);
  await mkdir(fixtureRoot, { mode: 0o700 });
  if (input.runner === "module") {
    const controls = moduleControlContents(validModuleControls());
    for (const [relative, kind] of [
      ...universalPaths,
      ...learningWorkspacePaths,
    ]) {
      const path = join(moduleRoot, relative);
      await mkdir(kind === "directory" ? path : dirname(path), {
        recursive: true,
      });
      if (kind !== "directory")
        await writeFile(path, controls.get(relative) ?? "fixture\n");
    }
    await mkdir(join(moduleRoot, "30 Assessments", "10 Quizzes"));
    await writeFile(
      join(moduleRoot, "NTULearn", "Sync status.json"),
      JSON.stringify({
        schemaVersion: 1,
        producer: "ntulearn",
        status: "complete",
        startedAt: "2026-08-22T21:00:00.000Z",
        finishedAt: "2026-08-22T21:05:00.000Z",
        lastSuccessfulAt: "2026-08-22T21:05:00.000Z",
        counts: {
          downloaded: 0,
          skipped: 0,
          markdown: 0,
          uncopied: 0,
          failures: 0,
        },
        unread: [],
      }),
    );
  }
  const runner = join(root, "runner.mjs");
  const repositoryApi = new URL(
    "../../src/routine/repository-repair-process.js",
    import.meta.url,
  ).href;
  const moduleApi = new URL(
    "../../src/routine/codex-module-session.js",
    import.meta.url,
  ).href;
  await writeFile(
    runner,
    `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {writeFile} from 'node:fs/promises';
const original = fs.createWriteStream;
const fault = ${JSON.stringify(input.logFault ?? "")};
let maxBuffered = 0, backpressureEvents = 0;
const streams = [];
fs.createWriteStream = (path, options) => {
  if (!String(path).endsWith('session.log') && !String(path).endsWith('repository.log')) return original(path,options);
  if (fault === 'open' && String(path).endsWith('session.log')) return original(${JSON.stringify(badLog)},{...options,flags:'w'});
  const stream = original(path,options);
  streams.push(stream);
  const write = stream.write.bind(stream);
  stream.write = (...args) => {
    const ready = write(...args);
    maxBuffered = Math.max(maxBuffered,stream.writableLength);
    if (!ready) backpressureEvents++;
    return ready;
  };
  if (fault === 'write' || fault === 'finish' || fault === 'paused-write') {
    const method = fault === 'finish' ? '_final' : '_write';
    stream[method] = (...args) => setTimeout(() => args.at(-1)(Object.assign(new Error('synthetic disk full'),{code:'ENOSPC'})), 50);
  }
  if (fault === 'paused-close') stream._write = () => setTimeout(() => stream.destroy(), 50);
  if (fault === 'finish-stall' || fault === 'paused-stall') {
    stream[fault === 'finish-stall' ? '_final' : '_write'] = () => {
      const pending = setInterval(() => {}, 100);
      stream.once('close', () => clearInterval(pending));
    };
  }
  if (fault === 'slow') {
    const writeChunk = stream._write.bind(stream), writeChunks = stream._writev.bind(stream);
    stream._write = (chunk,encoding,callback) => setTimeout(() => writeChunk(chunk,encoding,callback),Math.ceil(chunk.length/65536)*4);
    stream._writev = (chunks,callback) => setTimeout(() => writeChunks(chunks,callback),Math.ceil(chunks.reduce((sum,entry)=>sum+entry.chunk.length,0)/65536)*4);
  }
  return stream;
};
syncBuiltinESMExports();
const {runRepositoryProcess} = await import(${JSON.stringify(repositoryApi)});
const {createCodexModuleSession} = await import(${JSON.stringify(moduleApi)});
const {createRepositoryRepairPorts} = await import(${JSON.stringify(new URL("../../src/routine/repository-repair-adapters.js", import.meta.url).href)});
const started = performance.now();
let result;
try {
  if (${JSON.stringify(input.runner)} === 'repository') result = await runRepositoryProcess({executable:${JSON.stringify(input.unavailable ? join(root, "missing") : executable)},args:[],cwd:${JSON.stringify(root)},log:${JSON.stringify(log)},timeoutMs:${input.timeoutMs ?? 250}});
  else if (${JSON.stringify(input.runner)} === 'check-budget') {
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback,delay,...args)=>originalTimeout(callback,delay >= 480000 ? delay/1000 : delay,...args);
    const ports = createRepositoryRepairPorts({repositoryRoot:${JSON.stringify(checkout)},privateStateRoot:${JSON.stringify(stateRoot)},codexPath:${JSON.stringify(executable)},ghPath:'/unavailable-fixture-gh'});
    result = await ports.checks({root:${JSON.stringify(checkout)},fixtureRoot:${JSON.stringify(fixtureRoot)},branch:'codex/fixture',base:'fixture'},${JSON.stringify(join(root, "checks"))});
  } else {
    let clocks = 0;
    const session = createCodexModuleSession({config:${JSON.stringify({ driveMount: join(root, "Drive"), stateRoot, activeSemester: "Y2S1", semesters: { Y2S1: { root: "Modules/Y2S1", status: "active", modules: ["MH2100"] } } })},codexPath:${JSON.stringify(input.unavailable ? join(root, "missing") : executable)},date:'2026-08-23',sessionSettings:{model:'gpt-6.1-sol',reasoningEffort:'xhigh'},clock:()=>new Date(Date.parse('2026-08-22T22:00:00.000Z') + (clocks++ === 0 ? 0 : 1200000-${input.timeoutMs ?? 250}))});
    result = await session.run({semester:'Y2S1',module:'MH2100'});
  }
} catch(error) {result = {error:{message:error.message,code:error.code}};}
await writeFile(${JSON.stringify(join(root, "result.json"))},JSON.stringify({elapsedMs:performance.now()-started,result,maxBuffered,backpressureEvents,streams:streams.map(stream=>({closed:stream.closed,destroyed:stream.destroyed,writableFinished:stream.writableFinished,length:stream.writableLength})),activeTimeouts:process.getActiveResourcesInfo().filter(name=>name==='Timeout').length}));
process.exit(0);
`,
  );
  const child = spawn(process.execPath, [runner], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    watchdogFired = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const pids = async () => {
    const owned: number[] = [];
    for (const path of pidFiles) {
      try {
        owned.push(Number(await readFile(path, "utf8")));
      } catch {}
    }
    return owned;
  };
  const kill = async () => {
    for (const pid of [...(await pids()), child.pid]) {
      if (pid === undefined) continue;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  };
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    void kill();
  }, 2000);
  t.after(async () => {
    clearTimeout(watchdog);
    await kill();
  });
  const exit = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const ownedPids = await pids();
  const aliveAtReturn = ownedPids.filter(alive);
  let report:
    | {
        elapsedMs: number;
        result: {
          error?: { code?: string; message: string };
          code?: number;
          passed?: boolean;
          output?: string;
          failures?: Array<{ code: string; message: string }>;
          artifacts?: string;
        };
        activeTimeouts: number;
        maxBuffered: number;
        backpressureEvents: number;
        streams: Array<{
          closed: boolean;
          destroyed: boolean;
          writableFinished: boolean;
          length: number;
        }>;
      }
    | undefined;
  try {
    report = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
  } catch {}
  await kill();
  const evidence = {
    root,
    input,
    exit,
    watchdogFired,
    ownedPids,
    aliveAtReturn,
    report,
    stdout,
    stderr,
  };
  await writeFile(
    join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  assert.equal(
    watchdogFired,
    false,
    `external watchdog fired: ${JSON.stringify(evidence)}`,
  );
  assert.equal(exit.code, 0, stderr);
  assert.ok(report, `controller returned no result: ${stderr}`);
  assert.equal(
    report.activeTimeouts,
    0,
    "a lifecycle deadline remains active after return",
  );
  assert.deepEqual(
    aliveAtReturn,
    [],
    "owned descendants remain active after return",
  );
  return { ...evidence, report, marker, log, pidFiles };
}
