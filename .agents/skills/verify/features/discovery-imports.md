# Discovery, readiness and importer observations

An agent discovers supported actions and reads importer lifecycle, counts and freshness without running NTULearn.

## Sub-features

- Index and help expose the same supported actions, prerequisites, effects and test mappings.
- Health distinguishes local tools from unobserved credentials and services.
- Naming plans resolve accepted metadata against complete candidate and occupied sets without changing artifacts.
- Module inspection reports legacy declarations, exact procedure hashes, ordered reads and refused canonical references without writing history.
- Import status reports each declared root, including missing, malformed, stale and failed receipts.
- Import preflight compares active Module declarations with NTULearn course destinations and reports file-wide collisions.
- Offering readiness combines local control, import, learning-material and Task-binding evidence for the active cohort.
- Quality profiles return structured outcomes and preserve private failure evidence.

## How to get to it (user POV)

Use CLI `module inspect --root <physical-module-root>` or `module inspect --config <private-config>` with an explicit configured target.
Use CLI `naming plan --input <private-json> --json` for naming proposals. The discovery workflow also
drives configured Operations through local HTTP with the official MCP SDK.
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
The naming journey checks locale and timezone independence, pinned Unicode collision behavior, semantic
disambiguation, native bundle occupancy, compound extensions, exact calendar days and unchanged fixtures.
Its resolved plans remain explicitly not admitted. Policy 1 requires contract 8 and activation remains pending.
The legacy audit retains its own versioned grammar and the dedicated Textbook exception.
The discovery journey also drives portable and configured module inspection. It checks legacy declaration order and unknown partial claims, canonical envelope reads with incomplete coverage, missing/changed generations, linked heads and unchanged fixture bytes. Canonical target audit refuses before writing observation history.
The mapped CLI journeys assert help parity, unsafe-log refusals, human/JSON import parity and receipt freshness.
The duplicate cohort-mapping importer fixture compares mounted fixture UTF-8 contents before and after.
The duplicate-flag fixture checks argument refusal without a file comparison. Successful import journeys assert output and classifications.
The process-observer journey injects a failing process and a timeout, then proves a successful retry.
Readiness CLI fixtures check ready, attention and unobserved outcomes, simultaneous findings, sibling retention and unchanged mounted/private-state bytes.
Preflight CLI fixtures check exact roots, declaration ambiguity, aliases, collisions, excluded routes and partial evidence against disposable configurations, with unchanged fixture bytes.

## Gotchas

An index entry marked `mapped` is not a successful run.
A supported canonical envelope read covers head, generation and module identity only. Full canonical conformance, workflows and migration remain unavailable. Legacy observations preserve reported status without asserting completion or mastery.
Mounted observations reject detected file or ancestor identity changes before returning bytes. The scheduled parent-swap fixture proves that interleaving only; pathname checks do not provide atomic traversal against arbitrary concurrent swaps.
A current receipt proves a producer observation, not exhaustive NTULearn visibility or current attachment bytes.
Readiness covers local controls and recorded Task binding. Live Google access, Task freshness, destination preflight and learning mastery remain unverified.
One failed mounted inspection leaves controls, learning and Tasks unobserved together. The receipt observation and other Modules are still attempted.
Preflight needs explicit NTULearn config and checkout-root paths. Relative config and destination paths resolve against that root. Existing private state remains a prerequisite; the command creates nothing.
Preflight proves route agreement only. Site-to-Module identity, live provider visibility and later sync safety remain unverified.
Only configured health can reject logs targeting a configured academic mount. Always choose private temporary evidence explicitly.
Repeated `--log` destinations refuse rather than overwrite.
