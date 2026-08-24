import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planLaunchdJob } from "../../src/launchd/index.js";
import { describeMorningRoutineLaunchdJob } from "../../src/routine/index.js";

function plan(hostTimeZone = "Asia/Singapore") {
  return planLaunchdJob({
    description: describeMorningRoutineLaunchdJob({
      nodePath: "/usr/local/bin/node",
      runnerModulePath:
        "/private/academic-os/dist/src/routine/morning-routine-launchd-runner.js",
      cliPath: "/private/academic-os/dist/src/cli.js",
      configPath: "/private/academic-os/config.json",
    }),
    hostTimeZone,
    homeDirectory: "/Users/owner",
    uid: 501,
  });
}

describe("the morning routine's LaunchAgent", () => {
  it("fires at 06:00 in the offering's timezone, and never at load", () => {
    const job = plan();

    assert.equal(job.label, "com.jerome-group.academic-os.morning-routine");
    assert.deepEqual(job.schedule, {
      kind: "calendar-interval",
      hour: 6,
      minute: 0,
      timeZone: "Asia/Singapore",
    });
    assert.equal(job.runAtLoad, false);
    assert.match(job.plist, /<key>Hour<\/key>\n<integer>6<\/integer>/u);
    assert.match(job.plist, /<key>Minute<\/key>\n<integer>0<\/integer>/u);
    assert.match(job.plist, /<key>RunAtLoad<\/key>\n<false\/>/u);
  });

  it("runs the built CLI against the private config, silently", () => {
    const job = plan();

    assert.deepEqual(job.programArguments, [
      "/usr/local/bin/node",
      "/private/academic-os/dist/src/routine/morning-routine-launchd-runner.js",
      "/private/academic-os/dist/src/cli.js",
      "/private/academic-os/config.json",
    ]);
    assert.equal(job.standardOutPath, "/dev/null");
    assert.equal(job.standardErrorPath, "/dev/null");
    assert.equal(
      job.plistPath,
      "/Users/owner/Library/LaunchAgents/com.jerome-group.academic-os.morning-routine.plist",
    );
  });

  it("refuses a Mac whose clock is not the offering's", () => {
    assert.throws(() => plan("Europe/London"), /Asia\/Singapore/u);
  });

  it("is a separate job from the 05:00 Calendar Refresh", () => {
    assert.notEqual(
      plan().label,
      "com.jerome-group.academic-os.calendar-refresh",
    );
  });
});
