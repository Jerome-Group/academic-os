---
name: learn
description: Teach the Owner one unit of a module — explain, then check by asking for something back — in that module's own Teaching workspace.
disable-model-invocation: true
argument-hint: "<module code> [what to work on]"
---

# Learn

The Owner wants to be taught one unit of a module.

This file is a **route**, and it ends at step 4. How a session is conducted — what it produces,
where an artifact goes, what a record holds, how anything is compiled, what earns an entry in the
Revisit register — is in the module folder's own pinned documents. You read those in step 2 and
run the session under them. Where they and this file could be read as disagreeing, they win, and
this file is the one that is wrong.

**The module folders are the whole of what this needs.** No configuration file, no clone of the
system that seeded them, no credential, no toolchain. A machine with the folders can run a session;
a machine without them has nothing to teach from.

## 1. Find the module folder

A module folder is a directory named exactly the module code the Owner gave, one level inside a
semester folder, inside `Modules/` on their Drive. Search both places macOS mounts a Drive:

```sh
"$HOME"/Library/CloudStorage/GoogleDrive-*/My\ Drive/Modules/*/<module code>
/Volumes/*/My\ Drive/Modules/*/<module code>
```

A machine can have both, pointing at one Drive, so compare the paths **resolved** rather than as
written — one folder reached two ways is one folder.

The code comes from the Owner's invocation; the folder comes from the search. The working
directory is not part of this — `/learn` runs the same from anywhere, including from inside a
different module.

Stop and ask when the search finds nothing, or finds two folders that are genuinely different.
Then say the folder it found once, so the Owner sees which one the session is in before it
starts.

## 2. Read the folder's own instructions

Read all of these out of the folder you just resolved, every session, however familiar they look.
They are the module's, not this skill's, and a remembered copy is a stale one:

- `AGENTS.md` — the module's router. It names what to read before acting in an area; read those
  too, as it says to
- `docs/20 Teaching Procedure.md` — how a session is conducted and what it leaves behind
- `70 Learning/templates/preferences.md` — how the Owner is taught
- `00 Module Admin/40 Source Map.yaml` — the units, and which files each one means

## 3. Propose the unit, and ask when it is not obvious

The Owner's invocation says what kind of work this is, and the procedure maps that to one activity
area. Ask which when the invocation does not say — the areas are not interchangeable, and each
keeps its own records.

Then read the units that area's existing records name, and diff them against the Source map's unit
keys. The proposal is the earliest key the records do not cover.

**Ask instead of choosing** when the area has no records, when the Source map declares no units,
or when more than one key has an equal claim. A first session in an area is the ordinary case of
this, not an error: there is nothing to read off, so the Owner says where to start.

Say which unit the session is on before work begins. An invocation that already named one still
has to resolve to a key the Source map holds — say which key it resolved to, and ask when it
matches none.

## 4. Run the session

Under the procedure and the preferences you read in step 2, on the unit step 3 settled, with the
Owner in the room throughout.
