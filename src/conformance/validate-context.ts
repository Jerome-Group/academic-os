import { controlFinding, failedControl } from "./control-finding.js";
import { writtenControlPaths } from "./control-paths.js";
import type { Finding } from "./types.js";
import type { ValidatedDefinition } from "./validate-definition.js";

const contextPath = writtenControlPaths.context;

export function validateContext(
  source: string | undefined,
  definition: ValidatedDefinition | undefined,
): Finding {
  if (source === undefined) {
    return failedControl("MF-CONTEXT-001", contextPath, [
      `No readable control exists at ${contextPath}.`,
    ]);
  }
  const lines = source.split(/\r?\n/);
  const problems: string[] = [];
  if (!/^# [A-Z]{2,4}\d{4}[A-Z]? — \S.+$/u.test(lines[0] ?? "")) {
    problems.push(
      `Context heading is ${JSON.stringify(lines[0])}; expected # MODULE_CODE — Module Title.`,
    );
  }
  const expectedHeading =
    definition === undefined
      ? undefined
      : `# ${definition.code} — ${definition.title}`;
  if (expectedHeading !== undefined && lines[0] !== expectedHeading) {
    problems.push(
      `Context heading is ${JSON.stringify(lines[0])}; Definition requires ${JSON.stringify(expectedHeading)}.`,
    );
  }
  const headings = lines.filter((line) => /^#{1,6} /.test(line));
  if (
    headings.length !== 2 ||
    !headings[0]?.startsWith("# ") ||
    headings[1] !== "## Language"
  ) {
    problems.push(
      `Context headings are ${JSON.stringify(headings)}; expected a module heading followed by ## Language.`,
    );
  }
  const languageIndex = lines.indexOf("## Language");
  const purpose = lines.slice(1, languageIndex).join("\n").trim();
  if (languageIndex < 0 || purpose === "") {
    problems.push("Context has no purpose before ## Language.");
  }
  return problems.length === 0
    ? controlFinding(
        "MF-CONTEXT-001",
        contextPath,
        "pass",
        "CONTEXT.md contains the module heading, purpose, and sole ## Language section.",
        "The minimum module-domain context is present without non-glossary sections.",
      )
    : failedControl("MF-CONTEXT-001", contextPath, problems);
}
