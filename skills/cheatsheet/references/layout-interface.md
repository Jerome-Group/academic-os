# Mathematics-cheatsheet interface

The Module's pinned Cheatsheet procedure owns authoring and review. These are the shared template's
macro signatures; a module-editable preamble may be older or locally adapted. Inspect that copy
before use. A Module-local template may be an immutable source of a frozen release. Keep that copy
and its compatible pair unchanged; use reviewed versioned upstream assets in the new artifact's
staging/support tree instead. Snapshot mutable style inputs before hashing them, then inline required
code into the self-contained release. Adopt an upstream change through the preservation workflow in `docs/machine-setup.md`
of Academic OS; existing release files do not change merely because the shared seed changed.

Set layout commands before loading the preamble: `SheetLeftMargin`, `SheetRightMargin`,
`SheetTopMargin`, `SheetBottomMargin`, `SheetColumns`, `SheetColumnGap`, `SheetBodyPointSize`,
`SheetBodyLeading`, `SheetMathScriptPointSize`, `SheetMathScriptScriptPointSize`.
The native dense default is 4 pt; assessment/Owner constraints select the actual preference/floor.

Navigation uses `SheetHeaderBaseline` (depth from top), `SheetFooterBaseline` (height from bottom),
`SheetNavigationGap`, `SheetNavigationPointSize` and `SheetNavigationLeading`. Configure visible
`title`, `credit`, `disclaimer`, `publisher`, `logo`, `top-navigation` and `bottom-navigation` through
`SheetSetup{key={value},...}`. Empty navigation keys draw no map. Reserve body margins for the
chosen bands and measure all-ink clearance in the rendered result; the template cannot infer the
space occupied by arbitrary supplied text. Use distinct concise maps, not two copies of one band.

## Print hierarchy

| Role | Color | Cue that survives grayscale |
|---|---|---|
| Navigation and question markers | Navy `#233D57` | Section bar, bold ruled heading or boxed question badge |
| Statements and conditions | Teal `#005B57` | Bold underlined statement label or bold decisive hypothesis |
| Results | Teal `#005B57` | Bold short result or boxed standalone key formula |
| Reasoning | Plum `#5A316D` | Bold underlined `Pf.`/`Sol.` or bold method pivot |
| Pitfalls | Rust `#853B23` | Bold explicit caution, correction or counterexample label |

Keep ordinary prose and working black. Use the same wrapper for the same role across a sheet,
including on a continuation. Select roles before applying macros. Bold a short condition or method
only when it changes which move is valid. Use `KeyFormula` in math mode for a short formula the
Owner needs to retrieve quickly. A line that wraps, a derivation or a repeated formula belongs in
the running text. A rule under a topic heading is different from the underline under a run-in label.
Record the chosen print constraint in the manifest. When an assessment requires monochrome,
call `\selectcolormodel{gray}` after loading the preamble and before the document body. The gray
model preserves the dark section bars and white headings, along with boxes, underlines and weight.

| Macro | Arguments / purpose |
|---|---|
| `Topic[id]{title}` | Stable topic target and heading |
| `Statement{kind}{display}{body}` | Named definition/result with an underlined label |
| `FormalStatement{kind}{display}{source}{locator}{body}` | Underlined statement with source and optional locator |
| `Example{display}{body}` | `Eg.` item |
| `Exercise{display}{body}` | `Ex.` item |
| `SourceItemRef{kind}{display}{stable id}` | Typed link to an item's explicit `label`; `Eg.` and `Ex.` stay distinct |
| `Proof{body}` | `Pf.` with terminal square |
| `ProofStep{stage}{body}` | Breakable run-in stage; place inside a proof |
| `Hypothesis{condition}` | Selected bold text/math condition |
| `Method{pivot}` | Short decisive reasoning step |
| `Result{result}`, `Conclusion{result}` | Short result in bold |
| `KeyFormula{formula}` | Boxed short formula. Call inside math mode |
| `Worked{id}{title}{question}{reasoning}` | Question badge and underlined solution label |
| `QuestionPart{part}{title}{source}{question}{reasoning}` | Subpart badge and underlined solution label |
| `Caution{body}` | Explicit pitfall |
| `Counterexample{display}{body}` | Explicit counterexample |
| `Correction{body}` | Visible qualification/correction |
| `KeepBlock{body}` | Reserve opening lines once, then allow ordinary column/page breaks; nesting is safe |
| `SheetMapItem{id}{title}` | Link to a topic target |
| `SheetPageRef{stable id}` | Current compiled page reference |
| `ContinueBlock{exact item}` | Labeled resumed item at a real break |

`SheetOpeningLines` controls the short opening guard, not an unbreakable block height. Avoid
wrapping long proofs or solution collections in minipages. Use explicit labels on every covered
source part; a reference's visible display is not its stable ID. Types and display numbers describe
the cited source, not the artifact's independent topic numbering.
