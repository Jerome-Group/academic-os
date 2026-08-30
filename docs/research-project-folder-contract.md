# The research-project folder contract

The normative folder, naming and working contract every configured Research project follows. A
project folder that disagrees with an applicable rule here is wrong, and a rule that is not here is
not a rule. A Research project is the distinct aggregate recorded in
[`docs/adr/0024`](adr/0024-research-projects-are-not-modules.md); it is not a Module and inherits no
semester, module-code or NTULearn requirement.

**Contract version: 1.** Increase it when a normative requirement, applicability rule or allowed
structure changes. Rules have stable IDs. **Deterministic** rules are decided without judgment;
**judgment** rules expose evidence for a person or agent to resolve. Project contents live outside
this public repository under [`docs/adr/0002`](adr/0002-the-contract-lives-here-and-the-coursework-does-not.md).

## Seeding a research project

**RP-SEED-001 (judgment).** For a requested configured project:

1. Inspect existing local and Drive context.
2. Research the programme and project from Owner-supplied or official evidence.
3. Separate confirmed facts, Owner-supplied facts and unresolved claims.
4. Propose the Profile, Definition, programme profile and initial source set with citations.
5. Obtain the Owner's confirmation of the proposed controls and named unknowns, unless the Owner's
   request explicitly delegates design and application for this exact target. In that delegated
   case, preserve every unknown and surface the applied controls at handoff.
6. Preview the complete seed plan; apply only under that explicit target-scoped instruction.

The step completes when every proposed fact has an evidence status and every unknown that changes
the seed is visible. Unsupported detail stays unknown.

**RP-SEED-002 (deterministic).** Seed is additive. A conflict blocks all planned creation. A new
project is built in a uniquely marked staging folder, audited, then atomically renamed to its exact
configured folder. Additions to an existing folder are journalled and idempotent; interruption is
reported and resumed rather than hidden. Seed never renames, removes or overwrites existing
content.

An approved initial intake may join that same plan through a private manifest:

```json
{
  "schemaVersion": 1,
  "files": [
    {
      "destination": "10 Source Materials/20 Core Sources/example.pdf",
      "source": "payload/example.pdf",
      "sha256": "64 lowercase hexadecimal characters",
      "encoding": "binary"
    }
  ]
}
```

The root and each row use exactly the shown keys; `encoding` is `utf8` or `binary`. `source` is a
relative local path resolved from the manifest. The manifest and every source are ordinary,
materialized files, and each source's exact bytes match its recorded SHA-256. A `utf8` source also
decodes as strict UTF-8.

Initial intake may replace only the caller-owned seed bodies for `20 Source Register.yaml`,
`50 Deliverable Register.yaml` and `references.bib`, all as UTF-8. The Profile and Definition keep
their dedicated inputs. Every other intake file is additive and sits beneath an open Source,
Meeting, profile-derived Deliverable, Research-work or existing Resource-category directory.
Missing descendants beneath that interior join the plan as directory operations. Duplicate,
non-canonical, root, Project Admin, pinned, fixed-path and file/directory-conflicting destinations
refuse the plan.

Binary bytes use canonical base64 only inside the private plan and journal. Preview and run reports
expose each operation's kind and destination, never file contents. A repeated plan compares and
writes exact bytes.

## Identity and universal structure

**RP-ROOT-001 (deterministic).** A Research project directory is a direct child of the configured
`research.root` and uses the configured project's `folder` exactly. The configuration map key is
its stable machine identity; the folder is its human-facing identity. Resolve the target only
beneath the exact configured root and reject root escapes, symlinks, duplicate targets, case
variants and unresolved cloud placeholders before inventory or writes.

**RP-UNIVERSAL-001 (deterministic).** Every Research project folder contains:

