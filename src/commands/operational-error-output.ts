import { OperationalError } from "../mounted/index.js";

export function writeOperationalError(error: unknown, json: boolean): void {
  const operationalError =
    error instanceof OperationalError
      ? error
      : new OperationalError(
          "operational-failure",
          "Command failed unexpectedly.",
        );
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          outcome: "operational-failure",
          error: {
            code: operationalError.code,
            message: operationalError.message,
            ...operationalError.details,
          },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(
      `Operational failure [${operationalError.code}]: ${operationalError.message}\n`,
    );
  }
  process.exitCode = 2;
}
