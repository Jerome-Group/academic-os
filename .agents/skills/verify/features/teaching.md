# Teaching and cheatsheet releases

Agents locate declared learning materials and use the shipped cheatsheet runtime to prepare, audit, fit, verify and package a release.

## Sub-features

- Learning-material status reports Source Map availability and declared gaps.
- Installed router instructions preserve Module and Research-project ownership boundaries.
- The `learn` router also accepts an explicit absolute personal teaching-folder path with existing materialized controls.
- Cheatsheet preparation qualifies source manifests and coverage.
- Release verification and packaging preserve bytes and expose incomplete semantic review.

## How to get to it (user POV)

Use `learning materials` or the captured index's cheatsheet operations.
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
The subprocess journey invokes the shipped cheatsheet runtime through preparation, audit, fitting, verification and review packaging.
It checks stale sources, interrupted authoring and package retries.
A package CLI fixture checks exact 16 MiB binary source bytes and provenance.
Publication function tests check partial evidence and preservation of concurrent bytes.

## Gotchas

Fit measurements in the synthetic journey are fixture inputs.
Compilation and source hashes do not establish mathematical correctness or acceptable rendered pages.
The journey intentionally leaves semantic review unreviewed. Preserve that result.
Router document assertions do not measure the quality of a model-led teaching session.
The personal teaching-folder route has router-text assertions, not an executed teaching session.
Router finder execution assertions require macOS and skip on other platforms.
Missing TeX, `kpsewhich` or Poppler prevents release verification. Record the attempted command and missing executable.
