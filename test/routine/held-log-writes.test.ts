import assert from "node:assert/strict";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import { holdLogWrites } from "../support/held-log-writes.js";

for (const batched of [false, true]) {
  for (const cancel of [false, true]) {
    test(`${cancel ? "cancel" : "release"} held ${batched ? "batched" : "single"} writes through a real log stream`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "held-log-write-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const log = join(root, "session.log");
      const stream = createWriteStream(log);
      stream.on("error", () => {});
      const release = holdLogWrites(stream);
      await once(stream, "open");
      let callbacks = 0;
      if (batched) stream.cork();
      const writes = batched ? 2 : 1;
      for (let index = 0; index < writes; index++)
        stream.write(Buffer.alloc(32768, 120), (error) => {
          callbacks++;
          if (cancel) {
            assert.ok(error && "code" in error);
            assert.equal(error.code, "ERR_STREAM_DESTROYED");
          } else assert.ifError(error);
        });
      if (batched) stream.uncork();
      assert.equal((await readFile(log)).length, 0);
      assert.equal(callbacks, 0);
      if (cancel) {
        const closed = new Promise<void>((resolve) =>
          stream.once("close", resolve),
        );
        stream.destroy();
        await closed;
        release();
        assert.equal((await readFile(log)).length, 0);
      } else {
        release();
        stream.end();
        await finished(stream);
        assert.deepEqual(
          await readFile(log),
          Buffer.alloc(32768 * writes, 120),
        );
      }
      release();
      assert.equal(callbacks, writes);
      assert.equal(stream.closed, true);
    });
  }
}