```text
PROJECT_NAME/
├── 00 Project Admin/
│   ├── 00 Project Profile.md
│   ├── 10 Project Definition.yaml
│   ├── 20 Source Register.yaml
│   ├── 30 Task Register.yaml
│   ├── 40 Research Map.yaml
│   ├── 50 Deliverable Register.yaml
│   └── 60 Contribution and AI Use.md
├── 10 Source Materials/
│   ├── 10 Programme and Project/
│   ├── 20 Core Sources/
│   ├── 30 Reference Sources/
│   └── references.bib
├── 20 Supervisor Meetings/
├── 30 Deliverables/
├── 70 Research/
│   ├── 10 Reading/
│   ├── 20 Mathematics/
│   ├── 30 Experiments/
│   ├── templates/
│   │   ├── reading-note.md
│   │   ├── mathematics-note.tex
│   │   ├── experiment-record.md
│   │   ├── meeting-note.md
│   │   └── deliverable-check.md
│   ├── GLOSSARY.md
│   ├── QUESTIONS.md
│   └── CLAIMS.md
├── 90 Resources/
│   └── 00 Unclassified/
├── .scratch/
├── AGENTS.md
├── CLAUDE.md
├── CONTEXT.md
└── docs/
    ├── 00 Structure and Naming.md
    ├── 10 Sources and Provenance.md
    ├── 20 Research Procedure.md
    ├── 30 Deliverables Procedure.md
    └── adr/
```

`00 Project Admin` holds controls; `10 Source Materials` holds evidence and literature;
`20 Supervisor Meetings` holds durable meeting notes; `30 Deliverables` holds programme outputs;
`70 Research` holds the Owner's reading, mathematics and experiments; `90 Resources` holds aids
that are useful but are not evidence; `.scratch` holds disposable working files.

**RP-ROOT-002 (deterministic).** Loose project contents at root are errors. An unknown root
directory requires a decision; it is neither silently adopted nor automatically removed. The
fixed tree's open interiors may nest as the work needs. Additional first-level Deliverable and
Resource directories exist only when the Definition's profile derives them.

**RP-ROOT-003 (deterministic).** A dot-named file and a zero-byte `Icon\r` written by the mount are
mount artifacts rather than project content. Inventory and seeding omit and preserve them exactly,
as MF-ROOT-003 does for Modules. Only a file qualifies: `.scratch/` remains required, and an
`Icon\r` carrying bytes is content.

The universal tree contains no importer. Mention of an online programme surface does not establish
one; adding an automation-owned root requires a later contract version and an actual integration.

## Project controls

### Profile

**RP-PROFILE-001 (deterministic).** `00 Project Profile.md` uses this exact heading order:

```markdown
# PROJECT_NAME — Project Title

## Identity
## Purpose and Questions
## Programme
## Supervision
## Deliverables
## Source Authority
## Workspaces
## Known Gaps
```

Identity and Supervision use `Field | Value | Evidence`; Deliverables uses
`Deliverable | Requirement | Evidence`; Source Authority uses
`Rank | Source | Role | Governs | Evidence`; Workspaces uses
`Workspace | Purpose | Pointer`; Known Gaps uses `Gap | Consequence | Next evidence`. Purpose and
Questions and Programme are concise prose or bullets.

Identity has exactly these five rows, in order: `Project key`, `Folder`, `Title`, `Status`,
`Programme profile`. Each value matches the Definition, and each Evidence cell identifies
`official-source`, `owner-supplied` or `unresolved`.

**RP-PROFILE-002 (judgment).** The Profile contains confirmed human-facing facts and explicit
unknowns. It distinguishes `official-source`, `owner-supplied` and `unresolved` evidence. It
excludes executable rules, full inventories, live task progress, mathematical claims, session
history, build commands and durable architectural rationale. A standing month window may be
recorded as programme guidance; an exact deadline belongs to the Live calendar and is not inferred
from it.

**RP-PROFILE-003 (deterministic).** Profile identity, folder, title, status and programme profile
agree with the Definition. A private Project Profile may name people and registration details; a
generic seed-source template never does.

### Definition

**RP-DEFINITION-001 (deterministic).** `10 Project Definition.yaml` is the closed machine authority
for contract version, project identity, programme profile and identity-evidence status. Version 1
has exactly this shape:

