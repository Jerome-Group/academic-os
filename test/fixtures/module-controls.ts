import type { ModuleControls } from "../../src/conformance/index.js";
import { moduleControlPaths } from "../../src/conformance/control-paths.js";
import {
  interpolateModuleCode,
  pinnedDocumentNames,
} from "../../src/contract/pinned-documents.js";
import { testModuleContract } from "./module-contract.js";

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
    claude:
      "# Claude Code\n\nRead `AGENTS.md` completely before working in this module folder.\n",
    context: `# MH2100 — Calculus III

Purpose: organise learning and work for MH2100.

## Language

**Module**: MH2100 Calculus III.
`,
    ...pinnedModuleControls("MH2100"),
  };
}

export function pinnedModuleControls(moduleCode: string): ModuleControls {
  return Object.fromEntries(
    pinnedDocumentNames.map((name) => [
      name,
      interpolateModuleCode(
        testModuleContract.pinnedDocuments[name],
        moduleCode,
      ),
    ]),
  );
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

export function moduleControlContents(
  controls: ModuleControls,
): Map<string, string> {
  return new Map(
    Object.entries(moduleControlPaths).flatMap(([name, path]) => {
      const contents = controls[name as keyof ModuleControls];
      return contents === undefined ? [] : [[path, contents]];
    }),
  );
}
