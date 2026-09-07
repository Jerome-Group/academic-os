import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResolvedResearchProject } from "../../src/config/index.js";
import {
  validateResearchProjectClaims,
  validateResearchProjectDeliverableRegister,
  validateResearchProjectMap,
  validateResearchProjectMeetings,
  validateResearchProjectProfile,
  validateResearchProjectQuestions,
  validateResearchProjectSourcePlacement,
  validateResearchProjectSourceRegister,
  validateResearchProjectTaskProvenance,
  validateResearchProjectTaskRegister,
} from "../../src/conformance/index.js";
import { loadResearchProjectContract } from "../../src/contract/load-research-project-contract.js";
import { recordResearchFindingEvidence } from "../support/rule-evidence.js";

const target: ResolvedResearchProject = {
  key: "example-project",
  root: "Research",
  folder: "Example Project",
  status: "active",
  profile: "ureca",
};

const definition = `contract_version: 2
project:
  key: example-project
  folder: Example Project
  title: Example title
  status: active
profile: ureca
evidence:
  identity: owner-supplied
  confirmation: unresolved
`;

const profile = `# Example Project — Example title

## Identity

| Field | Value | Evidence |
| --- | --- | --- |
| Project key | example-project | owner-supplied |
| Folder | Example Project | owner-supplied |
| Title | Example title | owner-supplied |
| Status | active | owner-supplied |
| Programme profile | ureca | official-source |

## Purpose and Questions

Question remains open.

## Programme

Programme evidence remains under review.

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
| Research | Durable work | \`70 Research/\` |

## Known Gaps

| Gap | Consequence | Next evidence |
| --- | --- | --- |
| Exact scope | First question is unresolved | official-source |
`;

