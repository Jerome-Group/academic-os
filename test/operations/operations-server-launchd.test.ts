import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planLaunchdJob } from "../../src/launchd/index.js";
import { describeOperationsServerLaunchdJob } from "../../src/operations/index.js";

function plan() {
  return planLaunchdJob({
    description: describeOperationsServerLaunchdJob({
      nodePath: "/usr/local/bin/node",
      serverModulePath:
        "/private/academic-os/dist/src/operations/run-operations-server.js",
      configPath: "/private/academic-os/config.json",
      logPath: "/Users/owner/Library/Logs/academic-os/operations-server.log",
    }),
    hostTimeZone: "Asia/Singapore",
    homeDirectory: "/Users/owner",
    uid: 501,
  });
}

describe("the Operations server's LaunchAgent", () => {
  it("is resident: started at login and restarted whenever it stops", () => {
    const job = plan();

    assert.equal(job.label, "com.jerome-group.academic-os.operations-server");
    assert.deepEqual(job.schedule, { kind: "keep-alive" });
    assert.equal(job.runAtLoad, true);
    assert.match(job.plist, /<key>KeepAlive<\/key>\n<true\/>/u);
    assert.match(job.plist, /<key>RunAtLoad<\/key>\n<true\/>/u);
    assert.doesNotMatch(job.plist, /<key>StartCalendarInterval<\/key>/u);
  });

  it("runs the built server against the private config and logs where the Owner can read it", () => {
    const job = plan();

    assert.deepEqual(job.programArguments, [
      "/usr/local/bin/node",
      "/private/academic-os/dist/src/operations/run-operations-server.js",
      "/private/academic-os/config.json",
    ]);
    assert.equal(
      job.standardOutPath,
      "/Users/owner/Library/Logs/academic-os/operations-server.log",
    );
    assert.equal(job.standardErrorPath, job.standardOutPath);
    assert.equal(
      job.plistPath,
      "/Users/owner/Library/LaunchAgents/com.jerome-group.academic-os.operations-server.plist",
    );
  });
});
