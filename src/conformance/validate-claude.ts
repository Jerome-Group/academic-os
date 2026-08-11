import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";

const claudePath = moduleControlPaths.claude;

export function validateClaude(source: string | undefined): Finding {
  const expected =
    "# Claude Code\n\nRead `AGENTS.md` completely before working in this module folder.\n";
  if (source === expected) {
    return controlFinding(
      "MF-AGENTS-002",
      claudePath,
      "pass",
      "CLAUDE.md exactly contains the canonical AGENTS.md pointer.",
      "Claude instructions have no independent rule copy.",
    );
  }
  return failedControl("MF-AGENTS-002", claudePath, [
    source === undefined
      ? `No readable control exists at ${claudePath}.`
      : `CLAUDE.md content is ${JSON.stringify(source)}; expected ${JSON.stringify(expected)}.`,
  ]);
}
