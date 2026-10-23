import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const shelfBook = "Linear Algebra 4e Axler.pdf";
export const shelfHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const executeFile = promisify(execFile);

export async function shelfProcessFixture(
  input: { existingIndex?: boolean; migration?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "academic-os-shelf-process-"));
  const driveMount = join(root, "drive");
  await mkdir(driveMount);
  const shelfRoot = join(driveMount, "shelf");
  const stateRoot = join(root, "state");
  const control = join(root, "control");
  await mkdir(shelfRoot);
  await mkdir(stateRoot);
  await mkdir(control);
  await writeFile(
    join(shelfRoot, input.migration === true ? "old.pdf" : shelfBook),
    "approved book",
  );
  if (input.existingIndex === true)
    await writeFile(
      join(shelfRoot, "00 Index.yaml"),
      "# Owner\nowner: retained\nbooks: {}\n",
    );
  const request = join(root, "request.json");
  await writeFile(
    request,
    JSON.stringify({
      shelfRoot,
      stateRoot,
      operation: input.migration === true ? "migrate" : "catch-up",
      review: {
        books: [
          {
            file: "old.pdf",
            rename: shelfBook,
            key: "Axler",
            sha256: shelfHash("approved book"),
          },
        ],
      },
    }),
  );
  const runner = join(root, "runner.mjs");
  const api = new URL("../../src/textbooks/index.js", import.meta.url).href;
  const routineApi = new URL("../../src/routine/index.js", import.meta.url)
    .href;
  await writeFile(
    runner,
    `import {readFile} from 'node:fs/promises';\nimport {openFileShelf} from ${JSON.stringify(api)};\nimport {createCohortPrelude} from ${JSON.stringify(routineApi)};\nconst r=JSON.parse(await readFile(process.argv[2],'utf8'));\nconst shelf=await openFileShelf(r);\nconst mode=r.mode??'apply';\nconst report=r.operation==='prelude'?await createCohortPrelude({driveMount:${JSON.stringify(driveMount)},stateRoot:r.stateRoot,textbooks:{shelfRoot:'shelf'},activeSemester:'Y1S1',semesters:{}}).catchUpShelf():r.operation==='migrate'?await shelf.migrate({review:r.review,mode}):await shelf.catchUp({mode});\nprocess.stdout.write(JSON.stringify(report));\n`,
  );
  const preload = join(root, "preload.mjs");
  await writeFile(preload, preloadSource);
  return {
    root,
    driveMount,
    shelfRoot,
    stateRoot,
    control,
    request,
    runner,
    preload,
  };
}

export type ShelfProcessFixture = Awaited<
  ReturnType<typeof shelfProcessFixture>
>;

