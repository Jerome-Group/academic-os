import assert from "node:assert/strict";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { delayLogWrites } from "../support/delayed-log-writes.js";

for (const batched of [false, true]) {
  test(`cancelled ${batched ? "batched" : "single"} slow log writes settle callbacks before closing the real file`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "delayed-log-write-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stream = createWriteStream(join(root, "session.log"));
    stream.on("error", () => {});
    delayLogWrites(stream, 50);
    await once(stream, "open");
    let callbacks = 0;
    const writes = batched ? 2 : 1;
    if (batched) stream.cork();
    for (let index = 0; index < writes; index++)
      stream.write(Buffer.alloc(32768), (error) => {
        callbacks++;
        assert.ok(error && "code" in error);
        assert.equal(error.code, "ERR_STREAM_DESTROYED");
      });
    if (batched) stream.uncork();
    const closed = new Promise<void>((resolve) =>
      stream.once("close", resolve),
    );
    stream.destroy();
    await closed;
    await setTimeout(80);
    assert.equal(callbacks, writes);
    assert.equal(stream.closed, true);
  });
}