```yaml
contract_version: 1
project:
  key: example-project
  folder: Example Project
  title: Example project title
  status: active
profile: generic
evidence:
  identity: owner-supplied
  confirmation: unresolved
```

`project.key` is a lowercase stable slug, `folder` is one path segment, `title` is non-empty,
`status` is `active` or `inactive`, `profile` is `generic` or `ureca`, `evidence.identity` is
`owner-supplied` or `official-source`, and `evidence.confirmation` is `confirmed` or `unresolved`.
The file has no paths outside the project, credentials, dates, Calendar IDs, Tasks IDs, arbitrary
structure, inventories or research progress.

**RP-DEFINITION-002 (deterministic).** Definition key, folder, status and profile agree with the
configured target; an omitted configuration profile resolves to `generic`. The declared profile
alone derives context structure. A missing structure is not guessed from files already in the
folder, and project content never becomes evidence for enabling a profile.

### Agent and domain controls

**RP-AGENTS-001 (deterministic).** `AGENTS.md` is the project's local router. Its sections are
these six, in order: What this folder is; Start here; Routes; Domain language; Safety; Updating
these instructions. Routes cover Sources, Meetings, Research, Learning, Deliverables, Tasks and
Maintenance, each pointing at one procedure or control.

**RP-AGENTS-002 (deterministic).** `CLAUDE.md` contains exactly a `# Claude Code` heading followed
by `Read \`AGENTS.md\` completely before working in this research-project folder.` It carries no
independent rule copy. Every AGENTS pointer resolves within the folder.

**RP-AGENTS-003 (judgment).** With the Owner present, show the exact proposed wording before
changing a standing instruction or domain document. A pinned change begins in this repository's
canonical seed source; never edit a project's pinned copy directly. Unattended, write
project-specific `CONTEXT.md` or `docs/adr/` only with the domain-modeling discipline loaded and its
tests applied; precedent resolves, and ambiguity parks. Every unattended domain-document write is
surfaced in the run report. Mechanical register writes follow their own authority and procedure and
are outside this instruction-writing gate.

**RP-AGENTS-004 (deterministic).** `AGENTS.md` and the four numbered `docs/` procedures are pinned:
each project's copy is byte-identical to its canonical file under
`seed-templates/research-project/`, modulo `{{PROJECT_NAME}}` interpolation and removal of the
`.template` infix. A difference is repaired from the seed source. Project-specific knowledge lives
in `CONTEXT.md`, `docs/adr/`, the Profile or a register.

The five Research templates are seeded canonical starting points and required by name. Their
copies may be adapted to make the Owner's writing easier; they are not standing instructions and
are not pinned.

**RP-CONTEXT-001 (deterministic).** `CONTEXT.md` is a glossary of project-organisational terms:
what the project calls an object and how that changes where it goes or how it is named. Seed its
project heading, purpose and `## Language`, inventing no terms. Subject language belongs in
`70 Research/GLOSSARY.md`. Add an organisational term only after an ambiguity has been resolved.

**RP-DOCS-001 (deterministic).** `docs/` contains the four pinned procedures and `docs/adr/`. A
project ADR records a standing project rule this contract does not force, whose reversal would
strand records built on it. ADRs are numbered project-locally from `0001`, superseded by a new ADR
and never deleted. One-time source, meeting, claim or deliverable decisions stay with their own
records.

**RP-ADMIN-001 (deterministic).** Project Admin is flat and contains exactly the seven universal
controls. Additional admin files or subdirectories require a contract change.

### Registers and human controls

**RP-SOURCES-001 (deterministic).** `20 Source Register.yaml` starts as `sources: []`. A later row
identifies one source by immutable `id`, `title`, `authority`, `role`, durable `locator`, optional
`local_file`, optional `citation_key`, `status` and `evidence`:

```yaml
sources:
  - id: example-key
    title: Example title
    authority: primary
    role: core
    locator: https://example.org/durable-record
    local_file: 10 Source Materials/20 Core Sources/example.pdf
    citation_key: Example2026
    status: reading
    evidence: Why this classification is supported.
```

