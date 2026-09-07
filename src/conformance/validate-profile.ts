import { controlFinding, failedControl } from "./control-finding.js";
import { writtenControlPaths } from "./control-paths.js";
import {
  firstDirectTableRows,
  namedRowsForTable,
  renderColumns,
  sectionBody,
  validateHeadingSubsequence,
} from "./markdown-control-helpers.js";
import type { Finding } from "./types.js";
import type { ValidatedDefinition } from "./validate-definition.js";

const profilePath = writtenControlPaths.profile;
const profileSections = [
  "Offering",
  "Scope",
  "Teaching Structure",
  "Assessment Structure",
  "Source Authority",
  "Workspaces",
  "Known Gaps",
];
const fixedProfileTables = new Map([
  ["Offering", ["Field", "Value", "Evidence"]],
  ["Workspaces", ["Workspace", "Purpose", "Pointer"]],
  ["Known Gaps", ["Gap", "Consequence", "Next evidence"]],
]);

export function validateProfile(
  source: string | undefined,
  definition: ValidatedDefinition | undefined,
): Finding[] {
  if (source === undefined) {
    return [
      failedControl("MF-PROFILE-001", profilePath, [
        `No readable control exists at ${profilePath}.`,
      ]),
    ];
  }
  const problems = validateProfileShape(source);
  const findings = [
    problems.length === 0
      ? controlFinding(
          "MF-PROFILE-001",
          profilePath,
          "pass",
          "Profile title, headings, and required tables match the current contract version.",
          "The Profile has the locked structure and allows prose in its prose sections.",
        )
      : failedControl("MF-PROFILE-001", profilePath, problems),
    validateProfileEvidence(source),
  ];
  if (definition !== undefined && problems.length === 0) {
    findings.push(validateProfileAgreement(source, definition));
  }
  return findings;
}

function validateProfileEvidence(source: string): Finding {
  const problems = [
    ...evidenceTableProblems(source),
    ...explicitUnknownProblems(source),
  ];
  return problems.length === 0
    ? controlFinding(
        "MF-PROFILE-002",
        profilePath,
        "pass",
        "Profile facts cite evidence and unsupported details use explicit unknowns.",
        "Human-facing claims remain evidence-bearing without invented certainty.",
      )
    : controlFinding(
        "MF-PROFILE-002",
        profilePath,
        "requires-decision",
        problems.join(" "),
        "Profile claims need evidence or an explicit unknown before they can be trusted.",
      );
}

function evidenceTableProblems(source: string): string[] {
  return ["Offering", "Assessment Structure", "Source Authority"].flatMap(
    (section) => {
      const rows = firstDirectTableRows(sectionBody(source, section));
      const header = rows[0] ?? [];
      const provenanceIndex = header.findIndex((column) =>
        section === "Source Authority"
          ? column === "Evidence" || column === "Checked"
          : column === "Evidence",
      );
      if (provenanceIndex === -1) return [];
      return rows
        .slice(2)
        .filter((row) => row.length === header.length)
        .flatMap((row) => {
          const subject =
            row[0] === "" || row[0] === undefined ? "row" : row[0];
          const evidence = row[provenanceIndex]?.trim() ?? "";
          return evidence === ""
            ? [`${section} ${JSON.stringify(subject)} has no evidence.`]
            : [];
        });
    },
  );
}

function explicitUnknownProblems(source: string): string[] {
  const ambiguous = /^(?:n\/?a|tbc|tbd|\?)$/iu;
  return [
    ...fixedProfileTables.keys(),
    "Assessment Structure",
    "Source Authority",
  ].flatMap((section) =>
    firstDirectTableRows(sectionBody(source, section))
      .slice(2)
      .flatMap((row, rowIndex) =>
        row.flatMap((cell, columnIndex) =>
          cell.trim() === "" || ambiguous.test(cell.trim())
            ? [
                `${section} row ${rowIndex + 1}, column ${columnIndex + 1} uses ${JSON.stringify(cell)}; write unknown explicitly.`,
              ]
            : [],
        ),
      ),
  );
}

function validateProfileShape(source: string): string[] {
  const problems = validateHeadingSubsequence(source, profileSections);
  const title = source.split(/\r?\n/, 1)[0] ?? "";
  if (!/^# [A-Z]{2,4}\d{4}[A-Z]? — \S.+$/u.test(title)) {
    problems.push(
      `Profile title is ${JSON.stringify(title)}; expected # MODULE_CODE — Module Title.`,
    );
  }
  for (const [section, columns] of fixedProfileTables) {
    validateFixedTable(
      sectionBody(source, section),
      section,
      columns,
      problems,
    );
  }
  validateAssessmentTable(
    sectionBody(source, "Assessment Structure"),
    problems,
  );
  validateSourceAuthorityTable(
    sectionBody(source, "Source Authority"),
    problems,
  );
  for (const section of ["Scope", "Teaching Structure"]) {
    if (sectionBody(source, section).trim() === "") {
      problems.push(`${section} has no prose or bullets.`);
    }
  }
  return problems;
}

