# Tasks, Calendar and Operations

The CLI and Operations server read and update target-specific Tasks and Calendar state, with explicit proposals and verified refresh.

## Sub-features

- Task list provisioning, refresh and operations preserve exact Module or Research-project identity.
- Calendar setup and refresh preserve ownership, while proposals and promotion check conflicts.
- Operations serves structured task tools through HTTP and enforces its listening-address boundary.
- Scheduler installers preview jobs and replace only their owned LaunchAgents.

## How to get to it (user POV)

Use the index's Tasks, Calendar, Operations and schedule entries.
MCP task tools require a configured Operations server and exact target.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. Provider fixtures and temporary launchd homes isolate external effects.
The HTTP fixtures require IPv4 and IPv6 loopback TCP access.

```sh
node dist/src/cli.js capabilities verify --workflow services --json --log "$aos_proof/services.json"
```

Require a passed outcome. CLI journeys preload fake Google providers at the production adapter boundary and assert stored provider state and refreshed files.
They cover task mutations, Calendar proposal/promotion and failure handling.
Operations journeys open an owned temporary HTTP listener, call it and close it.
Scheduler journeys use a recording launchctl adapter and inspect the produced plist and replacement order.

## Gotchas

Synthetic Google state does not establish real authorization, account data or live service availability.
The temporary HTTP service uses an injected echo tool. Task tools have separate domain tests.
This does not prove the production resident server against Google.
In the known TCP-denying repository sandbox, `ACADEMIC_OS_REPOSITORY_FIXTURE_TRANSPORT=unix` selects Unix sockets and asserts default TCP fails with `EPERM`.
Record that narrower transport evidence. Do not use the override on a normal host to bypass a failure.
Real launchd installation, Tailnet reachability and scheduled host PATH require an authorized macOS-host pass.
Interactive credential and Calendar-local setup commands have no synthetic journey.
