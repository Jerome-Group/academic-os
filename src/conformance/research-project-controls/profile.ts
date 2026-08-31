import type { ResolvedResearchProject } from "../../config/index.js";
import { readControlDocument } from "../control-document.js";
import { researchProjectControlPaths } from "../research-project-control-paths.js";
import type { ResearchFinding } from "../research-types.js";
import { isRecord, nonEmptyString } from "../value-shape.js";
import { researchControlFinding } from "./shared.js";

const evidenceKinds = ["official-source", "owner-supplied", "unresolved"];

const profileSections = [
  ["## Identity", ["Field", "Value", "Evidence"]],
  ["## Purpose and Questions"],
  ["## Programme"],
  ["## Supervision", ["Field", "Value", "Evidence"]],
  ["## Deliverables", ["Deliverable", "Requirement", "Evidence"]],
  ["## Source Authority", ["Rank", "Source", "Role", "Governs", "Evidence"]],
  ["## Workspaces", ["Workspace", "Purpose", "Pointer"]],
  ["## Known Gaps", ["Gap", "Consequence", "Next evidence"]],
] as const;

const identityFields = [
  ["Project key", "key"],
  ["Folder", "folder"],
  ["Title", "title"],
  ["Status", "status"],
  ["Programme profile", "profile"],
] as const;

interface DefinitionIdentity {
  key: string;
  folder: string;
  title: string;
  status: string;
  profile: string;
}

export function validateResearchProjectProfile(input: {
  source: string | undefined;
  definition: string | undefined;
  target: ResolvedResearchProject;
}): ResearchFinding[] {
  const definition = readDefinition(input.definition);
  const title = definition?.title;
  const expectedHeadings = [
    `# ${input.target.folder} — ${title ?? "Project Title"}`,
    ...profileSections.map(([heading]) => heading),
  ];
  const headings = input.source?.match(/^#{1,2} .+$/gmu) ?? [];
  const tableProblems = profileSections.flatMap(([heading, headers]) =>
    headers === undefined
      ? []
      : tableShapeProblems(input.source, heading, headers),
  );
  const shapeProblems = [
    ...(JSON.stringify(headings) === JSON.stringify(expectedHeadings)
      ? []
      : [
          `Profile headings are ${JSON.stringify(headings)}; expected ${JSON.stringify(expectedHeadings)}.`,
        ]),
    ...tableProblems,
  ];
  const identityProblems = profileIdentityProblems(input.source, definition);
  return [
    researchControlFinding(
      "RP-PROFILE-001",
      shapeProblems,
      researchProjectControlPaths.profile,
      "Profile uses the exact heading order and table interfaces.",
      "Profile shape applies to every Research project.",
    ),
    researchControlFinding(
      "RP-PROFILE-003",
      identityProblems,
      researchProjectControlPaths.profile,
      "Profile identity rows agree with the Definition and configured target.",
      "Profile, Definition and configured identity must agree.",
    ),
  ];
}

function profileIdentityProblems(
  source: string | undefined,
  definition: DefinitionIdentity | undefined,
): string[] {
  if (definition === undefined) {
    return ["Profile identity cannot be compared with an invalid Definition."];
  }
  const table = markdownTable(source, "## Identity");
  if (table === undefined) return ["Identity table is missing or malformed."];
  const rows = new Map(table.rows.map(([field, ...cells]) => [field, cells]));
  const expected = definition;
  const labels = table.rows.map(([field]) => field);
  const expectedLabels = identityFields.map(([label]) => label);
  const problems =
    JSON.stringify(labels) === JSON.stringify(expectedLabels)
      ? []
      : [
          `Identity row labels are ${JSON.stringify(labels)}; expected ${JSON.stringify(expectedLabels)}.`,
        ];
  for (const [label, property] of identityFields) {
    const matches = table.rows.filter(([field]) => field === label);
    if (matches.length !== 1) {
      problems.push(`Identity requires exactly one ${label} row.`);
      continue;
    }
    const [value, evidence] = rows.get(label) ?? [];
    if (value !== expected[property]) {
      problems.push(
        `Identity ${label} is ${JSON.stringify(value)}; expected ${JSON.stringify(expected[property])}.`,
      );
    }
    if (
      !nonEmptyString(evidence) ||
      !evidenceKinds.some((kind) => evidence.includes(kind))
    ) {
      problems.push(
        `Identity ${label} Evidence must identify official-source, owner-supplied, or unresolved.`,
      );
    }
  }
  return problems;
}

function readDefinition(
  source: string | undefined,
): DefinitionIdentity | undefined {
  if (source === undefined) return undefined;
  const parsed = readControlDocument(source);
  if (
    "problems" in parsed ||
    !isRecord(parsed.value) ||
    !isRecord(parsed.value.project) ||
    !nonEmptyString(parsed.value.project.key) ||
    !nonEmptyString(parsed.value.project.folder) ||
    !nonEmptyString(parsed.value.project.title) ||
    !nonEmptyString(parsed.value.project.status) ||
    !nonEmptyString(parsed.value.profile)
  ) {
    return undefined;
  }
  return {
    key: parsed.value.project.key,
    folder: parsed.value.project.folder,
    title: parsed.value.project.title,
    status: parsed.value.project.status,
    profile: parsed.value.profile,
  };
}

function tableShapeProblems(
  source: string | undefined,
  heading: string,
  headers: readonly string[],
): string[] {
  const table = markdownTable(source, heading);
  if (table === undefined) return [`${heading} requires a Markdown table.`];
  return JSON.stringify(table.headers) === JSON.stringify(headers)
    ? []
    : [
        `${heading} table headers are ${JSON.stringify(table.headers)}; expected ${JSON.stringify(headers)}.`,
      ];
}

function markdownTable(
  source: string | undefined,
  heading: string,
): { headers: string[]; rows: string[][] } | undefined {
  if (source === undefined) return undefined;
  const lines = source.split(/\r?\n/u);
  const headingIndex = lines.indexOf(heading);
  if (headingIndex < 0) return undefined;
  const section = lines.slice(headingIndex + 1);
  const nextHeading = section.findIndex((line) => /^#{1,2} /u.test(line));
  const body = nextHeading < 0 ? section : section.slice(0, nextHeading);
  const headerIndex = body.findIndex(
    (line) => parseTableRow(line) !== undefined,
  );
  if (headerIndex < 0) return undefined;
  const headers = parseTableRow(body[headerIndex] ?? "");
  const divider = parseTableRow(body[headerIndex + 1] ?? "");
  if (
    headers === undefined ||
    divider === undefined ||
    divider.length !== headers.length ||
    divider.some((cell) => !/^:?-{3,}:?$/u.test(cell))
  ) {
    return undefined;
  }
  const rows: string[][] = [];
  for (const line of body.slice(headerIndex + 2)) {
    const row = parseTableRow(line);
    if (row === undefined) {
      if (line.trim() !== "") break;
      continue;
    }
    if (row.length !== headers.length) return undefined;
    rows.push(row);
  }
  return { headers, rows };
}

function parseTableRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replace(/^`|`$/gu, ""));
}
