---
name: learn
description: Teach the Owner one unit of a module — explain, then check by asking for something back — in that module's own Teaching workspace.
disable-model-invocation: true
argument-hint: "<module code> [unit]"
---

# Learn

The Owner wants to be taught one unit of a module.

This file is a **route**, and it ends at step 4. How a session is conducted — what it produces,
where an artifact goes, what a record holds, how anything is compiled, what earns an entry in the
Revisit register — is in the module folder's own pinned documents. You read those in step 2 and
run the session under them. Where they and this file could be read as disagreeing, they win, and
this file is the one that is wrong.

## 1. Resolve the module folder

Read `$HOME/.config/academic-os/academic-os.config.json`. The module folder is `driveMount`, then
the `root` of the semester whose `modules` list holds the module code, then the module code
itself.

The code comes from the Owner's invocation; the path comes from that file. The working directory
is not part of this — `/learn` runs the same from anywhere, including from inside a different
module.

Stop and ask when the code is in no semester's list, in more than one, or the resolved folder is
not there. Then say the resolved path once, so the Owner sees which folder the session is in
before it starts.

## 2. Read the folder's own instructions

Read all of these out of the folder you just resolved, every session, however familiar they look.
They are the module's, not this skill's, and a remembered copy is a stale one:

- `AGENTS.md` — the module's router, and the entry point the rest of them presume
- `docs/20 Teaching Procedure.md` — how a session is conducted and what it leaves behind
- `70 Learning/templates/preferences.md` — how the Owner is taught
- `CONTEXT.md` and `00 Module Admin/00 Module Profile.md` — this module's language and what it is
- `00 Module Admin/40 Source Map.yaml` — the units, and which files each one means

## 3. Propose the unit, and ask when it is not obvious

Take the activity area the procedure gives for the kind of work the Owner asked for. Read the
units its existing records name, and diff them against the Source map's unit keys. The proposal is
the earliest key the records do not cover.

**Ask instead of choosing** when the area has no records, when the Source map declares no units,
or when more than one key has an equal claim. A first session in an area is the ordinary case of
this, not an error: there is nothing to read off, so the Owner says where to start.

Put the proposal to the Owner and get their yes before any work begins — including when the
invocation already named a unit, since the name still has to resolve to a key the Source map
holds.

## 4. Run the session

Under the procedure and the preferences you read in step 2, on the unit the Owner just agreed to,
with the Owner in the room throughout.
