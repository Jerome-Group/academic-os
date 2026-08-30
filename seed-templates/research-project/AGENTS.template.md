# What this folder is

The {{PROJECT_NAME}} Research project folder: the Owner's sources, meetings, mathematics and
deliverables, laid out to a pinned contract. This file is the router. Every piece of work starts at
a route below and runs by its procedure.

## Start here

Read `CONTEXT.md`, `00 Project Admin/00 Project Profile.md` and
`00 Project Admin/10 Project Definition.yaml`. Before creating, naming, moving or placing a file,
read `docs/00 Structure and Naming.md`.

## Routes

Read the route's procedure before acting in its area.

- **Sources** — obtain, classify, cite or read a source:
  `docs/10 Sources and Provenance.md` and `00 Project Admin/20 Source Register.yaml`.
- **Meetings** — prepare for or record a supervisor meeting:
  `docs/20 Research Procedure.md`, using `70 Research/templates/meeting-note.md`.
- **Research** — definitions, examples, proof attempts, proofs and experiments:
  `docs/20 Research Procedure.md` and `00 Project Admin/40 Research Map.yaml`.
- **Learning** — work through a source until the Owner can reconstruct it:
  `docs/20 Research Procedure.md`, with reading work in `70 Research/10 Reading/`.
- **Deliverables** — plan, draft, check or record a programme output:
  `docs/30 Deliverables Procedure.md` and `00 Project Admin/50 Deliverable Register.yaml`.
- **Tasks** — project work goes through the academic-os task tools and mirrors into
  `00 Project Admin/30 Task Register.yaml`. A Task carries a do-date; a deadline is a Calendar
  milestone. Use existing registered identities for `source`, `claim`, `meeting` and `deliverable`;
  use `Academic/<event-id>` for a milestone already named by its Deliverable row. Preserve those
  pointers when changing the Task. When the tools are absent, the operation parks.
- **Maintenance** — structure, profile, definition or project-language changes:
  `docs/00 Structure and Naming.md`, `CONTEXT.md` and `docs/adr/`.

## Domain language

`CONTEXT.md` is this project's organisational language; `70 Research/GLOSSARY.md` is the
mathematics speaking. A term that changes where an artifact goes or how it is named belongs in
`CONTEXT.md`; a term from the subject belongs in the Research glossary. Consult both and
`docs/adr/` before classifying, naming or organising content.

A project ADR records a standing rule the contract does not force, whose reversal would strand
records built on it. Number it locally from `0001`; supersede it with a new ADR rather than editing
it.

## Safety

The Owner authors the mathematics and every assessed artifact. Agents locate, explain, ask,
compile, check and critique. Candidate agent-written mathematics stays in `.scratch/` until the
Owner reconstructs or rewrites it, verifies its citations and chooses to adopt it. Record material
assistance the Owner adopts in `00 Project Admin/60 Contribution and AI Use.md`.

Primary sources outrank summaries. A generated aid may point to a source and lives in Resources;
it never supports a Claim. Work no route covers parks for the Owner with its ambiguity named.

## Updating these instructions

This file and the four numbered docs are pinned: their text is the contract's, identical in every
Research project except for the project-name interpolation. Project-specific knowledge lives in
`CONTEXT.md`, `docs/adr/`, the Profile or a register.

Draft a change to a standing instruction or domain document with the writing-for-agents discipline.
A pinned change begins in academic-os's canonical seed source; never edit this project's pinned copy
directly. Show the Owner the exact new wording when they are present; unattended domain-document
changes follow the contract's gate and are surfaced in the run report. Mechanical register writes
follow their own route and are not instruction changes.
