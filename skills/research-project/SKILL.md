---
name: research-project
description: Route work into one synced academic-os Research-project folder and its own live procedures.
disable-model-invocation: true
argument-hint: "<project identity> [-- what to work on]"
---

# Research project

The Owner wants to work in one Research-project folder.

This file is a route. It finds the project and then yields to that folder's router and procedures.
It carries no research conduct of its own; where this file and a project control disagree, the
project control wins and this file is wrong.

## 1. Find the candidates

Run this skill's bundled `scripts/find-candidates.zsh`. It searches both places macOS mounts a
Drive for directories immediately below `Modules/Research/`:

`$HOME/Library/CloudStorage/GoogleDrive-*/My Drive/Modules/Research/*` and
`/Volumes/*/My Drive/Modules/Research/*`.

The helper keeps only directories containing `00 Project Admin/10 Project Definition.yaml`,
resolves aliases and prints each resolved path once. Do not use the working directory or
configuration from the system that seeded them.

A machine can expose one Drive through both mount families. Compare every resolved candidate path,
so one folder reached by two aliases remains one candidate.

## 2. Select the project

Text before the first standalone `--` is the project identity. Text after it is the work request;
when there is no `--`, the whole invocation is the identity and no work was supplied.

Read each candidate's Project Definition. If any Definition cannot be read or parsed, stop and name
that candidate—the discovery set is not trustworthy. Match the invocation's project identity
against the Definition's `project.folder`, `project.key` and `project.title`, as well as the folder
basename.
Compare case-insensitively after trimming and treating runs of spaces, hyphens and underscores as
the same separator. Do not use a partial or fuzzy match.

Stop and ask when nothing matches or when matching leaves folders that are genuinely different.
Say the selected folder once before doing project work.

## 3. Load the project's controls

Read these from the selected folder every session:

- `AGENTS.md`
- `CONTEXT.md`
- `00 Project Admin/00 Project Profile.md`
- `00 Project Admin/10 Project Definition.yaml`

The first file is the live router. Follow its Start-here reads, including
`docs/00 Structure and Naming.md` before any file operation. Remembered project rules are stale
rules.

## 4. Choose the route

Map the requested work to exactly one route named by the live `AGENTS.md`: Sources, Meetings,
Research, Learning, Deliverables, Tasks or Maintenance. Read every document that route names,
including its register or template, before acting.

Ask which route when the request genuinely fits more than one or names no meaningful area. Do not
invent a route or use `/learn`: that skill resolves Module teaching workspaces, not Research
projects.

## 5. Work under the route

Run the requested work under the live router, its Safety section and the procedure loaded in step
4. Put every artifact, register change and parked result where those controls say. End this skill's
authority here.
