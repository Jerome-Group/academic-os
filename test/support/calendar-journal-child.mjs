import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, phase] = process.argv.slice(2);
const target = join(root, "calendar", "promotions.jsonl");
const originalOpen = fs.open;
const originalRead = fs.readFile;
let held = false;
async function hold(at) {
  if (held) return;
  held = true;
  process.send?.({ kind: "held", at });
  await new Promise((resolve) => process.once("message", resolve));
}
fs.open = async function (path, ...args) {
  const handle = await originalOpen.call(this, path, ...args);
  if (phase === "read" && path === `${target}.lock`) await hold("bootstrap");
  if (
    (phase === "file-sync" && path === target) ||
    (phase === "directory-sync" && path === dirname(target))
  ) {
    const sync = handle.sync;
    handle.sync = async function () {
      await sync.call(this);
      await hold(phase);
    };
  }
  return handle;
};
fs.readFile = async function (path, ...args) {
  try {
    return await originalRead.call(this, path, ...args);
  } catch (error) {
    if (phase === "read" && path === target && error.code === "ENOENT")
      await hold("read");
    throw error;
  }
};
syncBuiltinESMExports();
try {
  const { createFileCalendarPromotionJournal } = await import(
    pathToFileURL(
      join(
        process.cwd(),
        "dist/src/calendar/file-calendar-promotion-journal.js",
      ),
    )
  );
  const accepted = await createFileCalendarPromotionJournal(root).appendOnce({
    schemaVersion: 1,
    proposalId: "owned-synthetic-proposal",
    eventId: "owned-synthetic-event",
    idempotencyKey: "owned-synthetic-key",
  });
  console.log(JSON.stringify({ accepted }));
} catch (error) {
  console.log(JSON.stringify({ refused: String(error) }));
  process.exitCode = 1;
} finally {
  fs.open = originalOpen;
  fs.readFile = originalRead;
  syncBuiltinESMExports();
  process.disconnect?.();
}
