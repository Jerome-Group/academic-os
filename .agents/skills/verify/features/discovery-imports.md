# Discovery, readiness and importer observations

An agent discovers supported actions and reads importer lifecycle, counts and freshness without running NTULearn.

## Sub-features

- Index and help expose the same supported actions, prerequisites, effects and test mappings.
- Health distinguishes local tools from unobserved credentials and services.
- Configuration validation reads strict UTF-8 JSON into schema-derived local, cohort or service types and reports only shape/version metadata.
- Naming plans resolve accepted metadata against complete candidate and occupied sets without changing artifacts.
- Module inspection reports legacy declarations, exact procedure hashes, ordered reads and refused canonical references without writing history.
- Candidate validation checks a complete canonical module data graph, including references, supersession and ordered activity targets.
- Versioned verification and learning records validate declared source/fragment bindings, local decision scope and assessment arithmetic while preserving historical records.
- Import status reports each declared root, including missing, malformed, stale and failed receipts.
- Import preflight compares active Module declarations with NTULearn course destinations and reports file-wide collisions.
- Offering readiness combines local control, import, learning-material and Task-binding evidence for the active cohort.
- Quality profiles return structured outcomes and preserve private failure evidence.

## How to get to it (user POV)

Use CLI `module inspect --root <physical-module-root>` or `module inspect --config <private-config>` with an explicit configured target.
Use `module validate --root <candidate-module-root> --json` for a separate full data candidate. Legacy and identity-only candidates refuse validation while remaining inspectable.
Use CLI `config validate --config <configuration-file>` for a read-only schema check.
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
The discovery journey checks generated configuration/schema parity, unversioned and version 1 local/cohort/service configurations, strict JSON refusals, redacted errors and unchanged configuration/module/state bytes. It runs the Calendar wizard candidate function against disposable files and proves failed validation preserves the source. It does not run OAuth or the interactive setup flow.
The naming journey checks locale and timezone independence, pinned Unicode collision behavior, semantic
disambiguation, native bundle occupancy, compound extensions, exact calendar days and unchanged fixtures.
Its resolved plans remain explicitly not admitted. Policy 1 requires contract 8 and activation remains pending.
The legacy audit retains its own versioned grammar and the dedicated Textbook exception.
The discovery journey also drives portable and configured module inspection. It checks legacy declaration order and unknown partial claims, canonical envelope reads with incomplete coverage, missing/changed generations, linked heads and unchanged fixture bytes. Canonical target audit refuses before writing observation history.
The same journey validates full candidates through portable and configured CLI routes. It asserts complete role requirements, exact selected byte hashes, duplicate identities, missing and wrong-kind references, supersession cycles and revision blocks crossing unit boundaries. Public cases retain unknown historical target/status, distinguish coverage from unaided understanding and provider state, and cover native metadata, provisional assessments and evidence-backed decisions. Native consistency cases reject malformed raw names and link targets, repeated xattr names, conflicting known inode facts, incoherent roots, missing or nondirectory parents, bundle cycles and impossible calendar dates. Valid controls retain nested nonUTF8 paths, external and dangling links, unknown metadata and disputed alternatives without following links. Fixture manifests prove inspection and candidate validation leave bytes unchanged.
Version2 fixtures retain 18 distinct roles and support 20 role/schema pairs. Only verification and learning-records gain v2 alternatives. Cases cover unsupported pairs, explicit foreign Module/component decisions, numeric versus weighting allocations and preserved historical assessment order. Fragment cases reject contradictory full-extraction and empty hashes across all supported extraction recipes; genuine unobserved subranges remain supported. Require unchanged inputs and matching human/JSON results. V2 reports `verification: not-implemented`; v1 retains its existing output shape.
The mapped CLI journeys assert help parity, unsafe-log refusals, human/JSON import parity and receipt freshness.
The duplicate cohort-mapping importer fixture compares mounted fixture UTF-8 contents before and after.
The duplicate-flag fixture checks argument refusal without a file comparison. Successful import journeys assert output and classifications.
The process-observer journey injects a failing process and a timeout, then proves a successful retry.
Readiness CLI fixtures check ready, attention and unobserved outcomes, simultaneous findings, sibling retention and unchanged mounted/private-state bytes.
Preflight CLI fixtures check exact roots, declaration ambiguity, aliases, collisions, excluded routes and partial evidence against disposable configurations, with unchanged fixture bytes.

## Select local quality checks

Run `fast` for formatting, lint, build and generated schema/runtime parity. `tests` runs every
compiled test, while `privacy` runs the publication assertions. Verification-selection and
rule-coverage changes require `coverage`, including passing behavioral rule evidence. Teaching
and template changes require `templates`, including the synthetic cheatsheet journey. Covered
ownership changes require the formal skill and `formal`. `full` retains the complete gate.

For workflow or prose changes, run relevant checks and compare source bytes with retained proof.
Repeat heavy behavioral, template or formal checks when their source, selection or assertions
change. Record unchanged bindings and the exact earlier evidence when reusing a prior result.
Each platform claim needs an actual run on that platform. Hosted conformance proves no product behavior.

## Gotchas

An index entry marked `mapped` is not a successful run.
A successful `config validate` result proves byte and schema validity only. Filesystem containment, active-cohort consistency, distinct credential roles and provider readiness remain with their existing owners. Unversioned configurations remain supported; validation does not rewrite them or authorize migration.
Generation1 reads cover head, generation and identity only. Generation2 validates the module data graph. Its readiness fields explicitly report publication, workflows, module conformance and migration as unimplemented. Schema and graph validity do not verify native artifact contents, evidence truth or corpus completeness. Legacy observations preserve reported status without asserting completion or mastery.
V2 structural acceptance does not establish extraction provenance, rubric truth, grading accuracy or mathematical proof. Verification compilation, execution and readiness remain separate prerequisites.
Mounted observations reject detected file or ancestor identity changes before returning bytes. The scheduled parent-swap fixture proves that interleaving only; pathname checks do not provide atomic traversal against arbitrary concurrent swaps.
A current receipt proves a producer observation, not exhaustive NTULearn visibility or current attachment bytes.
Readiness covers local controls and recorded Task binding. Live Google access, Task freshness, destination preflight and learning mastery remain unverified.
One failed mounted inspection leaves controls, learning and Tasks unobserved together. The receipt observation and other Modules are still attempted.
Preflight needs explicit NTULearn config and checkout-root paths. Relative config and destination paths resolve against that root. Existing private state remains a prerequisite; the command creates nothing.
Preflight proves route agreement only. Site-to-Module identity, live provider visibility and later sync safety remain unverified.
Only configured health can reject logs targeting a configured academic mount. Always choose private temporary evidence explicitly.
Repeated `--log` destinations refuse rather than overwrite.
