import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { launchdJobTarget, planLaunchdJob } from "../../src/launchd/index.js";
import type { LaunchdJobDescription } from "../../src/launchd/index.js";

const dailyJob: LaunchdJobDescription = {
  name: "nightly-refresh",
  programArguments: [
    "/usr/local/bin/node",
    "/private/academic-os/dist/runner.js",
    "/private/academic-os/config & owner.json",
  ],
  schedule: {
    kind: "calendar-interval",
    hour: 5,
    minute: 0,
    timeZone: "Asia/Singapore",
  },
  standardOutPath: "/dev/null",
  standardErrorPath: "/dev/null",
};

describe("LaunchAgent job planning", () => {
  it("generates a wake-aware, silent daily job in the pinned timezone", () => {
    const plan = planLaunchdJob({
      description: dailyJob,
      hostTimeZone: "Asia/Singapore",
      homeDirectory: "/Users/owner",
      uid: 501,
    });

    assert.equal(plan.label, "com.jerome-group.academic-os.nightly-refresh");
    assert.deepEqual(plan.schedule, {
      kind: "calendar-interval",
      hour: 5,
      minute: 0,
      timeZone: "Asia/Singapore",
    });
    assert.deepEqual(plan.programArguments, dailyJob.programArguments);
    assert.equal(plan.standardOutPath, "/dev/null");
    assert.equal(plan.standardErrorPath, "/dev/null");
    assert.equal(plan.runAtLoad, false);
    assert.match(plan.plist, /<key>Hour<\/key>\n<integer>5<\/integer>/u);
    assert.match(plan.plist, /<key>Minute<\/key>\n<integer>0<\/integer>/u);
    assert.match(plan.plist, /<key>RunAtLoad<\/key>\n<false\/>/u);
    assert.match(
      plan.plist,
      /<key>StandardOutPath<\/key>\n<string>\/dev\/null<\/string>/u,
    );
    assert.match(
      plan.plist,
      /<key>StandardErrorPath<\/key>\n<string>\/dev\/null<\/string>/u,
    );
    assert.match(plan.plist, /config &amp; owner\.json/u);
    assert.doesNotMatch(plan.plist, /<key>StartInterval<\/key>/u);
    assert.doesNotMatch(plan.plist, /<key>KeepAlive<\/key>/u);
  });

  it("keeps a resident job alive and loads it at login", () => {
    const plan = planLaunchdJob({
      description: {
        name: "operations-server",
        programArguments: [
          "/usr/local/bin/node",
          "/private/academic-os/mcp.js",
        ],
        schedule: { kind: "keep-alive" },
        standardOutPath: "/private/academic-os/logs/operations.log",
        standardErrorPath: "/private/academic-os/logs/operations.log",
      },
      hostTimeZone: "Asia/Singapore",
      homeDirectory: "/Users/owner",
      uid: 501,
    });

    assert.equal(plan.runAtLoad, true);
    assert.match(plan.plist, /<key>KeepAlive<\/key>\n<true\/>/u);
    assert.match(plan.plist, /<key>RunAtLoad<\/key>\n<true\/>/u);
    assert.doesNotMatch(plan.plist, /<key>StartCalendarInterval<\/key>/u);
    assert.match(
      plan.plist,
      /<key>StandardOutPath<\/key>\n<string>\/private\/academic-os\/logs\/operations\.log<\/string>/u,
    );
  });

  it("rejects installation on a host timezone the schedule does not pin", () => {
    assert.throws(
      () =>
        planLaunchdJob({
          description: dailyJob,
          hostTimeZone: "UTC",
          homeDirectory: "/Users/owner",
          uid: 501,
        }),
      /Asia\/Singapore/u,
    );
  });

  it("rejects relative program arguments and log paths", () => {
    assert.throws(
      () =>
        planLaunchdJob({
          description: { ...dailyJob, programArguments: ["node", "runner.js"] },
          hostTimeZone: "Asia/Singapore",
          homeDirectory: "/Users/owner",
          uid: 501,
        }),
      /absolute/u,
    );
    assert.throws(
      () =>
        planLaunchdJob({
          description: { ...dailyJob, standardErrorPath: "errors.log" },
          hostTimeZone: "Asia/Singapore",
          homeDirectory: "/Users/owner",
          uid: 501,
        }),
      /absolute/u,
    );
  });

  it("derives the reverse-DNS label, plist path and launchctl targets", () => {
    const target = launchdJobTarget({
      name: "nightly-refresh",
      homeDirectory: "/Users/owner",
      uid: 501,
    });

    assert.deepEqual(target, {
      label: "com.jerome-group.academic-os.nightly-refresh",
      plistPath:
        "/Users/owner/Library/LaunchAgents/com.jerome-group.academic-os.nightly-refresh.plist",
      domainTarget: "gui/501",
      serviceTarget: "gui/501/com.jerome-group.academic-os.nightly-refresh",
    });
  });

  it("rejects a job name that is not a single kebab-case label segment", () => {
    for (const name of ["Nightly Refresh", "../escape", "com.other.job", ""]) {
      assert.throws(
        () =>
          launchdJobTarget({ name, homeDirectory: "/Users/owner", uid: 501 }),
        /job name/u,
        name,
      );
    }
  });
});
