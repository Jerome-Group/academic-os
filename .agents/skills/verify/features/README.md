# Academic OS verification map

The capability index owns action metadata and test mappings. This map groups user journeys and their evidence limits.
Capture a fresh index after building. Inspect the selected action's prerequisites, writes and risk flags before using it.

Use the parent skill's launch and doctor instructions, including its owned fixture directory and temporary-directory environment.
Run a fresh doctor before each feature, with a unique log name. Drive features serially.
Keep proof after fixture cleanup. Record each feature as passed, failed or verified-unreachable with its attempted route and missing prerequisite.

| Feature | Existing workflows |
| --- | --- |
| [Discovery, readiness and importer observations](discovery-imports.md) | `discovery`, `imports`, quality profiles |
| [Module and Research-project lifecycle](folder-lifecycle.md) | `recovery` |
| [Tasks, Calendar and Operations](services.md) | `services` |
| [Teaching and cheatsheet releases](teaching.md) | `teaching` |
| [Maintenance and curation](maintenance.md) | `maintenance` |

Full maintenance runs every listed workflow and `capabilities check --profile full`.
Full checks cover repository checks and synthetic fixtures. They do not turn untested or live-only actions into observed behavior.
Interactive credential authorization and local Calendar setup require the Owner's interactive session and are not invoked by verification.
