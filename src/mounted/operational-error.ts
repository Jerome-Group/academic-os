export type OperationalErrorCode =
  | "ambiguous-target"
  | "case-variant-target"
  | "invalid-arguments"
  | "invalid-config"
  | "invalid-target"
  | "missing-semester-root"
  | "missing-target"
  | "operational-failure"
  | "out-of-root"
  | "symlink-target"
  | "unsafe-state-root"
  | "unresolved-placeholder"
  | "unsafe-inventory";

export class OperationalError extends Error {
  constructor(
    readonly code: OperationalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OperationalError";
  }
}
