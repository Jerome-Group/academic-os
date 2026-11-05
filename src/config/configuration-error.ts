import { OperationalError } from "../operational-error.js";

export interface ConfigurationDiagnostic {
  code:
    | "unreadable-config"
    | "invalid-json"
    | "unsupported-config-version"
    | "conflicting-config-shapes"
    | "invalid-config-value";
  pointer: string;
  expected: string;
  remediation: string;
}

export class ConfigurationError extends OperationalError {
  constructor(readonly diagnostics: readonly ConfigurationDiagnostic[]) {
    super(
      "invalid-config",
      diagnostics
        .map(
          ({ pointer, expected, remediation }) =>
            `Configuration ${pointer || "/"} requires ${expected}. ${remediation}`,
        )
        .join(" "),
    );
    this.name = "ConfigurationError";
  }
}
