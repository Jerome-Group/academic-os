# Mathematics-cheatsheet interface

The Module's pinned Cheatsheet procedure owns authoring and review. These are the shared template's
macro signatures; a module-editable preamble may be older or locally adapted. Inspect that copy
before use. Adopt an upstream change through the preservation workflow in `docs/machine-setup.md`
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

| Macro | Arguments / purpose |
|---|---|
| `Topic[id]{title}` | Stable topic target and heading |
| `Statement{kind}{display}{body}` | Named definition/result |
| `Example{display}{body}` | `Eg.` item |
| `Exercise{display}{body}` | `Ex.` item |
| `SourceItemRef{kind}{display}{stable id}` | Typed link to an item's explicit `label`; `Eg.` and `Ex.` stay distinct |
| `Proof{body}` | `Pf.` with terminal square |
| `ProofStep{stage}{body}` | Breakable run-in stage; place inside a proof |
| `Hypothesis{condition}` | Selected bold text/math condition |
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
