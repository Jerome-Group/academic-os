import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

    const result = await runProcess(
      process.execPath,
      [
        runnerPath,
        fixture.cliPath,
        fixture.configPath,
        fixture.notificationPath,
      ],
      { ...process.env, HOME: fixture.root },
    );

    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(
      JSON.parse(await readFile(fixture.argumentsPath, "utf8")),
      ["routine", "morning", "--config", fixture.configPath],
    );
  });

  it("carries the morning's exit status back to launchd", async () => {
    const fixture = await runnerFixture(2);

    const result = await runProcess(
      process.execPath,
      [
        runnerPath,
        fixture.cliPath,
        fixture.configPath,
        fixture.notificationPath,
      ],
      { ...process.env, HOME: fixture.root },
    );

    assert.equal(result.exitCode, 2, JSON.stringify(result));
  });

  it("runs npm installation and script descendants with the scheduled toolchain", async () => {
    const { sha256 } = await import("../../src/checksum.js");
    const fixture = await runnerFixture(0);
    await access(join(dirname(process.execPath), "npm"));
    const customBin = join(fixture.root, "custom bin & tools");
    const customCommand = join(customBin, "morning-path-probe");
    const commandsPath = join(fixture.root, "commands.json");
    const descendantPath = join(fixture.root, "descendant.json");
    await mkdir(customBin);
    await writeFile(
      customCommand,
      "#!/bin/sh\nprintf 'custom executable\\n'\n",
    );
    await chmod(customCommand, 0o700);
    await writeFile(
      join(fixture.root, "package.json"),
      JSON.stringify({
        name: "scheduled-toolchain-fixture",
        version: "1.0.0",
        private: true,
        scripts: { probe: "node descendant.mjs" },
      }),
    );
    await writeFile(
      join(fixture.root, "package-lock.json"),
      JSON.stringify({
        name: "scheduled-toolchain-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "scheduled-toolchain-fixture", version: "1.0.0" },
        },
      }),
    );
    await writeFile(
      join(fixture.root, "descendant.mjs"),
      `import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const custom = spawnSync("morning-path-probe", [], { encoding: "utf8" });
writeFileSync(${JSON.stringify(descendantPath)}, JSON.stringify({
  nodePath: process.execPath,
  marker: process.env.ACADEMIC_OS_LAUNCHD_TEST_MARKER,
  customStatus: custom.status,
  customErrorCode: custom.error?.code ?? null,
  customOutput: custom.stdout,
}));
process.exitCode = custom.status ?? 1;
`,
    );
    await writeFile(
      fixture.cliPath,
      `import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const options = { cwd: ${JSON.stringify(fixture.root)}, encoding: "utf8" };
const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], options);
const script = install.status === 0 ? spawnSync("npm", ["run", "probe", "--silent"], options) : null;
writeFileSync(${JSON.stringify(commandsPath)}, JSON.stringify({ install, script }));
process.exitCode = install.status === 0 ? script.status ?? 1 : install.status ?? 1;
`,
    );

    const installPath = [
      customBin,
      dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ].join(":");
    const installation = await runProcess(
      process.execPath,
      [installerPath, "--config", fixture.configPath, "--dry-run"],
      { HOME: fixture.root, PATH: installPath, TZ: "Asia/Singapore" },
    );
    assert.equal(installation.exitCode, 0, JSON.stringify(installation));
    const preview = JSON.parse(installation.stdout);
    const decoder = spawnSync(
      process.platform === "darwin" ? "/usr/bin/plutil" : "/usr/bin/python3",
      process.platform === "darwin"
        ? ["-convert", "json", "-o", "-", "--", "-"]
        : [
            "-c",
            "import json, plistlib, sys; json.dump(plistlib.loads(sys.stdin.buffer.read()), sys.stdout)",
          ],
      { input: preview.plist, encoding: "utf8" },
    );
    assert.equal(
      decoder.status,
      0,
      `Plist decoding requires plutil on macOS or Python3 plistlib on Linux: ${JSON.stringify(decoder)}`,
    );
    const plist = JSON.parse(decoder.stdout);
    assert.deepEqual(plist.ProgramArguments, [
      process.execPath,
      runnerPath,
      fileURLToPath(new URL("../../src/cli.js", import.meta.url)),
      fixture.configPath,
    ]);
    const [selectedNode, selectedRunner, , selectedConfig] =
      plist.ProgramArguments;
    const environment = plist.EnvironmentVariables ?? {};
    const result = await runProcess(
      selectedNode,
      [
        selectedRunner,
        fixture.cliPath,
        selectedConfig,
        fixture.notificationPath,
      ],
      {
        HOME: fixture.root,
        PATH: "/usr/bin:/bin",
        TMPDIR: fixture.root,
        npm_config_cache: join(fixture.root, "npm cache"),
        npm_config_script_shell: "/bin/sh",
        ACADEMIC_OS_LAUNCHD_TEST_MARKER: "inherited marker",
        ...environment,
      },
    );
    const commands = JSON.parse(await readFile(commandsPath, "utf8"));
    const descendant = JSON.parse(await readFile(descendantPath, "utf8"));
    const receipt = JSON.parse(
      await readFile(
        join(
          fixture.root,
          ".local/state/academic-os/morning-launcher",
          `${sha256(fixture.configPath)}.json`,
        ),
        "utf8",
      ),
    );
    assert.equal(
      result.exitCode,
      0,
      JSON.stringify({ result, commands, descendant, receipt }),
    );
    assert.equal(commands.install.status, 0);
    assert.equal(commands.script.status, 0);
    assert.deepEqual(descendant, {
      nodePath: selectedNode,
      marker: "inherited marker",
      customStatus: 0,
      customErrorCode: null,
      customOutput: "custom executable\n",
    });
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.exitCode, 0);
    assert.ok(receipt.lastCompletedAt);
    assert.deepEqual(environment, { PATH: installPath });
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
      { ...process.env, TZ: "Asia/Singapore" },
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
  root: string;
  notificationPath: string;
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
  const notificationPath = join(root, "notify.mjs");
  await writeFile(
    notificationPath,
    "#!/usr/bin/env node\nprocess.exitCode=0;\n",
  );
  await chmod(notificationPath, 0o700);
  return { root, notificationPath, argumentsPath, cliPath, configPath };
}

