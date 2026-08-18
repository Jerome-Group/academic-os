import { OperationalError } from "../operational-error.js";

// A Tasks command reports a failure as a row in its report rather than as a thrown error, so the
// modules that succeeded stay readable beside the one that did not.
export function taskFailure(
  error: unknown,
  fallbackMessage: string,
): { code: string; message: string } {
  const operationalError =
    error instanceof OperationalError
      ? error
      : new OperationalError("operational-failure", fallbackMessage);
  return { code: operationalError.code, message: operationalError.message };
}