`authority` is `primary`, `secondary` or `generated`; `role` is `programme`, `project`, `core`,
`reference` or `historical`; `status` is `queued`, `reading`, `read` or `retired`. A literature row
uses `citation_key` into `references.bib`, which owns bibliographic facts. A generated aid may be
registered for provenance but cannot support a mathematical claim.

**RP-TASKS-001 (deterministic).** `30 Task Register.yaml` mirrors the configured project's Google
Tasks list and starts as `tasks: []` with no `list_id`. It follows MF-TASKS-001's row shape and
pull-owned semantics. The shared provenance remains additive: `assessment`, `source` and
`milestone` keep their existing meanings, while Research-project work may additionally point to a
`claim`, `meeting` or `deliverable`. A project task uses the applicable `source`, `claim`, `meeting`,
`deliverable` and `milestone` pointers rather than inventing a second task taxonomy. A task carries
a date-only do-date; deadlines remain Calendar milestones.

Pointers use existing identities: `source` is a Source-register ID, `claim` a stable Claim key,
`meeting` an existing project-relative meeting-note path and `deliverable` a Deliverable-register
key. `milestone` is `Academic/<event-id>`, using the provider event ID in the Live Academic
calendar. A Task milestone must already occur in a Deliverable-register row and must match its
selected deliverable when both pointers are present. The register records the pointer; the Live
calendar remains the authority for the event's existence and current state.

**RP-RESEARCH-001 (deterministic).** `40 Research Map.yaml` starts as `threads: []`. A thread maps
an immutable key and title to a status (`open`, `parked` or `closed`) and lists relative pointers
under `sources`, `reading`, `mathematics` and `experiments`. It maps durable work; it carries no
task queue, deadline, proof text or live cursor.

**RP-DELIVERABLES-001 (deterministic).** `50 Deliverable Register.yaml` starts as
`deliverables: []`. Each profile-derived deliverable later carries immutable `key`, exact `folder`,
`status`, `authority` and optional `milestone` pointer. A milestone is the Live Calendar provider
identity `Academic/<event-id>`, not its title, date or Proposal ID. Status is `not-started`, `working`,
`supervisor-review`, `ready`, `submitted` or `accepted`. It records state and evidence, not the
deliverable's prose or deadline.

**RP-INTEGRITY-001 (judgment).** `60 Contribution and AI Use.md` states the standing authorship
boundary and records material assistance the Owner adopts: date, artifact, assistance, what the
Owner independently checked or rewrote, and any disclosure action. A tool invocation with no
intellectual effect needs no row. The Owner's authorship and understanding of every adopted
mathematical claim are the completion criterion.

Before collecting research data or releasing an artifact outside the supervised workspace, check
the current programme rule, NTU GenAI disclosure, data/confidentiality, intellectual-property and
human-subject branches against the Profile and registered policy sources. Record `not applicable`
with evidence for a pure-mathematics project rather than assuming it. Unknown ownership,
confidentiality, required ethics approval or receiving-party rules park collection or release for
the supervisor or responsible NTU office. Material GenAI use records tool, version, purpose and
manner; confidential, sensitive or personal data never enters an external tool without the policy's
conditions being proved.

## Source materials and provenance

**RP-SOURCES-002 (deterministic).** Every Source-register `local_file` identifies an inventoried
file. Programme and Project files live under `10 Programme and Project`; Core files under
`20 Core Sources`; Reference files under `30 Reference Sources`. A generated file lives under the
profile's `Research Aids` home or `90 Resources/00 Unclassified`. A URECA Historical file lives
under `90 Resources/10 Preparation Archive`; a Generic Historical file remains Unclassified.
Generated authority takes placement precedence over role. `references.bib` is the bibliographic
source of truth. Moving a source from Reference to Core updates its register row and preserves its
stable ID.

