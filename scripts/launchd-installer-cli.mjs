import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  launchdJobTarget,
  planLaunchdJob,
  removeLaunchdJob,
} from "../dist/src/launchd/index.js";

// The argument shape every LaunchAgent installer here takes: one config path to install against,
// a preview that installs nothing, and a removal. The plist itself comes from `src/launchd/`; this
// is the command line around it, shared so a new scheduled job is a job description rather than
// another copy of the same parser.

export function parseInstallerArguments(arguments_, usage) {
  let configPath;
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
  if (remove && (dryRun || configPath !== undefined)) {
    throw new Error("--remove cannot be combined with --config or --dry-run.");
  }
  if (!remove && configPath === undefined) {
    throw new Error(usage);
  }
  return { configPath, dryRun, remove };
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
  return {
    dryRun: arguments_.dryRun,
    plan: planLaunchdJob({
      description: await input.describeJob(resolve(arguments_.configPath)),
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