export function startShelfProcess(
  fixture: ShelfProcessFixture,
  options: {
    phase?: string;
    interposer?: string;
    target?: string;
    fault?: string;
    path?: string;
    unsafe?: boolean;
  } = {},
) {
  const child = spawn(
    process.execPath,
    ["--import", fixture.preload, fixture.runner, fixture.request],
    {
      env: {
        ...process.env,
        PATH: options.path ?? process.env.PATH,
        SHELF_TEST_CONTROL: fixture.control,
        SHELF_TEST_PHASE: options.phase ?? "",
        SHELF_TEST_FAULT: options.fault ?? "",
        SHELF_TEST_TARGET: options.target ?? "",
        SHELF_TEST_UNSAFE: options.unsafe === true ? "ordinary" : "",
        SHELF_TEST_INTERPOSER: options.interposer ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const finished = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { child, finished };
}

export async function waitShelfBarrier(
  fixture: ShelfProcessFixture,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await readFile(join(fixture.control, "reached"));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.fail(`Shelf barrier not reached: ${fixture.control}`);
}

export async function releaseShelfBarrier(
  fixture: ShelfProcessFixture,
): Promise<void> {
  await writeFile(join(fixture.control, "release"), "release");
}

export async function latestShelfRun(fixture: ShelfProcessFixture) {
  const path = join(
    fixture.stateRoot,
    "journals",
    "textbooks",
    `${createHash("sha256")
      .update(await realpath(fixture.shelfRoot))
      .digest("hex")}.jsonl`,
  );
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  const last = lines.at(-1);
  assert.ok(last);
  const envelope: unknown = JSON.parse(last);
  assert.ok(
    typeof envelope === "object" && envelope !== null && "run" in envelope,
  );
  const run = envelope.run;
  assert.ok(
    typeof run === "object" &&
      run !== null &&
      "runId" in run &&
      typeof run.runId === "string" &&
      "proposal" in run &&
      typeof run.proposal === "string",
  );
  return { path, runId: run.runId, proposal: run.proposal };
}

export async function compileShelfInterposer(
  directory: string,
): Promise<string> {
  const source = join(directory, "interposer.c");
  const binary = join(
    directory,
    process.platform === "darwin" ? "interposer.dylib" : "interposer.so",
  );
  await writeFile(source, interposerSource);
  await executeFile(
    "cc",
    process.platform === "darwin"
      ? ["-dynamiclib", "-Wall", "-Wextra", "-Werror", source, "-o", binary]
      : [
          "-shared",
          "-fPIC",
          "-Wall",
          "-Wextra",
          "-Werror",
          source,
          "-o",
          binary,
          "-ldl",
        ],
  );
  return binary;
}

const preloadSource = String.raw`
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
const control=process.env.SHELF_TEST_CONTROL;
const phase=process.env.SHELF_TEST_PHASE;
const fault=process.env.SHELF_TEST_FAULT;
let currentPhase='';
let afterPublication=false;
function barrier(label){
 if(label!==phase)return;
 fs.writeFileSync(join(control,'reached'),label);
 const deadline=Date.now()+30000;
 while(!fs.existsSync(join(control,'release'))){if(Date.now()>deadline)throw Error('external Shelf barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}
}
const realOpen=fsp.open.bind(fsp);
fsp.open=async(path,...args)=>{
 if(fault==='readback'&&afterPublication&&String(path).endsWith('00 Index.yaml'))throw Error('external readback failure');
 const handle=await realOpen(path,...args);
 const write=handle.writeFile.bind(handle),sync=handle.sync.bind(handle),close=handle.close.bind(handle);
 handle.close=async()=>{
  await close();
  if(String(path).includes('.academic-os-shelf-index-'))barrier('after-proposal-write');
  if(String(path).includes('.academic-os-shelf-probe-')&&String(path).endsWith('/a'))barrier('after-probe-write');
  if(String(path).endsWith(process.env.SHELF_TEST_TARGET||'!never'))barrier('after-plan-read');
 };
 handle.writeFile=async(data,...rest)=>{
  if(String(path).endsWith('.jsonl')){
   const event=JSON.parse(String(data));currentPhase=event.run.phase;
   if(currentPhase==='complete')barrier('before-terminal');
  }
  return await write(data,...rest);
 };
 handle.sync=async()=>{await sync();if(String(path).endsWith('/journals/textbooks'))barrier(currentPhase);};
 return handle;
};
const realSpawn=cp.spawn.bind(cp);
cp.spawn=(binary,args,options)=>{
 if(String(binary).endsWith('/shelf-native')&&process.env.SHELF_TEST_INTERPOSER){
  options={...options,env:{...(options?.env??process.env),[process.platform==='darwin'?'DYLD_INSERT_LIBRARIES':'LD_PRELOAD']:process.env.SHELF_TEST_INTERPOSER}};
 }
 const child=realSpawn(binary,args,options);
 if(args?.[2]==='00 Index.yaml'){
  const output=child.stdout?.emit.bind(child.stdout);
  if(output)child.stdout.emit=(event,...values)=>{
   if(event==='data'){
    if(fault==='missing')return true;
    if(fault==='malformed')values[0]=Buffer.from('{');
    if(fault==='duplicate')values[0]=Buffer.concat([values[0],values[0]]);
    if(fault==='version')values[0]=Buffer.from(JSON.stringify({...JSON.parse(String(values[0])),version:2}));
   }
   return output(event,...values);
  };
  const emit=child.emit.bind(child);
  child.emit=(event,...values)=>{
   if(event==='close'){
    afterPublication=true;
    barrier('after-exchange');
    if(fault==='receipt')values[0]=41;
   }
   return emit(event,...values);
  };
 }
 return child;
};
syncBuiltinESMExports();
`;

const interposerSource = String.raw`
#define _GNU_SOURCE
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#ifdef __linux__
#include <stdarg.h>
#include <sys/syscall.h>
#endif
static void gate(const char *target){
 const char *wanted=getenv("SHELF_TEST_TARGET"),*directory=getenv("SHELF_TEST_CONTROL");
 if(!wanted||!directory||strcmp(wanted,target))return;
 char reached[4096],release[4096];
 snprintf(reached,sizeof(reached),"%s/reached",directory);snprintf(release,sizeof(release),"%s/release",directory);
 int fd=open(reached,O_WRONLY|O_CREAT|O_EXCL,0600);
 if(fd<0)return;
 if(write(fd,target,strlen(target))<0)_exit(91);close(fd);
 for(int n=0;access(release,F_OK);n++){if(n>6000)_exit(92);usleep(5000);}
}
static int unsafe_target(const char *target){
 const char *wanted=getenv("SHELF_TEST_TARGET"),*unsafe=getenv("SHELF_TEST_UNSAFE");
 return wanted&&unsafe&&!strcmp(wanted,target)&&!strcmp(unsafe,"ordinary");
}
static int published=0;
static int target_fault(const char *target,const char *fault){
 const char *wanted=getenv("SHELF_TEST_TARGET"),*configured=getenv("SHELF_TEST_FAULT");
 return wanted&&configured&&!strcmp(wanted,target)&&!strcmp(configured,fault);
}
#ifdef __APPLE__
extern int renameatx_np(int,const char*,int,const char*,unsigned int);
static int gated_rename(int a,const char *s,int b,const char *t,unsigned int flags){
 gate(t);
 if(target_fault(t,"unsupported")){errno=ENOTSUP;return -1;}
 if(unsafe_target(t))flags=0;
 int result=renameatx_np(a,s,b,t,flags);
 if(!result&&target_fault(t,"native-sync"))published=1;
 if(!result&&target_fault(t,"native-signal"))published=2;
 return result;
}
static int gated_sync(int fd){if(published==2&&fd==3)raise(SIGKILL);if(published&&fd==3){errno=EIO;return -1;}return fsync(fd);}
__attribute__((used)) static struct {const void *replacement;const void *original;} interpose
 __attribute__((section("__DATA,__interpose"))) = {(const void*)gated_rename,(const void*)renameatx_np};
__attribute__((used)) static struct {const void *replacement;const void *original;} sync_interpose
 __attribute__((section("__DATA,__interpose"))) = {(const void*)gated_sync,(const void*)fsync};
#else
long syscall(long number,...){
 if(number!=SYS_renameat2){errno=ENOSYS;return -1;}
 va_list args;va_start(args,number);
 int a=va_arg(args,int);const char *s=va_arg(args,const char*);int b=va_arg(args,int);const char *t=va_arg(args,const char*);unsigned int f=va_arg(args,unsigned int);va_end(args);
 gate(t);
 if(target_fault(t,"unsupported")){errno=ENOTSUP;return -1;}
 if(unsafe_target(t))f=0;
 long (*real)(long,...)=dlsym(RTLD_NEXT,"syscall");
 long result=real(number,a,s,b,t,f);
 if(!result&&target_fault(t,"native-sync"))published=1;
 if(!result&&target_fault(t,"native-signal"))published=2;
 return result;
}
int fsync(int fd){if(published==2&&fd==3)raise(SIGKILL);if(published&&fd==3){errno=EIO;return -1;}int (*real)(int)=dlsym(RTLD_NEXT,"fsync");return real(fd);}
#endif
`;
