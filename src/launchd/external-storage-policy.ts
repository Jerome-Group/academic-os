import { spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ExternalVolume {
  mountPoint: string;
  volumeUUID: string;
  backing?: { mountPoint: string; volumeUUID: string };
}

export interface ExternalStoragePolicy {
  schemaVersion: 1;
  configPath: string;
  stateRoot: string;
  tempRoot: string;
  cacheRoot: string;
  logRoot: string;
  requiredVolumes: ExternalVolume[];
}

type Plist = Record<string, unknown>;
type PlistReader = (tool: "diskutil" | "hdiutil", args: string[]) => Plist;

const systemPlistReader: PlistReader = (tool, args) => {
  const command =
    tool === "diskutil" ? "/usr/sbin/diskutil" : "/usr/bin/hdiutil";
  const result = spawnSync(command, args, {
    encoding: "buffer",
    timeout: 10_000,
  });
  if (result.status !== 0 || result.error)
    throw new Error(`${tool} could not inspect required storage.`);
  const converted = spawnSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "--", "-"],
    {
      input: result.stdout,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  if (converted.status !== 0 || converted.error)
    throw new Error(`${tool} returned an unreadable property list.`);
  return JSON.parse(converted.stdout) as Plist;
};

function within(root: string, child: string): boolean {
  const suffix = relative(root, child);
  return (
    suffix === "" ||
    (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Storage policy requires ${name}.`);
  return value;
}

export async function loadExternalStoragePolicy(
  path: string,
): Promise<ExternalStoragePolicy> {
  const value = JSON.parse(
    await readFile(path, "utf8"),
  ) as ExternalStoragePolicy;
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.requiredVolumes) ||
    value.requiredVolumes.length === 0
  )
    throw new Error(
      "Storage policy requires schemaVersion 1 and requiredVolumes.",
    );
  for (const key of [
    "configPath",
    "stateRoot",
    "tempRoot",
    "cacheRoot",
    "logRoot",
  ] as const) {
    if (!isAbsolute(requiredString(value[key], key)))
      throw new Error(`Storage policy ${key} must be absolute.`);
  }
  for (const volume of value.requiredVolumes) {
    if (!isAbsolute(requiredString(volume.mountPoint, "mountPoint")))
      throw new Error("Storage mountPoint must be absolute.");
    requiredString(volume.volumeUUID, "volumeUUID");
    if (volume.backing) {
      if (
        !isAbsolute(
          requiredString(volume.backing.mountPoint, "backing.mountPoint"),
        )
      )
        throw new Error("Backing mountPoint must be absolute.");
      requiredString(volume.backing.volumeUUID, "backing.volumeUUID");
    }
  }
  return value;
}

export async function verifyExternalStoragePolicy(
  policy: ExternalStoragePolicy,
  readPlist: PlistReader = systemPlistReader,
  deviceOf: (path: string) => Promise<number> = async (path) =>
    (await stat(path)).dev,
): Promise<void> {
  const config = JSON.parse(await readFile(policy.configPath, "utf8")) as {
    stateRoot?: unknown;
  };
  if (config.stateRoot !== policy.stateRoot)
    throw new Error(
      "Configured private state root does not match storage policy.",
    );
  const roots = new Map<string, number>();
  const checkVolume = async (
    mountPoint: string,
    volumeUUID: string,
  ): Promise<Plist> => {
    const resolved = await realpath(mountPoint);
    if (resolved !== mountPoint)
      throw new Error(`Required mount is redirected: ${mountPoint}`);
    const info = readPlist("diskutil", ["info", "-plist", mountPoint]);
    if (info.MountPoint !== mountPoint || info.VolumeUUID !== volumeUUID)
      throw new Error(
        `Required volume is missing or has the wrong UUID: ${mountPoint}`,
      );
    if (info.Internal !== false)
      throw new Error(
        `Required volume is not verified external: ${mountPoint}`,
      );
    return info;
  };
  for (const volume of policy.requiredVolumes) {
    const info = await checkVolume(volume.mountPoint, volume.volumeUUID);
    roots.set(volume.mountPoint, await deviceOf(volume.mountPoint));
    if (volume.backing) {
      await checkVolume(volume.backing.mountPoint, volume.backing.volumeUUID);
      const images = readPlist("hdiutil", ["info", "-plist"]).images;
      const device = requiredString(info.DeviceIdentifier, "DeviceIdentifier");
      const image = Array.isArray(images)
        ? (images.find((entry) => {
            if (typeof entry !== "object" || entry === null) return false;
            const entities = (entry as Plist)["system-entities"];
            return (
              Array.isArray(entities) &&
              entities.some((entity) => {
                const dev = (entity as Plist)["dev-entry"];
                return (
                  typeof dev === "string" &&
                  (device === dev.replace(/^\/dev\//u, "") ||
                    device.startsWith(`${dev.replace(/^\/dev\//u, "")}s`))
                );
              })
            );
          }) as Plist | undefined)
        : undefined;
      const imagePath = image?.["image-path"];
      if (
        typeof imagePath !== "string" ||
        !within(volume.backing.mountPoint, await realpath(imagePath)) ||
        (await deviceOf(imagePath)) !==
          (await deviceOf(volume.backing.mountPoint))
      )
        throw new Error(
          `Disk image is not backed by the required volume: ${volume.mountPoint}`,
        );
    }
  }
  for (const key of [
    "configPath",
    "stateRoot",
    "tempRoot",
    "cacheRoot",
    "logRoot",
  ] as const) {
    const path = policy[key];
    const owner = Array.from(roots.entries())
      .filter(([root]) => within(root, path))
      .sort(([left], [right]) => right.length - left.length)[0];
    if (owner === undefined)
      throw new Error(`Storage policy ${key} is outside required volumes.`);
    const actual = await realpath(path);
    if (actual !== resolve(path) || !within(owner[0], actual))
      throw new Error(
        `Storage policy ${key} redirects outside required volumes.`,
      );
    const metadata = await stat(actual);
    if (key === "configPath" ? !metadata.isFile() : !metadata.isDirectory())
      throw new Error(`Storage policy ${key} has the wrong file type.`);
    if ((await deviceOf(actual)) !== owner[1])
      throw new Error(
        `Storage policy ${key} is on a different mounted volume.`,
      );
  }
}