function validateFixedTable(
  body: string,
  section: string,
  columns: string[],
  problems: string[],
): void {
  const rows = firstDirectTableRows(body);
  const header = rows[0];
  if (
    header === undefined ||
    header.length !== columns.length ||
    header.some((column, index) => column !== columns[index])
  ) {
    problems.push(
      `${section} table columns are ${renderColumns(header)}; expected ${columns.join(" | ")}.`,
    );
  }
  validateFullWidthRows(rows, section, problems, columns.length);
}

function validateAssessmentTable(body: string, problems: string[]): void {
  const rows = firstDirectTableRows(body);
  const header = rows[0] ?? [];
  const timing = header.filter((column) =>
    /^Timing(?:\b| and )/iu.test(column),
  );
  const required = ["Component", "Weight", "Evidence"];
  if (
    required.some((column) => !header.includes(column)) ||
    header[0] !== "Component" ||
    header[1] !== "Weight" ||
    timing.length !== 1 ||
    header.some((column) => column === "") ||
    new Set(header).size !== header.length ||
    header.at(-1) !== "Evidence"
  ) {
    problems.push(
      `Assessment Structure table columns are ${renderColumns(rows[0])}; require unique Component, Weight, one Timing column, optional detail columns, and final Evidence.`,
    );
  }
  validateFullWidthRows(rows, "Assessment Structure", problems);
}

function validateSourceAuthorityTable(body: string, problems: string[]): void {
  const rows = firstDirectTableRows(body);
  const header = rows[0] ?? [];
  const required = ["Rank", "Source", "Role", "Governs"];
  const provenance = header.at(-1);
  if (
    header.slice(0, 4).some((column, index) => column !== required[index]) ||
    !["Evidence", "Checked"].includes(provenance ?? "") ||
    header.length !== 5
  ) {
    problems.push(
      `Source Authority table columns are ${renderColumns(rows[0])}; expected Rank | Source | Role | Governs | Evidence or Checked.`,
    );
  }
  validateFullWidthRows(rows, "Source Authority", problems);
}

function validateFullWidthRows(
  rows: string[][],
  section: string,
  problems: string[],
  width = rows[0]?.length ?? 0,
): void {
  if (
    rows.length < 3 ||
    width === 0 ||
    rows[1]?.length !== width ||
    !rows[1].every((cell) => /^:?-{3,}:?$/u.test(cell)) ||
    rows.slice(2).some((row) => row.length !== width)
  ) {
    problems.push(
      `${section} table requires a full-width separator and full-width data rows.`,
    );
  }
}

function validateProfileAgreement(
  source: string,
  definition: ValidatedDefinition,
): Finding {
  const expectedHeading = `# ${definition.code} — ${definition.title}`;
  const actualHeading = source.split(/\r?\n/, 1)[0];
  const offering = namedRowsForTable(
    firstDirectTableRows(sectionBody(source, "Offering")),
  );
  const contradictions = [
    ...(actualHeading === expectedHeading
      ? []
      : [
          `Profile heading is ${JSON.stringify(actualHeading)}; Definition requires ${JSON.stringify(expectedHeading)}.`,
        ]),
    ...(sameAcademicYear(offering.get("Academic year"), definition.academicYear)
      ? []
      : [
          `Profile Academic year is ${JSON.stringify(offering.get("Academic year"))}; Definition says ${definition.academicYear}.`,
        ]),
    ...(offering.get("Semester") === String(definition.semester)
      ? []
      : [
          `Profile Semester is ${JSON.stringify(offering.get("Semester"))}; Definition says ${definition.semester}.`,
        ]),
  ];
  return contradictions.length === 0
    ? controlFinding(
        "MF-PROFILE-003",
        profilePath,
        "pass",
        "Profile identity and Offering values agree with the Definition.",
        "Human-facing and machine-readable controls agree.",
      )
    : controlFinding(
        "MF-PROFILE-003",
        profilePath,
        "requires-decision",
        contradictions.join(" "),
        "Profile and Definition evidence contradict each other.",
      );
}

function sameAcademicYear(
  actual: string | undefined,
  expected: string,
): boolean {
  const normalize = (value: string | undefined) =>
    value?.replace(/[–—]/gu, "-");
  return normalize(actual) === normalize(expected);
}
