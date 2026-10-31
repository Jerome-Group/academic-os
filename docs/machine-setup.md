# Setting up a machine

What a Mac needs before an agent working in a module folder can run the degree's work from it.
The mini is the exception: it runs the Operations server rather than reaching one, and its setup
is the Operations server section of `operator-guide.md`.

## The second-machine checklist

Two items. Nothing else travels — no Node, no clone of this repository, no credential file.

1. **Sign in to Tailscale**, so the machine joins the Tailnet the mini serves on.
2. **Register the Operations server once, at user scope.** For Claude Code:

   ```sh
   claude mcp add --scope user --transport http academic-os \
     http://<mini-magicdns-name>:8765/mcp
   ```

   Any other MCP client registers the same URL in whatever way it registers an HTTP server.

The MagicDNS name is the mini's. Refresh the client's tool catalog after connecting or upgrading;
the server does not push catalog changes. Call `tasks_sync_capabilities` with no arguments and
require `task-plan/1`, the read tools `tasks_read_register` and `research_tasks_read_register`,
the apply tool `tasks_apply_plan`, and the advertised `plan_json` compatibility argument. An old
server or cached schema is a migration requirement, never permission for a fallback write.

Both target types retain their create/change/complete names, but writes now require an immutable
plan from a fresh register read. Module calls name `semester` and `module`; Research calls name
`research_project`. The read returns exact target/list identity and `expectedSnapshot`. Cloud
planning supplies intent and `policyVersion`; the caller persists `operationId` and, for creation,
`sourceOccurrenceId` before dispatch. See the folder router's Tasks protocol and the Operations
section of `operator-guide.md`. Verify all six compatibility names against their refreshed schemas
using isolated fixtures before enabling writes. Real provider acceptance needs scoped authority.

API writes support undated creation, title changes and explicit completion/cancellation. New
notes/descriptions and plans containing `doDate` or `timing` are refused. Owner-authorized native
date/time placement may be delegated only to an already authorized UI executor with fresh complete
preflight, exact account/list/task IDs or verified aliases, surface/timezone/time observations and
same-ID Task saved-field readback. Contradictory observations or unavailable support park that work;
date-only API results cannot prove timing, infer an offset or justify an ordinary-event replacement.
API success and native acceptance remain separate. This setup grants no UI execution authority.

Reachability on the Tailnet is the whole of the authorisation, which is why there is no third
item: a machine signed in to Tailscale is one of the Owner's, and one that is not reaches nothing
(`docs/adr/0011-…`).

## When the mini is unreachable

Before dispatch, an unreachable operation parks visibly. There is no offline queue or local
fallback. After dispatch, a lost response may conceal a provider mutation: retain the identical
plan, operation ID and uncertain evidence. The next reachable session reconciles that operation
before any resend or replacement. It never treats lost connectivity as proof that nothing happened.

## Optional: make the machine teaching-capable

A machine that runs teaching sessions compiles the seeded LaTeX templates, which needs a full
TeX distribution:

1. Install **full MacTeX** — the templates use a stock full distribution's packages, and a
   minimal installation is the one that fails mid-session.
2. Confirm `latexmk` is on `PATH`:

   ```sh
   latexmk -version
   ```

A machine without it still runs teaching sessions: the session writes the `.tex`, parks the PDF,
and notes the parked PDF in the Learning record. The next session on a capable machine compiles
the stragglers when it opens the unit folder. Making a machine teaching-capable is this setup
step and never something an agent does mid-session.

## Optional: install the `/learn` skill

`/learn` starts a teaching session from any directory rather than only from the module folder.
What it is and what it may carry is
[ADR-0017](adr/0017-the-teaching-skill-routes-and-the-pinned-procedure-rules.md); this is the
install.

**It adds nothing to the checklist above.** The skill is two files, and it reads the module folders
and nothing else — no clone of this repository, no configuration, no credential. A machine that
syncs the folders is already able to run it. Copy the skill into each harness's user-scope skills
directory:

```sh
for harness in .claude .codex; do
  rsync -a "<clone>/skills/learn/" "<machine>:~/$harness/skills/learn/"
done
```

Updating it is the same command again — a copy has no `git pull`, so a skill edit reaches a machine
when someone sends it. A machine that holds the repository for other reasons may symlink
`skills/learn` into those directories instead, and the mini does.

Any further harness takes the same directory wherever it keeps user-scope skills, and gets its own
manifest beside `SKILL.md` if it needs one to know the skill fires only when the Owner says so.

## Optional: install the `/cheatsheet` skill

`/cheatsheet <module code> <operation>` discovers one synced Module and hands create, revise, audit,
verify or package-review to its pinned Cheatsheet procedure. Its boundary is
[ADR-0029](adr/0029-cheatsheet-releases-are-source-led-and-portable.md). Install or update the same
way as `/learn`. The copied directory includes the Node 24 helper runtime; it does not use a clone or
Academic OS configuration:

```sh
for harness in .claude .codex; do
  rsync -a "<clone>/skills/cheatsheet/" \
    "<machine>:~/$harness/skills/cheatsheet/"
done
```

Verify the installed interface with
`~/.codex/skills/cheatsheet/scripts/cheatsheet-tool.mjs schema` (and the corresponding `.claude`
path). The command reports every operation and required input.

## Optional: install the `/research-project` skill

`/research-project <project identity> [-- what to work on]` starts from any directory, discovers
one synced folder below `Modules/Research/`, and hands the work to that project's own router. It
does not replace `/learn`: `/learn` resolves a Module and always enters its Teaching workspace,
while a Research project selects among the routes its `AGENTS.md` currently declares. The split
is [ADR-0025](adr/0025-research-project-work-has-its-own-user-invoked-router.md).

The installation has the same boundary as `/learn`: one self-contained directory, no clone,
system configuration or credential required on the target machine. Copy it into each harness's
user-scope skills directory:

```sh
for harness in .claude .codex; do
  rsync -a "<clone>/skills/research-project/" \
    "<machine>:~/$harness/skills/research-project/"
done
```

Updating it repeats that command. A machine that already holds the repository may symlink the
directory instead.

For Task recovery history, coverage inspection, approved recreation or interrupted restore, follow [Task recovery](task-recovery.md). Existing refresh and task-plan/1 clients establish snapshots through the same installed services; no additional job or credential is required.
