import { OperationalError } from "../mounted/index.js";
import type { OperationsConfig } from "./types.js";

// The Operations server is reached at a MagicDNS name and a port, and the port is the only half a
// machine cannot guess — so it is configurable, and its default is what the machine-setup doc
// tells a second machine to register.
export const DEFAULT_OPERATIONS_PORT = 8765;

const FIRST_UNPRIVILEGED_PORT = 1024;
const LAST_PORT = 65535;

export function resolveOperationsConfig(config: {
  operations?: unknown;
}): OperationsConfig {
  const operations = config.operations;
  if (operations === undefined) return { port: DEFAULT_OPERATIONS_PORT };
  if (typeof operations !== "object" || operations === null) {
    throw new OperationalError(
      "invalid-config",
      "Operations configuration must be an object.",
    );
  }
  const { port } = operations as { port?: unknown };
  if (port === undefined) return { port: DEFAULT_OPERATIONS_PORT };
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < FIRST_UNPRIVILEGED_PORT ||
    port > LAST_PORT
  ) {
    throw new OperationalError(
      "invalid-config",
      `The Operations server port must be an integer between ${FIRST_UNPRIVILEGED_PORT} and ${LAST_PORT}.`,
    );
  }
  return { port };
}
