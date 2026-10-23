# How should seed ownership be formally checked?

TLA+ fits the order of seed claims, effects, journal receipts, interruption, retry, and cleanup.
TLC checks the finite model. Compiled public-entry schedules and an actual guard mutation check its connection to TypeScript.
Neither result proves every operating-system interleaving.

Poteto introduced the project-local, area-named formal skill in [cursor/plugins PR 709](https://github.com/cursor/plugins/pull/709).
The workflow requires source mapping, explicit scope, and a scratch change in real code that the generated skill catches.
[PR 721](https://github.com/cursor/plugins/pull/721) adds TLA+ as the event-order default and calls for generated real-code testing when a code-level verifier is unavailable.
The [pinned skill source at d457567](https://raw.githubusercontent.com/cursor/plugins/d457567332aa6989e753ea289f30ea2bfbc80bc0/pstack/skills/create-formal-verification-skill/SKILL.md) was read directly on 2026-10-23.

The selected model keeps filesystem and journal awaits distinct and names the environment that preserves paths during a guarded operation.
Unrestricted syscall swaps and concurrent journal writers remain expected counterexamples.
The runner pins the [official TLA+ 1.7.4 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) by SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`.
The release jar reports TLC 2.19 of 08 August 2024.

The referenced [poteto X post](https://x.com/poteto/status/2113398433977659654) returned HTTP 403 during the coordinator's direct attempt.
Its contents were unavailable. The GitHub sources above support the workflow decision independently.
