import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type { ResearchFinding } from "../research-types.js";
import { researchControlFinding } from "./shared.js";

export const claimStatuses = [
  "candidate",
  "checked",
  "refuted",
  "superseded",
] as const;
const questionStatuses = ["open", "parked", "settled"] as const;

export interface MarkdownLedgerRead {
  keys: Set<string>;
  count: number;
  problems: string[];
}

export function validateResearchProjectClaims(
  source: string | undefined,
): ResearchFinding {
  return validateMarkdownLedger(
    source,
    "Claims",
    claimStatuses,
    researchProjectControlPaths.claims,
  );
}

export function validateResearchProjectQuestions(
  source: string | undefined,
): ResearchFinding {
  return validateMarkdownLedger(
    source,
    "Questions",
    questionStatuses,
    researchProjectControlPaths.questions,
  );
}

export function readMarkdownLedger(
  source: string | undefined,
  title: "Claims" | "Questions",
  statuses: readonly string[],
): MarkdownLedgerRead {
  if (source === undefined) {
    return {
      keys: new Set(),
      count: 0,
      problems: [`No readable ${title} ledger exists.`],
    };
  }
  const lines = markdownLinesOutsideFences(source);
  const problems: string[] = [];
  if (lines[0] !== `# ${title}`) {
    problems.push(`${title} must start with # ${title}.`);
  }
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith("## "));
  const keys = new Set<string>();
  for (const [position, heading] of headings.entries()) {
    const match = /^## ([a-z0-9]+(?:-[a-z0-9]+)*) — (\S.*)$/u.exec(
      heading.line,
    );
    if (match === null) {
      problems.push(
        `${title} entry ${position + 1} heading must be ## stable-key — Short label.`,
      );
      continue;
    }
    const key = match[1] ?? "";
    if (keys.has(key)) {
      problems.push(`${title} repeats key ${key}.`);
    }
    keys.add(key);
    const nextIndex = headings[position + 1]?.index ?? lines.length;
    const statusLines = lines
      .slice(heading.index + 1, nextIndex)
      .flatMap((line) => {
        const status = /^- Status: `?([^`]+)`?$/u.exec(line)?.[1];
        return status === undefined ? [] : [status];
      });
    if (statusLines.length !== 1) {
      problems.push(
        `${title} ${key} requires exactly one - Status: value line.`,
      );
    } else if (!statuses.includes(statusLines[0] ?? "")) {
      problems.push(`${title} ${key} status must be ${statuses.join(", ")}.`);
    }
  }
  return { keys, count: headings.length, problems };
}

function validateMarkdownLedger(
  source: string | undefined,
  title: "Claims" | "Questions",
  statuses: readonly string[],
  path: string,
): ResearchFinding {
  const parsed = readMarkdownLedger(source, title, statuses);
  return researchControlFinding(
    "RP-RESEARCH-001",
    parsed.problems,
    path,
    `${title} declares ${parsed.count.toString()} stable, typed entr${parsed.count === 1 ? "y" : "ies"}.`,
    `${title} entries expose stable keys and closed statuses for durable cross-references.`,
  );
}

function markdownLinesOutsideFences(source: string): string[] {
  const visible: string[] = [];
  let fence: "```" | "~~~" | undefined;
  for (const line of source.split(/\r?\n/u)) {
    const marker = /^(?:\s*)(```|~~~)/u.exec(line)?.[1] as
      | "```"
      | "~~~"
      | undefined;
    if (marker !== undefined) {
      fence =
        fence === undefined ? marker : fence === marker ? undefined : fence;
      continue;
    }
    if (fence === undefined) visible.push(line);
  }
  return visible;
}