**RP-SOURCES-003 (judgment).** Every claim taken from a source names a Source-register ID and a
locator precise enough to re-open the supporting passage. Prefer an official page, DOI, arXiv
record or publisher record over a search result or generated summary. Where two authorities
disagree, record both and the unresolved consequence. Generated explanations and research aids
may point to sources; they never stand in for them.

## Human-first research

**RP-RESEARCH-002 (judgment).** One research pass begins with a named question, works against
registered sources, and leaves only durable artifacts the Owner can resume: a reading note,
mathematics note, experiment record, Claim entry, Question entry or Research-map pointer. Coverage
alone does not settle a question. A claim is settled only when the Owner can reconstruct its
argument and its cited support.

`70 Research/10 Reading` holds source-by-source reading notes; `20 Mathematics` holds definitions,
examples, proof attempts and proofs in the Owner's notation; `30 Experiments` holds computations
and finite examples with enough input, method and output to reproduce them. `QUESTIONS.md` is the
human queue of mathematical unknowns, `CLAIMS.md` is the human claim ledger, and `GLOSSARY.md` is
the subject speaking.

Claim entries use `## stable-key — Short label` and one status: `candidate`, `checked`, `refuted`
or `superseded`. Question entries use the same heading interface and one status: `open`, `parked`
or `settled`. The stable lowercase kebab key does not change when the label or status changes.

**RP-RESEARCH-003 (judgment).** Agents route, locate sources, explain, ask checks, compile, test,
compare and critique. Agent-authored candidate mathematics remains in `.scratch` until the Owner
has reconstructed or rewritten it, verified every citation and chosen to adopt it. Adoption moves
the Owner's version into Research or a Deliverable and records material assistance under
RP-INTEGRITY-001. The artifact, not the conversation transcript, is the durable record.

**RP-RESEARCH-004 (judgment).** A supervisor meeting uses the meeting template and records the
date, participants, questions brought, guidance received, decisions, follow-ups and evidence
status. The Owner confirms the note before it becomes durable. Follow-ups become Tasks when they
are actionable; mathematical guidance changes a claim or thread only after the Owner works it
through.

## Deliverables and programme profiles

**RP-DELIVERABLES-002 (judgment).** A Deliverable workspace contains the Owner's source and
rendered artifacts, programme template if supplied, feedback and submission evidence. An agent may
check requirements, citations, consistency, compilation and clarity. The Owner writes and adopts
the mathematical exposition. A generated candidate stays in `.scratch`; supervisor feedback stays
attributed; the submitted artifact is never silently replaced.

**RP-DELIVERABLES-003 (deterministic).** Work status lives in the Deliverable register, actionable
steps in Google Tasks and exact deadlines in the Live calendar. One never overwrites another. A
deliverable becomes `submitted` or `accepted` only from submission or supervisor evidence; a
compiled PDF alone proves neither.

**RP-PROFILE-STRUCTURE-001 (deterministic).** `profile: generic` adds no directory. `profile: ureca`
adds exactly:

```text
30 Deliverables/
├── 10 Abstract/
├── 20 Poster/
├── 30 Paper/
└── 40 Reflection/
90 Resources/
├── 10 Preparation Archive/
└── 20 Research Aids/
```

Preparation Archive holds provenance-preserving historical material; Research Aids holds
generated orientation or temporary explanatory aids that remain outside claim authority. URECA's
programme source, current requirements and unresolved dates belong in controls, not directory
names. A future FYP profile may derive its own outputs; FYP-only thesis, presentation, repository
and embargo rules do not apply to URECA or generic projects.

## Naming and builds

**RP-NAMING-001 (deterministic).** Fixed paths use their exact spelling and case. Project content
uses descriptive human-readable names. Source files preserve a publisher or programme filename
when that name is stable; otherwise the Source-register ID leads the name. Meeting notes use
`YYYY-MM-DD Topic.md`; reading notes use their Source-register ID; related mathematics and
experiment artifacts use the Research-map thread key followed by a short title.

**RP-NAMING-002 (judgment).** Versions use `_Draft_01`, `_Draft_02` and so on. A completed artifact
has no `Final` suffix. On collision, compare the artifacts first, then distinguish them by date,
source ID or draft number. Programme-mandated submission names override this rule and are recorded
in the Deliverable register's authority evidence.

