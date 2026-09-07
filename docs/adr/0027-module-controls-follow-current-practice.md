# Module controls follow current practice

Contract version 6 treats the current active Module workspaces as evidence for the interface. It
keeps the seven Profile anchors as an ordered subsequence, accepts unique fact sections around
them, reads each anchor's first direct table by named columns, and compares academic years without
making typography significant. Assessment detail columns and either `Evidence` or `Checked`
provenance remain valid; provenance itself remains mandatory.

The Source Map keeps legacy tutorial paths and adds a closed tutorial-block shape. A block records
its own identity, exercises, and typed source locators, including missing-solution evidence. Roles
and mathematical descriptions remain module language rather than a contract enum.

Curation still requires importer paths relative to their declared root. A manual source is different:
integration `user` or a name ending `-manual` marks material supplied outside an importer and may
retain the absolute path where it was observed. That locator is evidence of provenance, not a
portable pointer or an importer root.

## Why the teaching route selects an activity target

A lecture unit may govern several tutorials or papers. Records that name only the governing unit
cannot distinguish those targets, so one record can make unrelated work appear covered. New
records therefore name both `unit` and `target`, plus an honest status. The route selects and
compares the activity target; legacy records are resolved from their source and folder evidence,
and ambiguity returns to the Owner.

A session record proves coverage only. `kind: understanding` still requires an unaided
demonstration and its scope. No route infers mastery from a file's existence.

## Why authorization and preferences change

Authorization for a requested task persists while its routine reversible steps are completed. Each
route declares exact edit regions first and asks only when an unresolved choice changes the result.
This replaces unconditional approval pauses without weakening Owner decisions or importer safety.
It follows OpenAI's [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model)
guidance on scoped authorization, concrete work before clarification, and proportionate verification.

The shared `templates/preferences.md` remains pinned. A standing preference specific to one module
may use `70 Learning/preferences.local.md`, read after the shared file. The overlay is optional and
is created only from actual Owner evidence. A request made in one session remains session evidence,
so no module preference is fabricated.

This supersedes ADR-0015 only where it said a module-specific teaching preference must live in
`CONTEXT.md`. It refines ADR-0017's unit-selection rule to activity-target selection while preserving
the skill's routing-only, user-invoked boundary.

## Consequences

Definitions advance to contract version 6. Existing Profile facts, Source Maps, curation history,
and records remain valid without content rewrites. Shared procedures become ordered routes with
explicit write boundaries, observable completion, proportionate verification, and truthful
closeout. Live migration remains a separate backed-up, journalled operation.