describe("research-project deterministic controls", () => {
  it("validates the complete Profile table interface and identity agreement", () => {
    const valid = validateResearchProjectProfile({
      source: profile,
      definition,
      target,
    });
    const wrongStatus = validateResearchProjectProfile({
      source: profile.replace(
        "| Status | active | owner-supplied |",
        "| Status | inactive | owner-supplied |",
      ),
      definition,
      target,
    });
    const wrongTable = validateResearchProjectProfile({
      source: profile.replace(
        "| Workspace | Purpose | Pointer |",
        "| Workspace | Pointer | Purpose |",
      ),
      definition,
      target,
    });
    const wrongIdentityOrder = validateResearchProjectProfile({
      source: profile.replace(
        "| Project key | example-project | owner-supplied |\n| Folder | Example Project | owner-supplied |",
        "| Folder | Example Project | owner-supplied |\n| Project key | example-project | owner-supplied |",
      ),
      definition,
      target,
    });

    assert.deepEqual(
      valid.map(({ ruleId, status }) => ({ ruleId, status })),
      [
        { ruleId: "RP-PROFILE-001", status: "pass" },
        { ruleId: "RP-PROFILE-003", status: "pass" },
      ],
    );
    assert.equal(wrongStatus[1]?.status, "fail");
    assert.match(wrongStatus[1]?.evidence ?? "", /Status is "inactive"/u);
    assert.equal(wrongTable[0]?.status, "fail");
    assert.match(wrongTable[0]?.evidence ?? "", /table headers/u);
    assert.equal(wrongIdentityOrder[1]?.status, "fail");
    assert.match(wrongIdentityOrder[1]?.evidence ?? "", /row labels/u);
    recordResearchFindingEvidence(wrongTable, "RP-PROFILE-001");
    recordResearchFindingEvidence(wrongStatus, "RP-PROFILE-003");
  });

  it("publishes the exact normative identity rows in the generic Profile template", async () => {
    const contract = await loadResearchProjectContract();
    const template =
      contract.seedFiles["00 Project Admin/00 Project Profile.md"] ?? "";

    assert.match(
      template,
      /\| Project key \| `<project-key>` \| unresolved \|/u,
    );
    assert.match(
      template,
      /\| Folder \| \{\{PROJECT_NAME\}\} \| unresolved \|/u,
    );
    assert.match(template, /\| Title \| Project Title \| unresolved \|/u);
    assert.match(template, /\| Status \| active \| unresolved \|/u);
    assert.match(template, /\| Programme profile \| generic \| unresolved \|/u);
  });

  it("validates Source-register rows rather than only the sources header", () => {
    const valid = validateResearchProjectSourceRegister(`sources:
  - id: source-1
    title: Primary reference
    authority: primary
    role: core
    storage: project
    locator: https://example.edu/source-1
    local_file: 10 Source Materials/20 Core Sources/source-1.pdf
    citation_key: SourceOne
    status: reading
    evidence: Publisher record and local checksum.
`);
    const invalid = validateResearchProjectSourceRegister(`sources:
  - id: source-1
    title: Primary reference
    authority: hearsay
    role: core
    storage: project
    locator: https://example.edu/source-1
    status: reading
    evidence: Publisher record.
    deadline: tomorrow
  - id: source-1
    title: Duplicate
    authority: secondary
    role: reference
    storage: project
    locator: ../outside.pdf
    status: queued
    evidence: Index entry.
`);

    assert.equal(valid.status, "pass");
    assert.equal(invalid.status, "fail");
    assert.match(invalid.evidence, /unsupported fields deadline/u);
    assert.match(
      invalid.evidence,
      /authority must be primary, secondary, generated/u,
    );
    assert.match(invalid.evidence, /requires citation_key/u);
    assert.match(invalid.evidence, /repeats id source-1/u);
    recordResearchFindingEvidence([invalid], "RP-SOURCES-001");
  });

  it("checks every local source against inventory and its role or authority home", () => {
    const sourceRegister = `sources:
  - id: programme
    title: Programme guide
    authority: primary
    role: programme
    storage: project
    locator: https://example.edu/programme
    local_file: 10 Source Materials/10 Programme and Project/guide.pdf
    status: read
    evidence: Official page.
  - id: core
    title: Core paper
    authority: primary
    role: core
    storage: project
    locator: https://example.edu/core
    local_file: 10 Source Materials/20 Core Sources/core.pdf
    citation_key: Core2026
    status: reading
    evidence: Publisher copy.
  - id: reference
    title: Background
    authority: secondary
    role: reference
    storage: project
    locator: https://example.edu/reference
    local_file: 10 Source Materials/30 Reference Sources/reference.pdf
    citation_key: Reference2026
    status: queued
    evidence: Publisher copy.
  - id: history
    title: Prior proposal
    authority: primary
    role: historical
    storage: project
    locator: local historical record
    local_file: 90 Resources/10 Preparation Archive/prior.md
    status: retired
    evidence: Owner archive.
  - id: aid
    title: Generated orientation
    authority: generated
    role: reference
    storage: project
    locator: local generated record
    local_file: 90 Resources/20 Research Aids/orientation.md
    citation_key: GeneratedAid
    status: queued
    evidence: Tool provenance.
`;
    const paths = [
      "10 Source Materials/10 Programme and Project/guide.pdf",
      "10 Source Materials/20 Core Sources/core.pdf",
      "10 Source Materials/30 Reference Sources/reference.pdf",
      "90 Resources/10 Preparation Archive/prior.md",
      "90 Resources/20 Research Aids/orientation.md",
    ];
    const valid = validateResearchProjectSourcePlacement({
      source: sourceRegister,
      profile: "ureca",
      inventory: {
        projectKey: "example-project",
        entries: paths.map((path) => ({ path, kind: "file" as const })),
      },
    });
    const missing = validateResearchProjectSourcePlacement({
      source: sourceRegister,
      profile: "ureca",
      inventory: {
        projectKey: "example-project",
        entries: paths
          .slice(1)
          .map((path) => ({ path, kind: "file" as const })),
      },
    });
    const wrongHome = validateResearchProjectSourcePlacement({
      source: sourceRegister.replace(
        "10 Source Materials/20 Core Sources/core.pdf",
        "10 Source Materials/30 Reference Sources/core.pdf",
      ),
      profile: "ureca",
      inventory: {
        projectKey: "example-project",
        entries: [
          ...paths.slice(0, 1).map((path) => ({ path, kind: "file" as const })),
          {
            path: "10 Source Materials/30 Reference Sources/core.pdf",
            kind: "file",
          },
          ...paths.slice(2).map((path) => ({ path, kind: "file" as const })),
        ],
      },
    });

    assert.equal(valid.status, "pass");
    assert.equal(missing.status, "fail");
    assert.match(missing.evidence, /does not identify an inventoried file/u);
    assert.equal(wrongHome.status, "fail");
    assert.match(
      wrongHome.evidence,
      /must be beneath 10 Source Materials\/20 Core Sources/u,
    );
    recordResearchFindingEvidence([missing], "RP-SOURCES-002");
  });

  it("validates the research Task row and its target-scoped provenance", () => {
    const valid = validateResearchProjectTaskRegister(`list_id: list-1
tasks:
  - task_id: task-1
    title: Check a finite example
    do_date: 2026-09-07
    status: open
    provenance:
      source: source-1
      claim: claim-1
      meeting: 20 Supervisor Meetings/2026-09-01 Scope/Meeting.md
      deliverable: paper
      milestone: Academic/paper-event
`);
    const invalid = validateResearchProjectTaskRegister(`list_id: list-1
tasks:
  - title: Check a finite example
    do_date: 2026-09-07T09:00
    status: open
    deadline: 2026-09-08
    provenance:
      claim: 7
      meeting: meeting one
      invented: value
`);

    assert.equal(valid.status, "pass");
    assert.equal(invalid.status, "fail");
    assert.match(invalid.evidence, /unsupported fields deadline/u);
    assert.match(invalid.evidence, /date with no time/u);
    assert.match(
      invalid.evidence,
      /provenance claim must be a non-empty string/u,
    );
    assert.match(
      invalid.evidence,
      /provenance has unsupported fields invented/u,
    );
    assert.match(invalid.evidence, /project-relative Markdown path/u);
    recordResearchFindingEvidence([invalid], "RP-TASKS-001");
  });

  it("resolves Research-task provenance against registered control identities", () => {
    const controls = {
      sourceRegister: `sources:
  - id: source-1
    title: Source
    authority: primary
    role: core
    storage: project
    locator: https://example.edu/source
    citation_key: SourceOne
    status: reading
    evidence: Publisher record.
`,
      claims: `# Claims

## claim-1 — First claim

- Status: candidate
`,
      deliverableRegister: `deliverables:
  - key: paper
    folder: 30 Deliverables/30 Paper
    status: working
    authority: source-1
    milestone: Academic/paper-event
`,
      inventory: {
        projectKey: "example-project",
        entries: [
          {
            path: "20 Supervisor Meetings/2026-09-01 Scope/Meeting.md",
            kind: "file" as const,
          },
        ],
      },
    };
    const taskRegister = `list_id: list-1
tasks:
  - task_id: task-1
    title: Check a finite example
    status: open
    provenance:
      source: source-1
      claim: claim-1
      meeting: 20 Supervisor Meetings/2026-09-01 Scope/Meeting.md
      deliverable: paper
      milestone: Academic/paper-event
`;
    const valid = validateResearchProjectTaskProvenance({
      taskRegister,
      ...controls,
    });
    const invalid = validateResearchProjectTaskProvenance({
      taskRegister: taskRegister
        .replace("source: source-1", "source: absent-source")
        .replace("claim: claim-1", "claim: absent-claim")
        .replace("2026-09-01 Scope/Meeting.md", "2026-09-02 Missing/Meeting.md")
        .replace("deliverable: paper", "deliverable: poster")
        .replace("Academic/paper-event", "paper-window"),
      ...controls,
    });

    assert.equal(valid.status, "pass");
    assert.equal(invalid.status, "fail");
    assert.match(invalid.evidence, /not an existing Source-register ID/u);
    assert.match(invalid.evidence, /not an existing Claim key/u);
    assert.match(
      invalid.evidence,
      /not an existing inventoried meeting-note path/u,
    );
    assert.match(invalid.evidence, /not an existing Deliverable-register key/u);
    assert.match(invalid.evidence, /Academic\/<event-id>/u);
  });

  it("validates stable Claim and Question keys and closed statuses", async () => {
    const contract = await loadResearchProjectContract();
    const seededClaims = validateResearchProjectClaims(
      contract.seedFiles["70 Research/CLAIMS.md"],
    );
    const seededQuestions = validateResearchProjectQuestions(
      contract.seedFiles["70 Research/QUESTIONS.md"],
    );
    const validClaims = validateResearchProjectClaims(`# Claims

## first-claim — First claim

- Status: checked
`);
    const invalidQuestions = validateResearchProjectQuestions(`# Questions

## Moving key

- Status: finished
`);

    assert.equal(seededClaims.status, "pass");
    assert.equal(seededQuestions.status, "pass");
    assert.equal(validClaims.status, "pass");
    assert.equal(invalidQuestions.status, "fail");
    assert.match(invalidQuestions.evidence, /stable-key/u);
  });

  it("validates dated meeting containers, notes, records, and schedule rows", () => {
    const directory = "20 Supervisor Meetings/2026-09-08 Scope";
    const entries = [
      { path: directory, kind: "directory" as const },
      { path: `${directory}/Meeting.md`, kind: "file" as const },
      { path: `${directory}/Sources`, kind: "directory" as const },
      { path: `${directory}/10 Learning`, kind: "directory" as const },
      { path: `${directory}/10 Learning/records`, kind: "directory" as const },
      {
        path: `${directory}/10 Learning/records/0001-session.md`,
        kind: "file" as const,
      },
      { path: `${directory}/20 Exercises`, kind: "directory" as const },
      { path: `${directory}/20 Exercises/records`, kind: "directory" as const },
      { path: "20 Supervisor Meetings/SCHEDULE.md", kind: "file" as const },
    ];
    const note = `---
date: 2026-09-08
participants: [Owner, Supervisor]
status: confirmed
---

# Scope
`;
    const valid = validateResearchProjectMeetings({
      inventory: { projectKey: "example-project", entries },
      schedule: `# Supervisor meeting workspaces

| Date | Folder | State |
| --- | --- | --- |
| 2026-09-08 | \`${directory}/\` | confirmed |
`,
      meetingNotes: { [`${directory}/Meeting.md`]: note },
    });
    const invalid = validateResearchProjectMeetings({
      inventory: {
        projectKey: "example-project",
        entries: [
          ...entries,
          {
            path: `${directory}/10 Learning/01 Unit/nested`,
            kind: "directory" as const,
          },
          {
            path: `${directory}/20 Exercises/Unnumbered`,
            kind: "directory" as const,
          },
        ],
      },
      schedule: `| Date | Folder | State |
| --- | --- | --- |
| tomorrow | Scope | done |
`,
      meetingNotes: {
        [`${directory}/Meeting.md`]: note
          .replace("date: 2026-09-08", "date: 2026-09-09")
          .replace("participants: [Owner, Supervisor]", "participants: []"),
      },
    });

    assert.equal(valid.status, "pass");
    assert.equal(invalid.status, "fail");
    assert.match(invalid.evidence, /date must be 2026-09-08/u);
    assert.match(invalid.evidence, /participants must be a sequence/u);
    assert.match(
      invalid.evidence,
      /must be a direct NN Short title directory/u,
    );
    assert.match(invalid.evidence, /Schedule row 1/u);
    assert.match(invalid.evidence, /Schedule omits meeting directory/u);
    recordResearchFindingEvidence([invalid], "RP-MEETINGS-001");

    const duplicateYaml = validateResearchProjectMeetings({
      inventory: { projectKey: "example-project", entries },
      schedule: `| Date | Folder | State |\n| --- | --- | --- |\n| 2026-09-08 | \`${directory}/\` | confirmed |\n`,
      meetingNotes: {
        [`${directory}/Meeting.md`]: note.replace(
          "status: confirmed",
          "status: draft\nstatus: confirmed",
        ),
      },
    });
    assert.equal(duplicateYaml.status, "fail");
    assert.match(duplicateYaml.evidence, /front matter is not valid YAML/u);
  });

  it("validates typed meeting-centred Research-map rows", () => {
    const sourceRegister = `sources:
  - id: source-1
    title: Registered source
    authority: primary
    role: core
    storage: project
    locator: https://example.edu/source-1
    citation_key: SourceOne
    status: reading
    evidence: Publisher record.
`;
    const questions = `# Questions

## question-1 — First question

- Status: open
`;
    const inventory = {
      projectKey: "example-project",
      entries: [
        {
          path: "20 Supervisor Meetings/2026-09-01 Scope/Meeting.md",
          kind: "file" as const,
        },
        {
          path: "20 Supervisor Meetings/2026-09-01 Scope/10 Learning/01 Unit",
          kind: "directory" as const,
        },
        {
          path: "20 Supervisor Meetings/2026-09-01 Scope/20 Exercises/01 Set",
          kind: "directory" as const,
        },
        {
          path: "20 Supervisor Meetings/2026-09-01 Scope/10 Learning/records/0001-session.md",
          kind: "file" as const,
        },
        {
          path: "70 Research/10 Concepts/thread-1/thread-1.tex",
          kind: "file" as const,
        },
        {
          path: "70 Research/20 Research Notes/thread-1/thread-1.tex",
          kind: "file" as const,
        },
      ],
    };
    const valid = validateResearchProjectMap({
      source: `threads:
  - key: thread-1
    order: 1
    title: First question
    question: question-1
    status: open
    progress: Initial meeting work recorded.
    sources: [source-1]
    meeting_work:
      - meeting: 20 Supervisor Meetings/2026-09-01 Scope/Meeting.md
        status: discussed
        progress: Unit discussed; proof remains open.
        learning_units: [20 Supervisor Meetings/2026-09-01 Scope/10 Learning/01 Unit]
        exercise_sets: [20 Supervisor Meetings/2026-09-01 Scope/20 Exercises/01 Set]
        session_records: [20 Supervisor Meetings/2026-09-01 Scope/10 Learning/records/0001-session.md]
    promoted:
      concepts: [70 Research/10 Concepts/thread-1/thread-1.tex]
      research_notes: [70 Research/20 Research Notes/thread-1/thread-1.tex]
`,
      sourceRegister,
      questions,
      inventory,
    });
    const invalid = validateResearchProjectMap({
      source: `threads:
  - key: thread-1
    order: 0
    title: First question
    question: absent-question
    status: drafting
    sources: source-1
    meeting_work: []
    promoted: []
    proof: done
`,
      sourceRegister,
      questions,
      inventory,
    });

    assert.equal(valid.status, "pass");
    assert.equal(invalid.status, "fail");
    assert.match(invalid.evidence, /unsupported fields proof/u);
    assert.match(invalid.evidence, /status must be open, parked, closed/u);
    assert.match(invalid.evidence, /sources must be a sequence/u);
    assert.match(invalid.evidence, /question absent-question/u);
    assert.match(invalid.evidence, /order must be a positive integer/u);
    assert.match(invalid.evidence, /promoted must be a mapping/u);
    recordResearchFindingEvidence([invalid], "RP-RESEARCH-001");
  });

  it("rejects absent Research-map identities and typed paths", () => {
    const result = validateResearchProjectMap({
      source: `threads:
  - key: thread-1
    order: 1
    title: First question
    question: question-1
    status: open
    sources: [absent-source]
    meeting_work:
      - meeting: 20 Supervisor Meetings/2026-09-01 Scope/Meeting.md
        status: active
        learning_units: [20 Supervisor Meetings/2026-09-01 Scope/10 Learning/01 Unit/nested]
        exercise_sets: []
        session_records: []
    promoted:
      concepts: [70 Research/10 Concepts/other-thread/missing.tex]
      research_notes: []
`,
      sourceRegister: "sources: []\n",
      questions: `# Questions

## question-1 — First question

- Status: open
`,
      inventory: { projectKey: "example-project", entries: [] },
    });

    assert.equal(result.status, "fail");
    assert.match(result.evidence, /not an existing Source-register ID/u);
    assert.match(result.evidence, /does not identify an inventoried file/u);
    assert.match(result.evidence, /has the wrong project home/u);
  });

  it("keeps URECA-derived Deliverable folders distinct from generic folders", () => {
    const ureca = validateResearchProjectDeliverableRegister(
      `deliverables:
  - key: paper
    folder: 30 Deliverables/30 Paper
    status: not-started
    authority: source-1
    milestone: Academic/paper-event
`,
      "ureca",
    );
    const wrongUreca = validateResearchProjectDeliverableRegister(
      `deliverables:
  - key: notes
    folder: 30 Deliverables/10 Working Notes
    status: working
    authority: source-1
`,
      "ureca",
    );
    const generic = validateResearchProjectDeliverableRegister(
      `deliverables:
  - key: notes
    folder: 30 Deliverables/10 Working Notes
    status: working
    authority: source-1
`,
      "generic",
    );

    assert.equal(ureca.status, "pass");
    assert.equal(wrongUreca.status, "fail");
    assert.match(wrongUreca.evidence, /not derived by the ureca profile/u);
    assert.equal(generic.status, "pass");
    recordResearchFindingEvidence([wrongUreca], "RP-DELIVERABLES-001");
  });

  it("accepts every empty seeded register", () => {
    assert.equal(
      validateResearchProjectSourceRegister("sources: []\n").status,
      "pass",
    );
    assert.equal(
      validateResearchProjectTaskRegister("tasks: []\n").status,
      "pass",
    );
    assert.equal(
      validateResearchProjectMap({
        source: "threads: []\n",
        sourceRegister: "sources: []\n",
        questions: "# Questions\n",
        inventory: { projectKey: "example-project", entries: [] },
      }).status,
      "pass",
    );
    assert.equal(
      validateResearchProjectDeliverableRegister(
        "deliverables: []\n",
        "generic",
      ).status,
      "pass",
    );
  });
});