**RP-NAMING-003 (deterministic).** Everything inside `.scratch`, a LaTeX `build/`, and the pinned
`docs/` procedures is exempt from content naming. Source-register identity, BibTeX keys and
Research-map keys remain stable when a display filename changes.

**RP-LATEX-001 (deterministic).** Keep `.scratch` at project root. Put a `build/` beside each LaTeX
workspace only when compilation begins; never seed one. User-facing PDFs sit beside their source
or in the matching Deliverable workspace. The mathematics-note template is a starting interface,
not a generated proof.

## Tasks and Calendar

**RP-CALENDAR-001 (deterministic).** `source.kind: research-project` is reserved for a private,
transparent, singular and non-recurring Research-project milestone on the Academic calendar. It
declares `evidenceStatus` as `confirmed` or `provisional`; an update may not move it, make it public
or opaque, turn it into an event or recurrence, or remove its evidence state. A confirmed exact
deadline uses a source reference explicitly marked `authenticated` or `confirmed`, says
`Confirmed` in its title and cites `Confirmed source:` in its private description; promotion
preserves that evidence under ADR-0006. A standing month-end window, old-year date, image-derived
day without a named current year, or Owner estimate remains `provisional` in the Profile's Known
Gaps and a verification Task. It is never promoted as a confirmed deadline. A Calendar **planning
marker** may represent that provisional window only when both title and description say
`Provisional`, the description cites its standing source and points to the verification Task, and
neither title nor description calls it a deadline.

The project gets one exact Google Tasks list, using configured `taskListTitle` or the project folder
name, and its register mirrors that list under ADR-0008. Initial provisioning is deliberately
small: only work that is ready to do becomes a Task; the Research map, Questions and Deliverable
register are not expanded into a task flood.

## Auditing and lifecycle

**RP-AUDIT-001 (deterministic).** Audit evaluates rules, not exact-tree equality. A rule result is
`pass`, `fail`, `warning`, `manual-review`, `requires-decision` or `not-applicable`; every non-pass
includes evidence and applicability. Missing metadata is unavailable rather than equal.

**RP-AUDIT-002 (deterministic).** Audit checks configured identity, universal and profile-derived
paths, closed Project Admin, Definition/Profile agreement, required pinned documents and templates,
and mount artifacts under their exception. Research contents, claims, meeting prose and
deliverables are not judged for mathematical correctness by structural audit.

A completed audit atomically appends a distinct Research-project observation beneath
`stateRoot/observations/research-projects/<sha256(project-root)>`. Its target is explicitly a
Research project and records the stable project key, selected profile and resolved project-root
identity. It carries relative inventory metadata, findings and the inventory provider's provenance,
never file contents. Module observations keep their existing Module target and history namespace;
the two schemas are incompatible by design.

The first observation reports actionable findings as new. A later compatible observation reports
new, unchanged and resolved findings; a contract-version change is separate from drift. Corrupt,
incompatible and interrupted history remains inspectable and appears as a diagnostic. A publication
failure preserves its temporary evidence and makes that target operationally failed.

**RP-AUDIT-003 (deterministic).** Active configured Research projects join routine monitoring;
inactive projects are explicit read-only targets. Module monitoring remains scoped by active
semester and is unchanged. One Research project's operational failure does not discard successful
Module or Research-project reports. Observations carry paths and metadata, never project contents,
and live outside git.

**RP-TRANSITION-001 (judgment).** A pre-contract research folder reaches version 1 by inventorying
it read-only, classifying each existing artifact by provenance and drafting an additive destination
plan. Preserve human work and authoritative sources; carry generated aids only as aids; exclude
build output, duplicate exports, transcripts and disposable scratch. Apply only after target-scoped
Owner approval, including an explicit request that names the target and asks for its migration,
through the mounted-write proof in `docs/agents/safe-drive-testing.md`. Definition contract version
moves last, after the target audits conformant.
