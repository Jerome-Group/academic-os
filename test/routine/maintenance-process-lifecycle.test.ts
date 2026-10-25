import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { maintenanceProcessFixture } from "../support/maintenance-process-fixture.js";

test("repository check envelope permits the declared full-check budget", async (t) => {
  const fixture = await maintenanceProcessFixture(t, {
    runner: "check-budget",
    behavior: "normal",
  });
  assert.equal(fixture.report.result.passed, true);
});

for (const runner of ["repository", "module"] as const) {
  test(`${runner} bounds slow log queues and retains both output streams`, async (t) => {
    const fixture = await maintenanceProcessFixture(t, {
      runner,
      behavior: "volume",
      logFault: "slow",
      timeoutMs: 1500,
    });
    assert.ok(
      fixture.report.maxBuffered <= 196608,
      `queued ${fixture.report.maxBuffered} bytes behind a slow log`,
    );
    assert.ok(fixture.report.backpressureEvents > 0);
    const log = await readFile(
      runner === "repository"
        ? fixture.log
        : `${fixture.report.result.artifacts}/session.log`,
    );
    assert.equal(log.length, 8388644);
    assert.equal(log.filter((byte) => byte === 120).length, 4194304);
    assert.equal(log.filter((byte) => byte === 121).length, 4194304);
    assert.deepEqual(fixture.report.streams, [
      { closed: true, destroyed: true, writableFinished: true, length: 0 },
    ]);
    if (runner === "repository") assert.equal(fixture.report.result.code, 0);
    else assert.deepEqual(fixture.report.result.failures, []);
  });
  for (const logFault of [
    "paused-write",
    "paused-close",
    "paused-stall",
    "finish-stall",
  ] as const) {
    test(`${runner} closes ${logFault} without waiting past its deadline`, async (t) => {
      const fixture = await maintenanceProcessFixture(t, {
        runner,
        behavior: logFault === "finish-stall" ? "success" : "volume",
        logFault,
      });
      assert.ok(fixture.report.elapsedMs < 1000);
      assert.ok(fixture.report.streams.every((stream) => stream.closed));
      if (logFault !== "finish-stall") {
        assert.ok(fixture.report.backpressureEvents > 0);
        assert.ok(fixture.report.maxBuffered <= 196608);
      }
      if (logFault === "paused-write" || logFault === "paused-close") {
        const expectedCode =
          logFault === "paused-write" ? "ENOSPC" : "ERR_STREAM_PREMATURE_CLOSE";
        if (runner === "repository")
          assert.equal(fixture.report.result.error?.code, expectedCode);
        else
          assert.ok(
            fixture.report.result.failures?.some(
              ({ code }) => code === expectedCode,
            ),
          );
      } else if (runner === "repository")
        assert.notEqual(fixture.report.result.code, 0);
      else
        assert.ok(
          fixture.report.result.failures?.some(
            ({ code }) => code === "session-runner-failed",
          ),
        );
    });
  }
  test(`${runner} refuses bad log before child work`, async (t) => {
    const fixture = await maintenanceProcessFixture(t, {
      runner,
      behavior: "ignore-term",
      logFault: "open",
    });
    assert.deepEqual(
      fixture.ownedPids,
      [],
      "log refusal allowed useful child startup",
    );
    await assert.rejects(readFile(fixture.marker));
    if (runner === "repository") {
      assert.equal(fixture.report.result.error?.code, "EEXIST");
      assert.equal(await readFile(fixture.log, "utf8"), "original log\n");
    } else
      assert.ok(
        fixture.report.result.failures?.some(({ code }) => code === "EISDIR"),
      );
  });
  for (const logFault of ["write", "finish"] as const) {
    test(`${runner} drains child and log before reporting ${logFault} failure`, async (t) => {
      const fixture = await maintenanceProcessFixture(t, {
        runner,
        behavior: logFault === "write" ? "descendant" : "normal",
        logFault,
      });
      if (logFault === "write") assert.equal(fixture.ownedPids.length, 2);
      if (runner === "repository")
        assert.equal(fixture.report.result.error?.code, "ENOSPC");
      else
        assert.ok(
          fixture.report.result.failures?.some(
            ({ code, message }) =>
              code === "ENOSPC" && message.includes("synthetic disk full"),
          ),
        );
    });
  }
  test(`${runner} completes successfully with flushed diagnostics`, async (t) => {
    const fixture = await maintenanceProcessFixture(t, {
      runner,
      behavior: "success",
    });
    if (runner === "repository") assert.equal(fixture.report.result.code, 0);
    else {
      assert.deepEqual(fixture.report.result.failures, []);
      const validated = JSON.parse(
        await readFile(
          `${fixture.report.result.artifacts}/validated-outcome.json`,
          "utf8",
        ),
      );
      assert.equal(validated.journal.valid, true);
      assert.deepEqual(validated.outcome.failures, []);
    }
    const log = await readFile(
      runner === "repository"
        ? fixture.log
        : `${fixture.report.result.artifacts}/session.log`,
      "utf8",
    );
    assert.match(log, /diagnostic stdout/u);
    assert.match(log, /diagnostic stderr/u);
  });
  for (const behavior of ["ignore-term", "descendant"] as const) {
    test(`${runner} bounds ${behavior} and drains retained pipes`, async (t) => {
      const fixture = await maintenanceProcessFixture(t, { runner, behavior });
      assert.ok(fixture.ownedPids.length > 0);
      if (runner === "repository") {
        if (behavior === "descendant")
          assert.equal(fixture.report.result.code, 0);
        else assert.notEqual(fixture.report.result.code, 0);
      } else if (behavior === "ignore-term")
        assert.ok(
          fixture.report.result.failures?.some(
            ({ code }) => code === "session-runner-failed",
          ),
        );
      await assert.rejects(readFile(fixture.marker));
    });
  }
  test(`${runner} preserves normal diagnostics and nonzero exit`, async (t) => {
    const fixture = await maintenanceProcessFixture(t, {
      runner,
      behavior: "normal",
    });
    if (runner === "repository") {
      assert.equal(fixture.report.result.code, 7);
      assert.match(fixture.report.result.output ?? "", /diagnostic stdout/u);
      assert.match(fixture.report.result.output ?? "", /diagnostic stderr/u);
    } else {
      assert.ok(
        fixture.report.result.failures?.some(
          ({ code, message }) =>
            code === "session-exit" && message.includes("7"),
        ),
      );
      const log = await readFile(
        `${fixture.report.result.artifacts}/session.log`,
        "utf8",
      );
      assert.match(log, /diagnostic stdout/u);
      assert.match(log, /diagnostic stderr/u);
    }
  });
  test(`${runner} reports unavailable executable without deadline residue`, async (t) => {
    const fixture = await maintenanceProcessFixture(t, {
      runner,
      behavior: "normal",
      unavailable: true,
    });
    assert.deepEqual(fixture.ownedPids, []);
    if (runner === "repository")
      assert.equal(fixture.report.result.error?.code, "ENOENT");
    else
      assert.ok(
        fixture.report.result.failures?.some(
          ({ code, message }) => code === "ENOENT" && message.includes("spawn"),
        ),
      );
  });
}
