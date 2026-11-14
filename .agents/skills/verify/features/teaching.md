# Teaching and cheatsheet releases

Agents locate declared learning materials and use the shipped cheatsheet runtime to prepare, audit, fit, verify and package a release.

## Sub-features

- Learning-material status reports Source Map availability and declared gaps.
- Native exercise selection resolves a module-level Source Map block with explicit multi-unit scope, tutorial pattern and materialized source hashes, without recording coverage or completion.
- Installed router instructions preserve Module and Research-project ownership boundaries.
- The `learn` router also accepts an explicit absolute personal teaching-folder path with existing materialized controls.
- Cheatsheet preparation qualifies source manifests and coverage.
- Release verification and packaging preserve bytes and expose incomplete semantic review.

## How to get to it (user POV)

Use `learning materials`, `learning exercise --root <module-root> --target <block> --json`, or the captured index's cheatsheet operations.
The `learn`, `cheatsheet` and `research-project` routers remain user-invoked. Verification does not start a teaching session.

## Driving it with the compiled CLI

Preconditions: the parent skill's build and fresh doctor succeeded. TeX, `kpsewhich` and Poppler executables are installed.

```sh
npm run cheatsheet-runtime:check > "$aos_proof/teaching-runtime-check.txt" 2>&1
node dist/src/cli.js capabilities verify --workflow teaching --json --log "$aos_proof/teaching.json"
```

Require both the synthetic workflow and cheatsheet journey to pass.
Learning-material tests and preparation API/shipped-helper fixtures assert Source Map order, including numeric keys.
Portable-build fixtures reject host-local inputs and caller search-path dependencies and ignore user latexmk configuration; recorded inputs remain bound to the release and trusted TeX distribution.
CLI journeys assert gap reporting, human/JSON output, read-only behavior, sibling retention and symlink refusal.
Source Map assertions preserve accepted legacy paths. The exercise CLI journey selects a cross-unit review block and refuses unknown units, unavailable, linked or empty sources. Its output names `units`, never an invented single governing `unit`.
Native selection needs no generated candidate or configuration file; generated `module activity` keeps its separate control-evidence boundary.
The subprocess journey invokes the shipped cheatsheet runtime through preparation, audit, fitting, verification and review packaging.
It checks stale sources, interrupted authoring, staged regeneration, explicit reference presentation, frozen mathematics preservation and package retries.
Run the helper doctor through the same executable discovery as verify/package-review.
The navigation fixture compiles the complete shared specimen and checks all eight actual column starts
against the printed orientation/continuation guides; full-page and enlarged-column review remains separate.
Require retained build identity, AUX/log, visible-font XML, full XML including hidden/off-page text and page renders
from a fresh module-relative evidence directory. Every inspected artifact must name the current
TeX/PDF hash; inspect a targeted mutation's actual semantic failure, restore, then require a pass.
The semantic-interface fixture compiles nested breakable blocks, typed example/exercise references,
run-in proof stages, configurable navigation and native body sizes without blank paragraphs.
A package CLI fixture checks exact 16 MiB binary source bytes and provenance.
Publication function tests check partial evidence and preservation of concurrent bytes.

## Gotchas

Fit observations distinguish measured, manual and unknown evidence; fixture inputs remain synthetic.
Source enumeration, prior-content preservation, mathematical sufficiency, selected proof checks,
layout and portability are separate verdicts. Reviewers independently read sources and inspect every
full page plus enlarged columns at the frozen PDF hash. A count, keyword hit or label is not that review.
Installed rollout proof requires per-host file hashes, finder/schema, client catalog and an installed
runtime synthetic journey. A repository-only journey or a schema response cannot establish those.
Do not overwrite module-editable TeX while refreshing pinned procedures.
Compilation and source hashes do not establish mathematical correctness or acceptable rendered pages.
The journey intentionally leaves semantic review unreviewed. Preserve that result.
Router document assertions do not measure the quality of a model-led teaching session.
The personal teaching-folder route has router-text assertions, not an executed teaching session.
Router finder execution assertions require macOS and skip on other platforms.
Missing TeX, `kpsewhich` or Poppler prevents release verification. Record the attempted command and missing executable.
