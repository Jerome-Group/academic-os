import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  launchdJobTarget,
  planLaunchdJob,
  removeLaunchdJob,
} from "../dist/src/launchd/index.js";
import {
  loadExternalStoragePolicy,
  verifyExternalStoragePolicy,
} from "../dist/src/launchd/external-storage-policy.js";

const storageRunner = fileURLToPath(
  new URL(
    "../dist/src/launchd/external-storage-launchd-runner.js",
    import.meta.url,
  ),
);

// The argument shape every LaunchAgent installer here takes: one config path to install against,
// a preview that installs nothing, and a removal. The plist itself comes from `src/launchd/`; this
// is the command line around it, shared so a new scheduled job is a job description rather than
// another copy of the same parser.

export function parseInstallerArguments(arguments_, usage) {
  let configPath;
  let storagePolicyPath;
  let dryRun = false;
  let remove = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config") {
      const value = arguments_[index + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        configPath !== undefined
      ) {
        throw new Error(usage);
      }
      configPath = value;
      index += 1;
    } else if (argument === "--storage-policy") {
      const value = arguments_[index + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        storagePolicyPath !== undefined
      )
        throw new Error(usage);
      storagePolicyPath = value;
      index += 1;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--remove") {
      remove = true;
    } else if (argument === "--help") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unexpected argument: ${argument}.\n${usage}`);
    }
  }
  if (
    remove &&
    (dryRun || configPath !== undefined || storagePolicyPath !== undefined)
  ) {
    throw new Error(
      "--remove cannot be combined with --config, --storage-policy or --dry-run.",
    );
  }
  if (!remove && configPath === undefined) {
    throw new Error(usage);
  }
  return { configPath, storagePolicyPath, dryRun, remove };
}

export function requireLaunchdUid(surface) {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error(`${surface} scheduling requires a macOS user session.`);
  }
  return uid;
}

// Every installer takes the same two paths through this: a removal that needs only the job's name,
// or a plan built from the job's own description. What each one then prints — a resident server and
// a silent daily job owe the operator different sentences — stays with the installer.
export async function planOrRemoveLaunchdJob(input) {
  const arguments_ = parseInstallerArguments(
    process.argv.slice(2),
    input.usage,
  );
  const homeDirectory = homedir();
  const uid = requireLaunchdUid(input.surface);
  if (arguments_.remove) {
    const target = launchdJobTarget({
      name: input.jobName,
      homeDirectory,
      uid,
    });
    await removeLaunchdJob(target);
    return { removed: target };
  }
  const configPath = resolve(arguments_.configPath);
  const description = await input.describeJob(configPath);
  let policy;
  let plannedDescription = description;
  if (arguments_.storagePolicyPath !== undefined) {
    const storagePolicyPath = resolve(arguments_.storagePolicyPath);
    policy = await loadExternalStoragePolicy(storagePolicyPath);
    if (policy.configPath !== configPath)
      throw new Error("Storage policy configPath must match --config.");
    if (!arguments_.dryRun) await verifyExternalStoragePolicy(policy);
    plannedDescription = {
      ...description,
      programArguments: [
        description.programArguments[0],
        storageRunner,
        storagePolicyPath,
        description.name === "operations-server"
          ? join(policy.logRoot, "operations-server.log")
          : "/dev/null",
        ...description.programArguments,
      ],
      standardOutPath: "/dev/null",
      standardErrorPath: "/dev/null",
    };
  }
  return {
    dryRun: arguments_.dryRun,
    policy,
    plan: planLaunchdJob({
      description: plannedDescription,
      hostTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      homeDirectory,
      uid,
    }),
  };
}

export function writeLaunchdJobPreview(command, plan, shape) {
  process.stdout.write(
    `${JSON.stringify(
      {
        command,
        outcome: "preview",
        label: plan.label,
        ...shape,
        plistPath: plan.plistPath,
        programArguments: plan.programArguments,
        plist: plan.plist,
      },
      null,
      2,
    )}\n`,
  );
}

export function formatDailyTime(schedule) {
  const hour = String(schedule.hour).padStart(2, "0");
  const minute = String(schedule.minute).padStart(2, "0");
  return `${hour}:${minute} ${schedule.timeZone}`;
}
