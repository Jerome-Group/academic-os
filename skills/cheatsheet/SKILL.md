---
name: cheatsheet
description: Create, revise, audit, verify or package-review one module cheatsheet under its pinned procedure.
disable-model-invocation: true
argument-hint: "<module code> <create|revise|audit|verify|package-review> [artifact or constraints]"
---

# Cheatsheet

Route the Owner's requested cheatsheet operation into one module. Conduct lives in the selected
module's pinned procedure; follow that procedure when this route and it differ.

## 1. Find the module

Run `scripts/find-candidates.zsh <module code>`. It searches the two standard macOS Drive mounts and
deduplicates resolved paths. A module code comes from the invocation. Ask when none or more than one
distinct module is found; otherwise state the resolved folder.

Completion: exactly one module folder is selected.

## 2. Load local authority

Read the selected folder's `AGENTS.md`, `00 Module Admin/00 Module Profile.md`,
`00 Module Admin/10 Module Definition.yaml`, `00 Module Admin/40 Source Map.yaml` and
`docs/40 Cheatsheet Procedure.md`. Follow further pointers only for branches the requested operation
reaches.

Completion: the requested operation, artifact if supplied, user constraints and applicable local
instructions are identified.

## 3. Run the operation

Select exactly one of `create`, `revise`, `audit`, `verify` or `package-review` from the invocation
and run it through the pinned procedure. Use this skill's bundled
`scripts/cheatsheet-tool.mjs`; it needs Node 24, the selected module root and no repository checkout
or Academic OS configuration. Run `scripts/cheatsheet-tool.mjs schema` before creating evidence;
`references/manifest-example.yaml` is the complete synthetic manifest shape. The executable audits
manifest/source/release correspondence, plans fitting from a measurement JSON file, verifies the
portable release and builds a verified review package. Ask only if the invocation does not identify
an operation or the procedure exposes a material unresolved choice.

Completion: the procedure's completion criterion for the selected operation is satisfied and the
handoff names the release pair and exact verification/review state.
