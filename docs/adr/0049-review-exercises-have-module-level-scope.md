# Review exercises have module-level scope

A finals review sheet can span several Lecture-units. Placing it under one unit loses scope;
calling it a past examination or numbered tutorial invents an academic identity.

Native Source Maps therefore accept optional ordered `exercise_sets`, using structured tutorial
blocks plus explicit `units` references. Blocks retain the source's review identity. Issued finals
review questions and hints live flat in Finals; attempts, feedback, solutions and concepts use the
existing tutorial workspace and templates. New exercise records carry `units`; single-unit records
remain unchanged. Partial question work records its exact locator and never completes a whole set.

Contract 9 adds this optional representation. Contract 8 native modules remain readable and
conformant without a forced rewrite. The generated module-data/1 publisher remains its separate,
frozen contract-8 interface; it does not gain native exercise execution by inference.

`learning exercise` selects an exact native block and checks its scope and materialized source
bytes read-only. It creates neither coverage nor task completion. The teaching procedure owns the
subsequent human study session. This is a selector, not an autonomous teaching or grading engine.

Task provenance is local state Google cannot edit or return. Direct `tasks_change` merges supplied
provenance keys after live task verification and preserves omitted keys. A local write failure is
unverified. Supplied notes patch only notes in Google; status, date and ID need not change.
Explicit immutable task-plan/1 operations retain their existing schema and policy boundary.
