# Academic OS verification map

The capability index owns action metadata and test mappings. This map groups user journeys and their evidence limits.
Capture a fresh index after building. Inspect the selected action's prerequisites, writes and risk flags before using it.

Use the parent skill's launch and doctor instructions, including its owned fixture directory and temporary-directory environment.
Run a fresh doctor before each feature, with a unique log name. Drive features serially.
Keep raw fixture proof after process teardown. Record each feature as passed, failed or verified-unreachable with its attempted route and missing prerequisite.

| Feature | Existing workflows |
| --- | --- |
| [Discovery, readiness and importer observations](discovery-imports.md) | `discovery`, `imports`, quality profiles |
| [Module and Research-project lifecycle](folder-lifecycle.md) | `recovery` |
| [Tasks, Calendar and Operations](services.md) | `services` |
| [Teaching and cheatsheet releases](teaching.md) | `teaching` |
| [Maintenance and curation](maintenance.md) | `maintenance` |

Full maintenance runs every listed workflow and `capabilities check --profile full`.
Full checks cover repository checks and synthetic fixtures. They do not turn untested or live-only actions into observed behavior.
Interactive `credentials authorize` and `calendar local setup` require the Owner's session and are not invoked by verification.
Synthetic `calendar setup` is covered by services. Full includes the separate bounded formal skill; follow the parent doctor and retention instructions.
