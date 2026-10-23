import fs from "node:fs/promises";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";

const original = { ...fs };
const trace = process.env.AOS_JOURNAL_TRACE;
const point = process.env.AOS_JOURNAL_POINT;
const mount = process.env.AOS_JOURNAL_MOUNT;
let paused = false;

async function record(kind) {
  if (trace) await original.appendFile(trace, `${kind}\n`);
}

async function pause(candidate) {
  if (paused || candidate !== point) return;
  paused = true;
  process.send?.({ kind: "barrier", point });
  await once(process, "message");
}

fs.readFile = async (path, ...args) => {
  if (String(path).includes("/journals/") && String(path).endsWith(".jsonl")) {
    await record("journal-read");
    await pause("read");
  }
  return await original.readFile(path, ...args);
};
fs.chmod = async (path, ...args) => {
  if (String(path).endsWith(".sqlite")) await pause("bootstrap");
  return await original.chmod(path, ...args);
};
fs.mkdir = async (path, ...args) => {
  if (String(path).startsWith(mount ?? "\0")) {
    await record("mounted-write");
    await pause(
      String(path).includes(".academic-os-stage-") ? "staging" : "publication",
    );
  }
  return await original.mkdir(path, ...args);
};
for (const method of ["unlink", "rmdir"]) {
  fs[method] = async (path, ...args) => {
    if (String(path).includes(".academic-os-stage-")) {
      await record("cleanup");
      await pause("cleanup");
    }
    return await original[method](path, ...args);
  };
}
fs.open = async (path, ...args) => {
  const file = await original.open(path, ...args);
  if (!String(path).includes("/journals/") || !String(path).endsWith(".jsonl"))
    return file;
  const writeFile = file.writeFile.bind(file);
  const sync = file.sync.bind(file);
  let finalOutcome = false;
  file.writeFile = async (contents, ...options) => {
    await record("journal-write");
    const event = JSON.parse(String(contents));
    finalOutcome = event.type === "outcome" && event.outcome === "completed";
    await pause("append");
    if (process.env.AOS_JOURNAL_FAIL_APPEND === "1")
      throw new Error("synthetic pending append failure");
    return await writeFile(contents, ...options);
  };
  file.sync = async () => {
    if (finalOutcome) await pause("outcome-sync");
    return await sync();
  };
  return file;
};
syncBuiltinESMExports();
