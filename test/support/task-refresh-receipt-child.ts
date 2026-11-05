import { once } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { createFileTaskRefreshReceiptStore } from "../../src/tasks/file-task-refresh-receipt-store.js";
import type {
  TaskRefreshAttempt,
  TaskTargetIdentity,
} from "../../src/tasks/types.js";

const [inputPath = "", mode = "write"] = process.argv.slice(2);
const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as {
  stateRoot: string;
  driveMount: string;
  target: TaskTargetIdentity;
  attempt: TaskRefreshAttempt;
};
const receiptDirectory = join(input.stateRoot, "task-refresh-receipts");
const originalRename = fs.rename;
const originalOpen = fs.open;
const trace: string[] = [];
fs.rename = async (source, destination) => {
  if (String(destination).startsWith(`${receiptDirectory}/`)) {
    if (mode === "hold") {
      process.send?.({ kind: "receipt-owned" });
      await once(process, "message");
    }
    await originalRename(source, destination);
    trace.push("renamed");
    return;
  }
  return await originalRename(source, destination);
};
fs.open = async (path, ...arguments_) => {
  const file = await originalOpen(path, ...arguments_);
  if (String(path) === receiptDirectory) {
    const sync = file.sync.bind(file);
    file.sync = async () => {
      await sync();
      trace.push("directory-synced");
    };
  }
  return file;
};
syncBuiltinESMExports();
const receipt = await createFileTaskRefreshReceiptStore(input).record(
  input.attempt,
);
process.stdout.write(`${JSON.stringify({ receipt, trace })}\n`);
process.disconnect?.();
