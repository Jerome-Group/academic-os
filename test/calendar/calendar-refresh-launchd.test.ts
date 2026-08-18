import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeCalendarRefreshLaunchdJob } from "../../src/calendar/calendar-refresh-launchd.js";

const temporaryRoots: string[] = [];
const runnerPath = fileURLToPath(
  new URL(
    "../../src/calendar/calendar-refresh-launchd-runner.js",
    import.meta.url,
  ),
);
const installerPath = fileURLToPath(
  new URL(
    "../../../scripts/install-calendar-refresh-launchd.mjs",
    import.meta.url,
  ),
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("calendar Refresh LaunchAgent", () => {
  it("describes a Singapore-time, wake-aware, silent Refresh job", () => {
    const description = describeCalendarRefreshLaunchdJob({
      nodePath: "/usr/local/bin/node",
      runnerModulePath: "/private/academic-os/dist/runner.js",
      cliPath: "/private/academic-os/dist/cli.js",
      configPath: "/private/academic-os/config & owner.json",
      notificationPath: "/usr/bin/osascript",
    });

    assert.equal(description.name, "calendar-refresh");
    assert.deepEqual(description.schedule, {
      kind: "calendar-interval",
      hour: 5,
      minute: 0,
      timeZone: "Asia/Singapore",
    });
    assert.deepEqual(description.programArguments, [
      "/usr/local/bin/node",
      "/private/academic-os/dist/runner.js",
      "/private/academic-os/dist/cli.js",
      "/private/academic-os/config & owner.json",
      "/usr/bin/osascript",
    ]);
    assert.equal(description.standardOutPath, "/dev/null");
    assert.equal(description.standardErrorPath, "/dev/null");
  });

  it("runs only calendar Refresh and stays silent on success", async () => {
    const fixture = await setupRunnerFixture(0);

    const result = await runRunner(fixture);

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(
      JSON.parse(await readFile(fixture.argumentsPath, "utf8")),
      ["calendar", "refresh", "--config", fixture.configPath, "--json"],
    );
    assert.equal(await readOptional(fixture.notificationsPath), "");
  });

  it("emits one concise notification when Refresh fails", async () => {
    const fixture = await setupRunnerFixture(2);

    const result = await runRunner(fixture);

    assert.equal(result.exitCode, 2, JSON.stringify(result));
    const notifications = (await readFile(fixture.notificationsPath, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
    assert.deepEqual(notifications, [
      [
        "-e",
        'display notification "Calendar Refresh failed; stale state retained." with title "academic-os"',
      ],
    ]);
  });

  it("renders installer wiring without loading a real LaunchAgent", {
    skip:
      process.platform !== "darwin"
        ? "LaunchAgent installation is macOS-only."
        : false,
  }, async () => {
    const fixture = await setupRunnerFixture(0);

    const result = await runProcess(
      process.execPath,
      [installerPath, "--config", fixture.configPath, "--dry-run"],
      { TZ: "Asia/Singapore" },
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, "calendar refresh schedule");
    assert.equal(report.outcome, "preview");
    assert.equal(report.label, "com.jerome-group.academic-os.calendar-refresh");
    assert.equal(report.calendarTimeZone, "Asia/Singapore");
    assert.deepEqual(report.startCalendarInterval, { Hour: 5, Minute: 0 });
    assert.equal(report.programArguments[0], process.execPath);
    assert.match(
      report.programArguments[1],
      /dist\/src\/calendar\/calendar-refresh-launchd-runner\.js$/u,
    );
    assert.match(report.programArguments[2], /dist\/src\/cli\.js$/u);
    assert.equal(report.programArguments[3], fixture.configPath);
    assert.equal(report.programArguments[4], "/usr/bin/osascript");
    assert.match(report.plist, /<key>StartCalendarInterval<\/key>/u);
    assert.match(report.plist, /<key>RunAtLoad<\/key>\n<false\/>/u);
  });
});

interface RunnerFixture {
  argumentsPath: string;
  cliPath: string;
  configPath: string;
  notificationsPath: string;
  notificationPath: string;
  root: string;
}

async function setupRunnerFixture(exitCode: number): Promise<RunnerFixture> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-calendar-launchd-"));
  temporaryRoots.push(root);
  const argumentsPath = join(root, "arguments.json");
  const notificationsPath = join(root, "notifications.jsonl");
  const cliPath = join(root, "fake-cli.mjs");
  const notificationPath = join(root, "fake-notification.mjs");
  const configPath = join(root, "private config.json");
  await writeFile(
    cliPath,
    `import { writeFile } from "node:fs/promises";\nawait writeFile(process.env.ARGUMENTS_PATH, JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = ${exitCode};\n`,
  );
  await writeFile(
    notificationPath,
    `#!/usr/bin/env node\nimport { appendFile } from "node:fs/promises";\nawait appendFile(process.env.NOTIFICATIONS_PATH, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
  );
  await chmod(notificationPath, 0o755);
  await writeFile(configPath, "private configuration");
  return {
    argumentsPath,
    cliPath,
    configPath,
    notificationsPath,
    notificationPath,
    root,
  };
}

async function runRunner(fixture: RunnerFixture): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return await runProcess(
    process.execPath,
    [runnerPath, fixture.cliPath, fixture.configPath, fixture.notificationPath],
    {
      ARGUMENTS_PATH: fixture.argumentsPath,
      NOTIFICATIONS_PATH: fixture.notificationsPath,
    },
  );
}

async function runProcess(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: { ...process.env, ...environment },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? -1, stderr, stdout }),
    );
  });
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
