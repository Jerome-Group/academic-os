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
