import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const original = { ...fs };
const target = process.env.AOS_CURATION_TARGET;
const point = process.env.AOS_CURATION_POINT;
const trace = process.env.AOS_CURATION_TRACE;
let paused = false;
let staged = false;
let published = false;
let reads = 0;

async function record(event) {
  if (trace) await original.appendFile(trace, `${JSON.stringify(event)}\n`);
}

async function pause(candidate) {
  if (paused || candidate !== point) return;
  paused = true;
  process.send?.({ kind: "barrier", point });
  await once(process, "message");
}

process.send?.({ kind: "started", pid: process.pid });

fs.readFile = async (path, ...args) => {
  const bytes = await original.readFile(path, ...args);
  if (String(path) === target) {
    reads += 1;
    await record({
      step: "read",
      number: reads,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (published) await pause("readback");
    else if (staged) await pause("final-read");
  }
  return bytes;
};
fs.rename = async (from, to) => {
  await original.rename(from, to);
  if (String(to) === target) {
    published = true;
    await record({ step: "renamed" });
  }
};
fs.open = async (path, ...args) => {
  const file = await original.open(path, ...args);
  if (String(path).startsWith(`${target}.`)) staged = true;
  if (String(path) === target) {
    const readFile = file.readFile.bind(file);
    file.readFile = async (...options) => {
      const bytes = await readFile(...options);
      await pause("observation");
      return bytes;
    };
  }
  if (String(path).includes("/journals/") && String(path).endsWith(".jsonl")) {
    const writeFile = file.writeFile.bind(file);
    const sync = file.sync.bind(file);
    let event;
    file.writeFile = async (bytes, ...options) => {
      event = JSON.parse(String(bytes));
      await record({ step: "journal", event });
      return await writeFile(bytes, ...options);
    };
    file.sync = async () => {
      if (event?.type === "result") await pause("result-sync");
      return await sync();
    };
  }
  return file;
};
syncBuiltinESMExports();
