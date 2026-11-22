---
name: cheatsheet-review
description: Verify changes to cheatsheet semantic emphasis, the second-pass review procedure or exact reviewed-PDF binding.
---

# Cheatsheet review

A revised PDF needs its own source and print checks. A lost underline can make a proof or solution
hard to find. An older review can certify the wrong sheet.

## Run

Use the project [verify skill](../verify/SKILL.md) for prerequisites and evidence. Run from the
repository root after building, with an owned temporary directory.

```sh
node --test dist/test/cheatsheet/{semantic-emphasis,manifest-coverage-fit}.test.js
```

Copy this directory's `CheatsheetReview.tla`, `CheatsheetReview.cfg` and `view.mjs` into owned
scratch. Use pstack `/statechart` to check and read the model with the repository's pinned TLC
and Java 21. Read the pinned tool identity from [seed ownership](../seed-ownership/SKILL.md).
Require both invariants and deadlock checking to pass. Retain the report and shortest paths.

## Coverage and mutations

- `CurrentChecks` models the print and source passes in the pinned Cheatsheet Procedure. It
  tracks two revisions of a color PDF, three observations in any order, and one edit before or after
  freeze. An edit clears the observations. Set `SkipGrayscale = TRUE` in a scratch config to see
  freeze succeed after source and color checks alone. Replay the missing-cue risk by replacing the
  shared preamble's `\uline{#2}` with `#2` in a scratch copy of the fixture layout. The compiled
  PDF fixture must fail on the statement underline even though the label remains bold.
- `ExactReviewedPdf` models `parseCheatsheetManifest` rejecting a passed review whose digest
  differs from the release digest. Set `AcceptStaleReview = TRUE` in a scratch config to see a
  delayed review of the first PDF accepted for the second. The manifest fixture enumerates both
  digests in both roles. Removing the exact-digest guard in scratch must make that fixture fail.

Restore the scratch inputs and rerun. The model checks the procedure's ordering and the parser's
digest rule within its bound. The parser cannot tell whether someone carried out a visual or
mathematical review. The compiled 4 pt fixtures check selective statement ink, black routine
text, heavier underlines on selected claims and contrast in color and grayscale. Review the actual
module PDF for wrapper selection, custom definitions, legibility and mathematical content.

## Source binding

Compare the Git blob identities below when you change the named surfaces. Update the binding only
after checking the new procedure, implementation and suites together.

| Surface | Git blob |
|---|---|
| `seed-templates/docs/40 Cheatsheet Procedure.template.md`, sections 1 and 5 | `699d6df26cc483eb9706cd2c9b0ebbe9cd8b8aae` |
| `seed-templates/70 Learning/templates/mathematics-cheatsheet-preamble.template.tex`, semantic macros | `d08ea5cf0c620d94c38cde34710e85c70252cbab` |
| `src/cheatsheet/manifest.ts`, `parseCheatsheetManifest` | `04fba91da73cd42681f600fe6bc9f12f57ff499c` |
