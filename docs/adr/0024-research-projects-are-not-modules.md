# Research projects are a distinct aggregate

A **Research project** is configured, seeded and audited beside a Module, not as one. It has its
own identity and contract while reusing the same mounted-write safety, task-authority and
calendar-authority boundaries.

## Why the distinction matters

A Module is a taught unit identified by a module code, organised inside a semester and universally
fed by an NTULearn mirror. A research project may cross semesters, be named in a programme's
language, begin without an importer and derive its outputs from a programme profile. Making a
research project satisfy the module contract would weaken those Module meanings or fill the
project with structures whose absence is real information.

The opposite extreme—an informal folder outside conformance—loses the parts worth sharing:
additive seeding, stable controls, pinned local instructions, provenance, safe mounted writes, a
dedicated task register and read-only audit. Those are system properties rather than Module
properties.

## The boundary

`docs/research-project-folder-contract.md` is the normative interface for Research project folders.
Configuration declares their containing root and exact folder separately from semester Modules.
The project Definition declares one closed profile; that profile derives its additional
deliverable and resource directories. It does not restate a free-form structure.

The universal research tree follows the module system's numbered, routed shape but uses the work's
own centres: project controls, sources, supervisor meetings, deliverables and Research. It seeds no
importer. A later integration adds a source surface only through a new contract decision.

The Project Profile, Definition, registers, research content and deliverables remain outside git
under the publication boundary in ADR-0002. Only the contract and generic seed sources live here.

## Consequences

- Existing module identity, configuration, seed, audit, Tasks and NTULearn behavior remain intact.
- Research projects join the monitoring and operations surfaces only through explicit
  research-project targets.
- One Google Tasks list may share the project's exact folder name without making the project a
  Module. Its register is still a pull-owned mirror under ADR-0008.
- Confirmed research deadlines remain Calendar milestones under ADR-0006. A standing window or
  inferred date remains a gap until its exact current source is verified.
- URECA and future FYP support are profiles over the same research core. FYP-only thesis,
  presentation, repository and embargo rules stay out of the URECA and generic profiles.

## Revisit when

A research integration owns a stable mirror that several projects actually use. That is the case
for designing an importer interface; the mention of an online course site is not.

A programme cannot be expressed as profile-derived deliverable and resource directories. That
reopens the closed profile model before project Definitions begin carrying arbitrary structure.
