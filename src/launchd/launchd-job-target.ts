import { join } from "node:path";

import type { LaunchdJobTarget } from "./types.js";

const LAUNCHD_LABEL_PREFIX = "com.jerome-group.academic-os";

const JOB_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

export function launchdJobTarget(input: {
  name: string;
  homeDirectory: string;
  uid: number;
}): LaunchdJobTarget {
  if (!JOB_NAME_PATTERN.test(input.name)) {
    throw new Error(
      `A LaunchAgent job name must be one kebab-case label segment; received "${input.name}".`,
    );
  }
  const label = `${LAUNCHD_LABEL_PREFIX}.${input.name}`;
  return {
    label,
    plistPath: join(
      input.homeDirectory,
      "Library",
      "LaunchAgents",
      `${label}.plist`,
    ),
    domainTarget: `gui/${input.uid}`,
    serviceTarget: `gui/${input.uid}/${label}`,
  };
}
