import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validModuleControls } from "../fixtures/module-controls.js";

export async function journalSeedFixture(
  root: string,
  kind: "module" | "research",
) {
  const driveMount = join(root, "Drive");
  const stateRoot = join(root, "State");
  const parentRoot = join(
    driveMount,
    "Modules",
    kind === "module" ? "Y2S1" : "Research",
  );
  await mkdir(parentRoot, { recursive: true });
  await mkdir(stateRoot);
  const configPath = join(root, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      driveMount,
      stateRoot,
      activeSemester: "Y2S1",
      seedTarget: { semester: "Y2S1", module: "MH2100" },
      semesters: {
        Y2S1: {
          root: "Modules/Y2S1",
          status: "active",
          modules: kind === "module" ? ["MH2100"] : [],
        },
      },
      research: {
        root: "Modules/Research",
        projects: {
          "example-project": {
            folder: "Example Project",
            status: "active",
            profile: "ureca",
          },
        },
      },
    }),
  );
  const profile = join(root, "profile.md");
  const definition = join(root, "definition.yaml");
  const controls = validModuleControls();
  await writeFile(
    profile,
    kind === "module" ? (controls.profile ?? "") : researchProfile,
  );
  await writeFile(
    definition,
    kind === "module"
      ? (controls.definition ?? "").replace(
          "quizzes: {enabled: true, evidence: [assessment-profile]}",
          "quizzes: {enabled: false}",
        )
      : `contract_version: 3
project:
  key: example-project
  folder: Example Project
  title: Synthetic project
  status: active
profile: ureca
evidence:
  identity: owner-supplied
  confirmation: unresolved
`,
  );
  return {
    stateRoot,
    parentRoot,
    driveMount,
    args: [
      "seed",
      "--config",
      configPath,
      ...(kind === "research" ? ["--research-project", "example-project"] : []),
      "--profile",
      profile,
      "--definition",
      definition,
      "--json",
    ],
  };
}

const researchProfile = `# Example Project — Synthetic project

## Identity
| Field | Value | Evidence |
| --- | --- | --- |
| Project key | example-project | owner-supplied |
| Folder | Example Project | owner-supplied |
| Title | Synthetic project | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ureca | official-source |

## Purpose and Questions
No research claim.

## Programme
Synthetic profile coverage.

## Supervision
| Field | Value | Evidence |
| --- | --- | --- |

## Deliverables
| Deliverable | Requirement | Evidence |
| --- | --- | --- |

## Source Authority
| Rank | Source | Role | Governs | Evidence |
| --- | --- | --- | --- | --- |

## Workspaces
| Workspace | Purpose | Pointer |
| --- | --- | --- |
| Research | Disposable mounted tree | \`70 Research/\` |

## Known Gaps
| Gap | Consequence | Next evidence |
| --- | --- | --- |
| Content accuracy | Not tested here | unresolved |
`;
