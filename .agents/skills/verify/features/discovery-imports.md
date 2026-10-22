# Discovery, readiness and importer observations

An agent discovers supported actions and reads importer lifecycle, counts and freshness without running NTULearn.

## Sub-features

- Index and help expose the same supported actions, prerequisites, effects and test mappings.
- Health distinguishes local tools from unobserved credentials and services.
- Import status reports each declared root, including missing, malformed, stale and failed receipts.
- Import preflight compares active Module declarations with NTULearn course destinations and reports file-wide collisions.
- Offering readiness combines local control, import, learning-material and Task-binding evidence for the active cohort.
- Quality profiles return structured outcomes and preserve private failure evidence.

## How to get to it (user POV)

Use CLI `--help`, `capabilities index`, `capabilities health`, `capabilities check`, `imports status`, `imports preflight` or `offering readiness`.
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
Readiness CLI fixtures check ready, attention and unobserved outcomes, simultaneous findings, sibling retention and unchanged mounted/private-state bytes.
Preflight CLI fixtures check exact roots, declaration ambiguity, aliases, collisions, excluded routes and partial evidence against disposable configurations, with unchanged fixture bytes.

## Gotchas

An index entry marked `mapped` is not a successful run.
A current receipt proves a producer observation, not exhaustive NTULearn visibility or current attachment bytes.
Readiness covers local controls and recorded Task binding. Live Google access, Task freshness, destination preflight and learning mastery remain unverified.
One failed mounted inspection leaves controls, learning and Tasks unobserved together. The receipt observation and other Modules are still attempted.
Preflight needs explicit NTULearn config and checkout-root paths. Relative config and destination paths resolve against that root. Existing private state remains a prerequisite; the command creates nothing.
Preflight proves route agreement only. Site-to-Module identity, live provider visibility and later sync safety remain unverified.
Only configured health can reject logs targeting a configured academic mount. Always choose private temporary evidence explicitly.
Repeated `--log` destinations refuse rather than overwrite.
