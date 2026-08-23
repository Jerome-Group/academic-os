import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const temporaryRoots: string[] = [];
const runnerPath = fileURLToPath(
  new URL(
    "../../src/routine/morning-routine-launchd-runner.js",
    import.meta.url,
  ),
);
const installerPath = fileURLToPath(
  new URL(
    "../../../scripts/install-morning-routine-launchd.mjs",
    import.meta.url,
  ),
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("the morning routine's launchd runner", () => {
  it("runs one morning against the private config", async () => {
    const fixture = await runnerFixture(0);

    const result = await runProcess(process.execPath, [
      runnerPath,
      fixture.cliPath,
      fixture.configPath,
    ]);

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(
      JSON.parse(await readFile(fixture.argumentsPath, "utf8")),
      ["routine", "morning", "--config", fixture.configPath],
    );
  });

  it("carries the morning's exit status back to launchd", async () => {
    const fixture = await runnerFixture(2);

    const result = await runProcess(process.execPath, [
      runnerPath,
      fixture.cliPath,
      fixture.configPath,
    ]);

    assert.equal(result.exitCode, 2, JSON.stringify(result));
  });

  it("renders installer wiring without loading a real LaunchAgent", {
    skip:
      process.platform !== "darwin"
        ? "LaunchAgent installation is macOS-only."
        : false,
  }, async () => {
    const fixture = await runnerFixture(0);

    const result = await runProcess(
      process.execPath,
      [installerPath, "--config", fixture.configPath, "--dry-run"],
      { TZ: "Asia/Singapore" },
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.command, "routine morning schedule");
    assert.equal(preview.label, "com.jerome-group.academic-os.morning-routine");
    assert.equal(preview.offeringTimeZone, "Asia/Singapore");
    assert.deepEqual(preview.startCalendarInterval, { Hour: 6, Minute: 0 });
    assert.equal(preview.programArguments[0], process.execPath);
    assert.match(
      preview.programArguments[1],
      /dist\/src\/routine\/morning-routine-launchd-runner\.js$/u,
    );
    assert.match(preview.programArguments[2], /dist\/src\/cli\.js$/u);
    assert.equal(preview.programArguments[3], fixture.configPath);
    assert.match(preview.plist, /<key>RunAtLoad<\/key>\n<false\/>/u);
  });
});

async function runnerFixture(exitCode: number): Promise<{
  argumentsPath: string;
  cliPath: string;
  configPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-morning-launchd-"));
  temporaryRoots.push(root);
  const argumentsPath = join(root, "arguments.json");
  const cliPath = join(root, "fake-cli.mjs");
  const configPath = join(root, "private config.json");
  await writeFile(
    cliPath,
    `import { writeFile } from "node:fs/promises";\nawait writeFile(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = ${exitCode};\n`,
  );
  await writeFile(configPath, "private configuration");
  return { argumentsPath, cliPath, configPath };
}

async function runProcess(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
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
