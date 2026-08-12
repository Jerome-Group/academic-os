import type { ModuleControls } from "../../src/conformance/index.js";

export function validModuleControls(): ModuleControls {
  return {
    profile: `# MH2100 — Calculus III

## Offering
| Field | Value | Evidence |
| --- | --- | --- |
| Academic year | 2026-2027 | Definition |
| Semester | 1 | Definition |

## Scope
Multivariable calculus.

## Teaching Structure
- Weekly lectures and tutorials.

## Assessment Structure
| Component | Weight | Timing | Evidence |
| --- | --- | --- | --- |
| Midterm | 30% | Week 7 | NTULearn |

## Source Authority
| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |
| 1 | NTULearn | Primary | Offering | Current course |

## Workspaces
| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Learning | Study | \`70 Learning\` |

## Known Gaps
| Gap | Consequence | Next evidence |
| --- | --- | --- |
| None | None | None |
`,
    definition: `schema_version: 2
contract_version: 3
module: {code: MH2100, title: Calculus III}
offering: {academic_year: 2026-2027, semester: 1, status: active}
structure:
  tutorials: {layout: flat}
  assessments:
    quizzes: {enabled: true, evidence: [assessment-profile]}
    tests: {enabled: false}
    assignments: {enabled: false}
  projects: {enabled: false}
  labs: {enabled: false}
  resource_categories: []
sources:
  ntulearn:
    - {role: primary, destination: NTULearn, evidence: [course-site]}
evidence:
  assessment-profile: {source: NTULearn assessment profile, checked_at: 2026-08-11}
  course-site: {source: NTULearn course site, checked_at: 2026-08-11}
exceptions: []
`,
    curationRegister: "",
    agents: `# What this folder is
MH2100 module folder.

## Start here
Read \`CONTEXT.md\` and \`00 Module Admin/00 Module Profile.md\`.

## Routes
- Learning: \`70 Learning/\`
- Tutorials: \`20 Tutorials/\`
- Curation: \`00 Module Admin/20 Curation Register.jsonl\`
- Assessments: \`30 Assessments/\`
- Projects/Labs: \`40 Projects and Labs/\`
- Maintenance: \`00 Module Admin/10 Module Definition.yaml\`

## Domain language
The glossary is \`CONTEXT.md\` and decisions are \`docs/adr/\`. Read both before classifying, naming or organising module content. Use the glossary's terms; resolve ambiguity before adding language or decisions.

## Safety
Preserve importer sources and request decisions for ambiguity.

## Updating these instructions
Show proposed changes for approval before applying them.
`,
    claude:
      "# Claude Code\n\nRead `AGENTS.md` completely before working in this module folder.\n",
    context: `# MH2100 — Calculus III

Purpose: organise learning and work for MH2100.

## Language

**Module**: MH2100 Calculus III.
`,
  };
}

export function contextualModuleDefinition(
  source = validModuleControls().definition ?? "",
): string {
  return source
    .replace(
      "tutorials: {layout: flat}",
      "tutorials: {layout: grouped, groups: [CC0001, CC0002], evidence: [course-site]}",
    )
    .replace(
      /quizzes: \{enabled: (?:false|true, evidence: \[assessment-profile\])\}/u,
      "quizzes: {enabled: true, evidence: [assessment-profile]}",
    )
    .replace(
      "tests: {enabled: false}",
      "tests: {enabled: true, evidence: [assessment-profile]}",
    )
    .replace(
      "assignments: {enabled: false}",
      "assignments: {enabled: true, evidence: [assessment-profile]}",
    )
    .replace(
      "projects: {enabled: false}",
      "projects: {enabled: true, evidence: [course-site]}",
    )
    .replace(
      "labs: {enabled: false}",
      "labs: {enabled: true, evidence: [course-site]}",
    )
    .replace(
      "resource_categories: []",
      "resource_categories: [{name: 10 Formula Sheets, evidence: [course-site]}]",
    )
    .replace(
      "- {role: primary, destination: NTULearn, evidence: [course-site]}",
      "- {role: primary, destination: NTULearn, evidence: [course-site]}\n    - {role: tutorials, destination: NTULearn_Tutorial, evidence: [course-site]}",
    );
}