async function runProcess(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: environment,
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

it("retains private launcher failure evidence and notifies only failure/recovery transitions", async () => {
  const { runMorningRoutineLaunchdJob } = await import(
    "../../src/routine/morning-routine-launchd-runner.js"
  );
  const { sha256 } = await import("../../src/checksum.js");
  const fixture = await runnerFixture(1);
  const notices = join(fixture.root, "notices.jsonl");
  await writeFile(
    fixture.notificationPath,
    `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(notices)}, JSON.stringify(process.argv.slice(2))+'\\n');\n`,
  );
  const input = {
    nodePath: process.execPath,
    cliPath: fixture.cliPath,
    configPath: fixture.configPath,
    evidenceRoot: join(fixture.root, "evidence"),
    notificationPath: fixture.notificationPath,
  };
  assert.equal(await runMorningRoutineLaunchdJob(input), 1);
  assert.equal(await runMorningRoutineLaunchdJob(input), 1);
  const path = join(input.evidenceRoot, `${sha256(input.configPath)}.json`);
  let receipt = JSON.parse(await readFile(path, "utf8"));
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.lastCompletedAt, null);
  assert.equal((await readFile(notices, "utf8")).trim().split("\n").length, 1);
  assert.ok(!(await readFile(path, "utf8")).includes(fixture.configPath));
  await writeFile(fixture.cliPath, "process.exitCode=0;\n");
  assert.equal(await runMorningRoutineLaunchdJob(input), 0);
  assert.equal(await runMorningRoutineLaunchdJob(input), 0);
  receipt = JSON.parse(await readFile(path, "utf8"));
  assert.equal(receipt.status, "completed");
  assert.ok(receipt.lastCompletedAt);
  assert.equal((await readFile(notices, "utf8")).trim().split("\n").length, 2);
  assert.equal(
    await runMorningRoutineLaunchdJob({
      ...input,
      nodePath: join(fixture.root, "missing-node"),
    }),
    1,
  );
  const failed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(failed.lastCompletedAt, receipt.lastCompletedAt);
});

it("refuses a successful launcher result when private status cannot be saved", async () => {
  const { runMorningRoutineLaunchdJob } = await import(
    "../../src/routine/morning-routine-launchd-runner.js"
  );
  const fixture = await runnerFixture(0);
  const evidenceRoot = join(fixture.root, "blocked-state");
  await writeFile(evidenceRoot, "synthetic obstruction");
  assert.equal(
    await runMorningRoutineLaunchdJob({
      nodePath: process.execPath,
      cliPath: fixture.cliPath,
      configPath: fixture.configPath,
      evidenceRoot,
      notificationPath: fixture.notificationPath,
    }),
    1,
  );
  assert.equal(await readFile(evidenceRoot, "utf8"), "synthetic obstruction");
});
