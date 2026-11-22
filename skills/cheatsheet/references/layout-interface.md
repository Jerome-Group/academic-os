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

## Color and print hierarchy

| Role | Color | Cue that survives grayscale |
|---|---|---|
| Major sections | White on navy `#233D57` | Solid column-width band |
| Topics | Navy `#233D57` on white | Bold ruled heading |
| Source and question markers | Navy `#233D57` | Ruled source heading or question badge |
| Selected theorem, condition or result | Cobalt `#0037B3` | Heavier underline under the statement label, bold short condition/result or boxed key formula |
| Key term or method pivot | Green `#006343` | Bold lookup phrase or first move |
| Recurring pitfall | Rust `#9C2500` | Bold mistake or exception within the passage |
| Routine statements, proofs, solutions and narrative | Black `#000000` | Existing labels and underlines |

| Highlight role | Background | Ink | Use |
|---|---|---|---|
| `theorem` | Pale blue `#DCEAFF` | Cobalt `#0037B3` | Short theorem, with hypotheses and conclusion |
| `lemma` | Lilac `#ECDDFF` | Plum `#4F246E` | Short supporting lemma reused in solutions |
| `exercise` | Mint `#CCF0DB` | Dark green `#004C35` | Representative prompt, first move or exercise label |
| `term` | Yellow `#FFF0A8` | Dark ochre `#594200` | One useful occurrence of a lookup term |
| `paper` | Rose `#F8DAE6` | Berry `#741943` | The exact session or question identifier from a past paper |

Use `HighlightedStatement` for a short theorem or lemma. `PassageHighlight` accepts one short
paragraph of text and inline math. It keeps those lines together with their existing leading,
so use `HighlightTag` for an identifier or short phrase when a longer item needs to wrap or
cross a column. Tags take the dimensions of the same bold phrase, keeping the phrase together.
Choose a few highlights from the Owner's mistakes and assessment patterns. Preserve the
printed label and paper or exercise ID. On a past-paper exercise, the paper ID can carry rose
and its separate exercise title can carry mint.

Use a starred statement for a short theorem that the Owner repeatedly needs to find or
misapplies. Blue covers the label, hypotheses, conclusion and math even across wrapped lines.
For a longer theorem, use an ordinary statement with a short `KeyTerm`, `Hypothesis` or
`Result` to mark the part needed under exam pressure. Mark a term at the occurrence that helps
the reader find it. Keep repetitions black. Mark a method where it determines how to start or
changes the next step. In a long proof or caution, color the decisive phrase and keep the
explanation black. Leave white behind ordinary text.

At native 4 pt, check at least 7:1 contrast for accent text against its actual background
in both print modes. Make adjacent paragraphs readable in black so the
few colored items stand out at a glance. Use `KeyFormula` in math mode for a short formula the
Owner needs to retrieve quickly. Keep derivations and repeated formulas in the running text.
Record the chosen print constraint in the manifest. When an assessment requires monochrome,
call `\selectcolormodel{gray}` after loading the preamble and before the document body. The gray
model preserves the dark section bars and white headings, along with boxes, underlines and weight.

| Macro | Arguments / purpose |
|---|---|
| `Topic[id]{title}` | Stable topic target and heading |
| `Statement{kind}{display}{body}` | Named definition/result with an underlined label |
| `FormalStatement{kind}{display}{source}{locator}{body}` | Underlined statement with source and optional locator |
| `Statement*`, `FormalStatement*` | Same arguments, with the complete selected claim in cobalt |
| `HighlightedStatement{role}{kind}{display}{body}` | Underlined theorem or lemma and short body on a role-colored background |
| `PassageHighlight{role}{text}` | One short highlighted paragraph that stays together |
| `HighlightTag{role}{text}` | Bold inline label or keyword with a role-colored background |
| `Example{display}{body}` | `Eg.` item |
| `Exercise{display}{body}` | `Ex.` item |
| `SourceItemRef{kind}{display}{stable id}` | Typed link to an item's explicit `label`; `Eg.` and `Ex.` stay distinct |
| `Proof{body}` | `Pf.` with terminal square |
| `ProofStep{stage}{body}` | Breakable run-in stage; place inside a proof |
| `Hypothesis{condition}` | Selected bold text/math condition |
| `Method{pivot}` | Short decisive reasoning step |
| `KeyTerm{term}` | Bold lookup term in green |
| `Pitfall{phrase}` | Bold mistaken step or exception in rust |
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
