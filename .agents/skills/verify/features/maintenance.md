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
The curation CLI journey fills the seeded register example's placeholders and counts its item under the declared integration key.
Domain journeys exercise bounded repository checks, recovery decisions, weekly evidence, curation rederivation and shelf migration.
They inspect resulting records, checkpoints and fixture files and inject failures at existing adapters.
The compiled launcher fixture previews the real installer with an owned config and toolchain `PATH`.
It decodes the emitted plist with `/usr/bin/plutil` on macOS or `/usr/bin/python3` and standard-library `plistlib` on Linux.
Linux CI requires that Python3 decoder. The process regression has no platform skip.
The fixture starts the compiled runner under a fresh minimal scheduler environment, overlaid only with the decoded plist environment.
It runs real `npm ci`, `npm run`, bare `node` and a bare executable outside Node's directory, whose path contains spaces and `&`.
It checks the selected Node executable, custom command output, an unrelated inherited variable and a completed private launcher receipt.

## Gotchas

Repository-repair CLI coverage currently proves argument refusals. Its domain tests do not prove a real model repair or protected GitHub merge.
Curation rederive, textbooks sweep and textbooks migrate currently have domain coverage without compiled CLI journeys.
Textbooks sweep writes a private review sheet and needs no mounted rewrite to produce that sheet.
Do not run live morning maintenance, perform retention or change LaunchAgents merely to verify this map.
Real scheduled recovery and model quality remain separate operational evidence.
The launcher fixture proves installer-to-scheduler transport, not native launchd loading or readiness of the installed TeX and Poppler tools.
