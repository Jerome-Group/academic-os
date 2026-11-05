import { OperationalError } from "../operational-error.js";
import { resolveStateRoot } from "./resolve-state-root.js";
import type { ResolvedCalendarConfig, ServiceConfig } from "./types.js";

export async function resolveCalendarConfig(
  config: Pick<ServiceConfig, "driveMount" | "stateRoot" | "calendar">,
): Promise<ResolvedCalendarConfig> {
  const stateRoot = await resolveStateRoot(config);
  if (config.calendar === undefined) {
    throw new OperationalError(
      "invalid-config",
      "Calendar configuration and credentials are required.",
    );
  }
  const { scheduledRead, interactiveWrite } = config.calendar.credentials;
  if (scheduledRead === interactiveWrite) {
    throw new OperationalError(
      "invalid-config",
      "Calendar scheduled-read and interactive-write credential paths must be distinct absolute paths.",
    );
  }
  return {
    stateRoot,
    managementHorizon: new Date(
      config.calendar.managementHorizon,
    ).toISOString(),
    credentials: { scheduledRead, interactiveWrite },
  };
}
