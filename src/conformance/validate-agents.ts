import { controlFinding, failedControl } from "./control-finding.js";
import { pinnedDocumentPaths } from "../contract/pinned-documents.js";
import { escapeRegex, sectionBody } from "./markdown-control-helpers.js";
import type { Finding } from "./types.js";

const agentsPath = pinnedDocumentPaths.agents;
const agentSections = [
  "What this folder is",
  "Start here",
  "Routes",
  "Domain language",
  "Safety",
  "Updating these instructions",
];
const routes = [
  "Curation",
  "Teaching",
  "Tutorials",
  "Textbooks",
  "Tasks",
  "Assessments",
  "Projects/Labs",
  "Maintenance",
];
const domainLanguagePointers = ["CONTEXT.md", "docs/adr/"];
const repositoryWorkflowTerms = ["git", "pull request", "coding standard"];

export function validateAgents(source: string | undefined): Finding {
  if (source === undefined) {
    return failedControl("MF-AGENTS-001", agentsPath, [
      `No readable control exists at ${agentsPath}.`,
    ]);
  }
  const problems = [
    ...sectionProblems(source),
    ...routeProblems(sectionBody(source, "Routes")),
    ...domainLanguageProblems(sectionBody(source, "Domain language")),
    ...repositoryWorkflowProblems(source),
  ];
  return problems.length === 0
    ? controlFinding(
        "MF-AGENTS-001",
        agentsPath,
        "pass",
        "AGENTS.md has the six local sections, all eight route pointers, and both domain-documentation pointers.",
        "Module instructions are a concise local router.",
      )
    : failedControl("MF-AGENTS-001", agentsPath, problems);
}

function sectionProblems(source: string): string[] {
  const headings = source
    .split(/\r?\n/)
    .flatMap((line) =>
      line.startsWith("# ")
        ? [line.slice(2)]
        : line.startsWith("## ")
          ? [line.slice(3)]
          : [],
    );
  return headings.length === agentSections.length &&
    headings.every((heading, index) => heading === agentSections[index])
    ? []
    : [
        `Section headings are ${JSON.stringify(headings)}; expected ${JSON.stringify(agentSections)}.`,
      ];
}

function routeProblems(routeBody: string): string[] {
  const bullets = routeBody.split(/(?:^|\r?\n)- /u).slice(1);
  return routes.flatMap((route) => {
    const bullet = bullets.find((candidate) =>
      candidate.startsWith(`**${route}**`),
    );
    if (bullet === undefined) return [`${route} has no route bullet.`];
    return /`[^`]+`/u.test(bullet)
      ? []
      : [`${route} route has no backticked context pointer.`];
  });
}

function domainLanguageProblems(domainLanguage: string): string[] {
  return domainLanguagePointers.flatMap((pointer) =>
    domainLanguage.includes(`\`${pointer}\``)
      ? []
      : [`Domain language has no \`${pointer}\` pointer.`],
  );
}

// Opening boundary only: it must reach `github` and `gitignore` while leaving `digits` alone.
function repositoryWorkflowProblems(source: string): string[] {
  return repositoryWorkflowTerms.flatMap((term) =>
    new RegExp(`\\b${escapeRegex(term)}`, "iu").test(source)
      ? [
          `Instructions contain prohibited repository-workflow term ${JSON.stringify(term)}.`,
        ]
      : [],
  );
}
