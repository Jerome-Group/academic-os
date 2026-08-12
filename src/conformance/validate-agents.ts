import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import { moduleDomainLanguageInstructions } from "../contract/module-domain-language.js";
import { escapeRegex, sectionBody } from "./markdown-control-helpers.js";
import type { Finding } from "./types.js";

const agentsPath = moduleControlPaths.agents;
const agentSections = [
  "What this folder is",
  "Start here",
  "Routes",
  "Domain language",
  "Safety",
  "Updating these instructions",
];
const routes = [
  "Learning",
  "Tutorials",
  "Curation",
  "Assessments",
  "Projects/Labs",
  "Maintenance",
];

export function validateAgents(source: string | undefined): Finding {
  if (source === undefined) {
    return failedControl("MF-AGENTS-001", agentsPath, [
      `No readable control exists at ${agentsPath}.`,
    ]);
  }
  const headings = source
    .split(/\r?\n/)
    .flatMap((line) =>
      line.startsWith("# ")
        ? [line.slice(2)]
        : line.startsWith("## ")
          ? [line.slice(3)]
          : [],
    );
  const problems =
    headings.length === agentSections.length &&
    headings.every((heading, index) => heading === agentSections[index])
      ? []
      : [
          `Section headings are ${JSON.stringify(headings)}; expected ${JSON.stringify(agentSections)}.`,
        ];
  const routeBody = sectionBody(source, "Routes");
  for (const route of routes) {
    const routePattern = `(?:^|\\n)- ${escapeRegex(route)}: \`[^\`]+\``;
    if (!new RegExp(routePattern, "u").test(routeBody)) {
      problems.push(`${route} route has no backticked context pointer.`);
    }
  }
  const domainLanguage = sectionBody(source, "Domain language");
  if (domainLanguage.trim() !== moduleDomainLanguageInstructions) {
    problems.push(
      "Domain language does not exactly match the canonical module-domain routing instruction.",
    );
  }
  for (const term of ["git", "github", "pull request", "coding standard"]) {
    if (source.toLowerCase().includes(term)) {
      problems.push(
        `Instructions contain prohibited repository-workflow term ${JSON.stringify(term)}.`,
      );
    }
  }
  return problems.length === 0
    ? controlFinding(
        "MF-AGENTS-001",
        agentsPath,
        "pass",
        "AGENTS.md has the six local sections, all six route pointers, and both domain-documentation pointers.",
        "Module instructions are a concise local router.",
      )
    : failedControl("MF-AGENTS-001", agentsPath, problems);
}
