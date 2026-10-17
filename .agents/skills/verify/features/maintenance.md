# Maintenance and curation

The CLI observes maintenance state, coordinates bounded repository repair and maintains curation and textbook records.

## Sub-features

- Morning maintenance preserves Module scope, bounded execution and journal evidence.
- Repository status distinguishes healthy, attention and unobserved results.
- Repository repair respects protected delivery and retained evidence.
- Curation migration and rederivation preserve decision history.
- Textbook catch-up, sweep and migration preview or publish their owned records.

## How to get to it (user POV)

Use the index's routine, curation and textbooks entries.
Inspect effects before invoking them. A check-only operation can still retain private state.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. Use fixture runners and repositories, not the configured morning job.

```sh
node dist/src/cli.js capabilities verify --workflow maintenance --json --log "$aos_proof/maintenance.json"
```

Require a passed outcome. CLI journeys assert maintenance options, read-only status, curation migration and catch-up behavior.
Domain journeys exercise bounded repository checks, recovery decisions, weekly evidence, curation rederivation and shelf migration.
They inspect resulting records, checkpoints and fixture files and inject failures at existing adapters.

## Gotchas

Repository-repair CLI coverage currently proves argument refusals. Its domain tests do not prove a real model repair or protected GitHub merge.
Curation rederive, textbooks sweep and textbooks migrate currently have domain coverage without compiled CLI journeys.
Textbooks sweep writes a private review sheet and needs no mounted rewrite to produce that sheet.
Do not run live morning maintenance, perform retention or change LaunchAgents merely to verify this map.
Real scheduled recovery and model quality remain separate operational evidence.
