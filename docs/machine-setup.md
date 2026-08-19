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

The MagicDNS name is the mini's. Confirm the registration by listing the tools: four `tasks_*`
tools mean the machine is done.

Reachability on the Tailnet is the whole of the authorisation, which is why there is no third
item: a machine signed in to Tailscale is one of the Owner's, and one that is not reaches nothing
(`docs/adr/0011-…`).

## When the mini is unreachable

Task operations fail visibly and park. There is no offline queue and no local fallback: the live
list is the authority, and a machine that cannot reach it has nothing true to say about the
module's tasks. Park the operation, say so, and let the next reachable session make it.

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
