import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  link,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  verifyExternalStoragePolicy,
  type ExternalStoragePolicy,
} from "../../src/launchd/external-storage-policy.js";
import { runExternalStorageLaunchdJob } from "../../src/launchd/external-storage-launchd-runner.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  policy: ExternalStoragePolicy;
  policyPath: string;
  childPath: string;
  outputPath: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aos-external-storage-")),
  );
  roots.push(root);
  const volume = join(root, "volume");
  await mkdir(volume);
  const configPath = join(volume, "config.json");
  const stateRoot = join(volume, "state");
  const tempRoot = join(volume, "tmp");
  const cacheRoot = join(volume, "cache");
  const logRoot = join(volume, "logs");
  await Promise.all(
    [stateRoot, tempRoot, cacheRoot, logRoot].map((path) => mkdir(path)),
  );
  await writeFile(configPath, JSON.stringify({ stateRoot }));
  const policy: ExternalStoragePolicy = {
    schemaVersion: 1,
    configPath,
    stateRoot,
    tempRoot,
    cacheRoot,
    logRoot,
    requiredVolumes: [{ mountPoint: volume, volumeUUID: "expected-uuid" }],
  };
  const policyPath = join(root, "policy.json");
  await writeFile(policyPath, JSON.stringify(policy));
  const childPath = join(root, "child.mjs");
  const outputPath = join(root, "child-result.json");
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ args: process.argv.slice(2), env: Object.fromEntries(['TMPDIR','TMP','TEMP','XDG_CACHE_HOME','XDG_STATE_HOME','npm_config_cache','UV_CACHE_DIR','PIP_CACHE_DIR'].map(k => [k, process.env[k]])) }));`,
  );
  return { policy, policyPath, childPath, outputPath };
}

it("accepts the configured mounted UUID and rejects a missing or replaced volume", async () => {
  const { policy } = await fixture();
  const volume = policy.requiredVolumes[0];
  assert.ok(volume);
  const read = (_tool: string, _args: string[]) => ({
    MountPoint: volume.mountPoint,
    VolumeUUID: "expected-uuid",
    DeviceIdentifier: "disk5s1",
    Internal: false,
  });
  await verifyExternalStoragePolicy(policy, read);
  await assert.rejects(
    verifyExternalStoragePolicy(policy, () => ({
      ...read("", []),
      MountPoint: "/",
    })),
    /missing or has the wrong UUID/u,
  );
  await assert.rejects(
    verifyExternalStoragePolicy(policy, () => ({
      ...read("", []),
      VolumeUUID: "different-uuid",
    })),
    /missing or has the wrong UUID/u,
  );
  await assert.rejects(
    verifyExternalStoragePolicy(policy, read, async (path) =>
      path === policy.tempRoot ? 2 : 1,
    ),
    /different mounted volume/u,
  );
});

it("checks a disk image's physical backing path and UUID", async () => {
  const { policy } = await fixture();
  const physical = policy.requiredVolumes[0];
  assert.ok(physical);
  const root = physical.mountPoint;
  const image = join(root, "image");
  await mkdir(image);
  policy.requiredVolumes = [
    physical,
    {
      mountPoint: image,
      volumeUUID: "image-uuid",
      backing: { mountPoint: root, volumeUUID: "expected-uuid" },
    },
  ];
  const imagePath = join(root, "protected.sparsebundle");
  await writeFile(imagePath, "image fixture");
  const read = (tool: "diskutil" | "hdiutil", args: string[]) =>
    tool === "hdiutil"
      ? {
          images: [
            {
              "image-path": imagePath,
              "system-entities": [{ "dev-entry": "/dev/disk5" }],
            },
          ],
        }
      : {
          MountPoint: args[2],
          VolumeUUID: args[2] === image ? "image-uuid" : "expected-uuid",
          DeviceIdentifier: args[2] === image ? "disk5s1" : "disk2s1",
          Internal: false,
        };
  await verifyExternalStoragePolicy(policy, read);
  await assert.rejects(
    verifyExternalStoragePolicy(policy, (tool, args) =>
      tool === "hdiutil" ? { images: [] } : read(tool, args),
    ),
    /not backed/u,
  );
  await assert.rejects(
    verifyExternalStoragePolicy(policy, (tool, args) =>
      tool === "diskutil" && args[2] === root
        ? { ...read(tool, args), VolumeUUID: "wrong" }
        : read(tool, args),
    ),
    /wrong UUID/u,
  );
  await assert.rejects(
    verifyExternalStoragePolicy(policy, read, async (path) =>
      path === imagePath ? 2 : 1,
    ),
    /not backed/u,
  );
});

it("passes external temp and cache paths to the child, and fails before spawn on guard rejection", async () => {
  const { policy, policyPath, childPath, outputPath } = await fixture();
  const input = {
    policyPath,
    logPath: "/dev/null",
    programArguments: [process.execPath, childPath, policy.configPath],
  };
  await assert.rejects(
    runExternalStorageLaunchdJob(input, async () => {
      throw new Error("missing volume");
    }),
    /missing volume/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(await runExternalStorageLaunchdJob(input, async () => {}), 0);
  const result = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(result.args, [policy.configPath]);
  assert.deepEqual(result.env, {
    TMPDIR: policy.tempRoot,
    TMP: policy.tempRoot,
    TEMP: policy.tempRoot,
    XDG_CACHE_HOME: policy.cacheRoot,
    XDG_STATE_HOME: policy.stateRoot,
    npm_config_cache: join(policy.cacheRoot, "npm"),
    UV_CACHE_DIR: join(policy.cacheRoot, "uv"),
    PIP_CACHE_DIR: join(policy.cacheRoot, "pip"),
  });
});

it("puts the guard before a resident server and keeps launchd streams on /dev/null", {
  skip: process.platform !== "darwin",
}, async () => {
  const { policy, policyPath } = await fixture();
  const installer = fileURLToPath(
    new URL(
      "../../../scripts/install-operations-server-launchd.mjs",
      import.meta.url,
    ),
  );
  const result = spawnSync(
    process.execPath,
    [
      installer,
      "--config",
      policy.configPath,
      "--storage-policy",
      policyPath,
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.match(
    preview.programArguments[1],
    /external-storage-launchd-runner\.js$/u,
  );
  assert.deepEqual(preview.programArguments.slice(2, 4), [
    policyPath,
    join(policy.logRoot, "operations-server.log"),
  ]);
  assert.equal(
    preview.plist.includes(
      "<key>StandardOutPath</key>\n<string>/dev/null</string>",
    ),
    true,
  );
  assert.equal(
    preview.plist.includes(
      "<key>StandardErrorPath</key>\n<string>/dev/null</string>",
    ),
    true,
  );
});

it("refuses a symlinked Operations log after storage validation", async () => {
  const { policy, policyPath, childPath, outputPath } = await fixture();
  const outside = join(dirname(policyPath), "outside-log");
  await writeFile(outside, "untouched");
  await symlink(outside, join(policy.logRoot, "operations-server.log"));
  await assert.rejects(
    runExternalStorageLaunchdJob(
      {
        policyPath,
        logPath: join(policy.logRoot, "operations-server.log"),
        programArguments: [process.execPath, childPath, policy.configPath],
      },
      async () => {},
    ),
    { code: "ELOOP" },
  );
  assert.equal(await readFile(outside, "utf8"), "untouched");
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

it("refuses a symlinked derived cache before starting the child", async () => {
  const { policy, policyPath, childPath, outputPath } = await fixture();
  const outside = join(dirname(policyPath), "outside-cache");
  await mkdir(outside);
  await symlink(outside, join(policy.cacheRoot, "npm"));
  await assert.rejects(
    runExternalStorageLaunchdJob(
      {
        policyPath,
        logPath: "/dev/null",
        programArguments: [process.execPath, childPath, policy.configPath],
      },
      async () => {},
    ),
    /npm cache redirects/u,
  );
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});

it("refuses a hardlinked or FIFO Operations log before child startup", async () => {
  const { policy, policyPath, childPath, outputPath } = await fixture();
  const logPath = join(policy.logRoot, "operations-server.log");
  const outside = join(dirname(policyPath), "outside-log");
  await writeFile(outside, "untouched");
  await link(outside, logPath);
  const input = {
    policyPath,
    logPath,
    programArguments: [process.execPath, childPath, policy.configPath],
  };
  await assert.rejects(
    runExternalStorageLaunchdJob(input, async () => {}),
    /unsafe file identity/u,
  );
  await rm(logPath);
  const fifo = spawnSync("/usr/bin/mkfifo", [logPath]);
  assert.equal(fifo.status, 0);
  await assert.rejects(
    runExternalStorageLaunchdJob(input, async () => {}),
    { code: "ENXIO" },
  );
  assert.equal(await readFile(outside, "utf8"), "untouched");
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
});
