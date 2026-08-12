import { controlFinding, failedControl } from "./control-finding.js";
import { moduleControlPaths } from "./control-paths.js";
import {
  renderColumns,
  rowsForTable,
  sectionBody,
  tableRows,
  validateHeadingOrder,
} from "./markdown-control-helpers.js";
import type { Finding } from "./types.js";
import type { ValidatedDefinition } from "./validate-definition.js";

const profilePath = moduleControlPaths.profile;
const profileSections = [
  "Offering",
  "Scope",
  "Teaching Structure",
  "Assessment Structure",
  "Source Authority",
  "Workspaces",
  "Known Gaps",
];
const profileTables = new Map([
  ["Offering", ["Field", "Value", "Evidence"]],
  ["Assessment Structure", ["Component", "Weight", "Timing", "Evidence"]],
  ["Source Authority", ["Rank", "Source", "Role", "Governs", "Evidence"]],
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
          "Profile title, headings, and required tables match contract version 2.",
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
    (section) =>
      tableRows(sectionBody(source, section))
        .slice(2)
        .flatMap((row) => {
          const subject =
            row[0] === "" || row[0] === undefined ? "row" : row[0];
          const evidence = row.at(-1)?.trim() ?? "";
          return evidence === ""
            ? [`${section} ${JSON.stringify(subject)} has no evidence.`]
            : [];
        }),
  );
}

function explicitUnknownProblems(source: string): string[] {
  const ambiguous = /^(?:n\/?a|tbc|tbd|\?)$/iu;
  return [...profileTables.keys()].flatMap((section) =>
    tableRows(sectionBody(source, section))
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
  const problems = validateHeadingOrder(source, profileSections);
  const title = source.split(/\r?\n/, 1)[0] ?? "";
  if (!/^# [A-Z]{2,4}\d{4}[A-Z]? — \S.+$/u.test(title)) {
    problems.push(
      `Profile title is ${JSON.stringify(title)}; expected # MODULE_CODE — Module Title.`,
    );
  }
  for (const [section, columns] of profileTables) {
    validateTable(sectionBody(source, section), section, columns, problems);
  }
  for (const section of ["Scope", "Teaching Structure"]) {
    if (sectionBody(source, section).trim() === "") {
      problems.push(`${section} has no prose or bullets.`);
    }
  }
  return problems;
}

function validateTable(
  body: string,
  section: string,
  columns: string[],
  problems: string[],
): void {
  const rows = tableRows(body);
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
  if (
    rows.length < 3 ||
    rows[1]?.length !== columns.length ||
    !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell)) ||
    rows.slice(2).some((row) => row.length !== columns.length)
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
  const offering = rowsForTable(sectionBody(source, "Offering"));
  const contradictions = [
    ...(actualHeading === expectedHeading
      ? []
      : [
          `Profile heading is ${JSON.stringify(actualHeading)}; Definition requires ${JSON.stringify(expectedHeading)}.`,
        ]),
    ...(offering.get("Academic year") === definition.academicYear
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
