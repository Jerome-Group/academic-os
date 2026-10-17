# Discovery and importer observations

An agent discovers supported actions and reads importer lifecycle, counts and freshness without running NTULearn.

## Sub-features

- Index and help expose the same supported actions, prerequisites, effects and test mappings.
- Health distinguishes local tools from unobserved credentials and services.
- Import status reports each declared root, including missing, malformed, stale and failed receipts.
- Quality profiles return structured outcomes and preserve private failure evidence.

## How to get to it (user POV)

Use CLI `--help`, `capabilities index`, `capabilities health`, `capabilities check` or `imports status`.
The captured index supplies their current invocation and prerequisites.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. Use synthetic importer roots, never an NTULearn live sync.

```sh
node dist/src/cli.js --help > "$aos_proof/help.json"
node dist/src/cli.js capabilities verify --workflow discovery --json --log "$aos_proof/discovery.json"
node dist/src/cli.js capabilities verify --workflow imports --json --log "$aos_proof/imports.json"
node dist/src/cli.js capabilities check --profile full --json --log "$aos_proof/full.json"
```

Require passed outcomes for verification and profile results. Help returns `indexed`; health returns `observed`.
The mapped CLI journeys assert help parity, unsafe-log refusals, human/JSON import parity and receipt freshness.
The duplicate-target refusal journey compares file bytes. Successful import journeys assert output and classifications.
The process-observer journey injects a failing process and a timeout, then proves a successful retry.

## Gotchas

An index entry marked `mapped` is not a successful run.
A current receipt proves a producer observation, not exhaustive NTULearn visibility or current attachment bytes.
Only configured health can reject logs targeting a configured academic mount. Always choose private temporary evidence explicitly.
Repeated `--log` destinations refuse rather than overwrite.
