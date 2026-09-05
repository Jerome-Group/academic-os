# General mathematics specimen visual review

Reviewer: GPT-6 Astra, Low. Two substantive visual passes, each covering both A4 pages and dense 600dpi crops. Pass 2 reviewed PDF SHA-256 `f18118499a10c1691a72732ce7688114686417b7ae06938105d38d2ff518e99c`.

Status: correction required; typography freeze deferred. This is a visual/design review, not independent mathematical certification. Owner-arranged Pro review pending.

Pass 1 found invisible logo, header ascenders outside a 5mm print envelope, an overflowing table, excessive display gaps and insufficient occupied density. Pass 2 fixes the invisible logo, table overflow and display gaps; the eight columns now form a dense mixed-object specimen. Source bars, topic rules, formal labels, per-part tags, immediate solutions and explicit page continuation are recognizable. No body overlap or clipping was visible. No overfull warning remained; underfull paragraphs remain for final layout inspection.

Pass 2 identifies a substantive extension-font issue. Latin Modern's standard OMX shape uses `<->sfixed*lmex10`, leaving operators oversized despite declared mathematics sizes 4/3/2.4pt. Load that family and explicitly select scalable `<->lmex10`, then re-render sums, integrals, unions and delimiters. Normal font-size selection is required; do not hide geometric scaling. Compact textstyle identities with side limits are appropriate where clear. Keep body type 4/4.2pt.

Logo alignment also needs correction: current logo ink lies approximately 6.86–8.89mm from page top, visibly below its credit. Raise it approximately 1.8mm and verify ink within the reserved 5–8mm header band. The body begins at or below 9mm. A 5mm outer ink envelope is a design boundary, not a guarantee for an unknown printer.

After those corrections: repeat dense native-symbol and header review, verify actual page count/dimensions and ink bounds, then record the final typography freeze and PDF hash.


## Corrected general specimen — independent visual pass 3

Reviewed stable PDF SHA-256 `ea7b10adb3c03f03237907d26ff12d8149f4d3f76ec8a3969309a8624565b615` after implementation declared it immutable. Both pages were freshly rendered to 1800px height (`build/independent-pass3-1.png`, `-2.png`). Dense native-math, cases and header crops were inspected at 600dpi beside the prior reference crops. This pass follows the two previously rejected builds.

The extension-font correction is effective: PDF extraction shows extension glyphs at 3.985 PDF pt (4 TeX pt), with script extension glyphs at 2.989 PDF pt. All prose, bold and sans roles are 3.985 PDF pt; mathematical scripts are 2.989/2.391 PDF pt (3/2.4 TeX pt). Embedded Type 1 fonts confirmed. Sums, integrals, unions, matrices, cases and nested binomial fractions retain recognizable shapes with substantially less vertical inflation. Logo is now clear and vertically centered beside the credit. Narrow 3mm side margins and compact header improve space use. Exactly two 595.276 x 841.89pt A4 pages; no overfull, missing-character or package warning; underfull paragraphs remain, with no observed clipping.

Correction still required before final pass: natural flow starts page 1 column 2 at a dimension-formula proof without source/context, page 1 column 3 at a calculus table without continuation, page 2 column 3 in W8's solution, and page 2 column 4 in a caution paragraph. Add verified explicit continuation labels or break at semantic boundaries. The calculus table also rises above the common top of body prose toward the header; align its body ceiling. Reported occupied heights are about 90% on page 1 and 93% on page 2: useful dense capacity evidence with reserve, not a fully packed final sheet. No typography freeze yet.


## Corrected general specimen — independent visual pass 4

Reviewed stable SHA-256 `ff6d42e9a43cfe8c1df74d0f69be23dfde0553b1aab1575e6838bba52eca0dce`, both freshly rendered 1800px pages and 600dpi diagram, complex-integral, question/solution and footer crops. Source/context starts improved and the table is now below a named topic at the common body ceiling. The diagram is compact, but its centering declaration leaks into every following paragraph on page 2. This is a substantive regression: body paragraphs, topics, questions and continuations unexpectedly become centered. Scope centering locally around diagram/caption, then re-render the entire second page. Add W8(b) to the initial-data continuation and a small clearance between diagram node Z and its caption. Freeze remains deferred pending these exact repairs.


## Corrected general specimen — final visual verification and typography freeze

**Visual acceptance: PASS.** Final PDF SHA-256 `f8df783ca4f243c9c7fc17df5b81e4a3efcf15502cdf6a761cd84207aeedcb40`. This supersedes earlier rejected-build statuses. After two substantive corrected-build review/correction passes, the final repaired PDF was independently rendered again: both full A4 pages at 1800px height, both complete pages at 600dpi, and fresh logo/diagram/dense-math crops. The centered-body regression is repaired, continuation identifiers are recognizable, the calculus table remains under its topic, and the compact diagram has clear node/caption separation. No collision, clipped glyph, stranded heading, wide-object overflow, or wasteful internal display gap was observed. Footer and header text remain legible; the logo has open, clean internal geometry.

Freeze v1: Latin Modern body and all prose-bearing roles 4 TeX pt / 4.2pt baseline; mathematics text/script/scriptscript 4/3/2.4pt; scalable native extension font declaration; four columns, 1mm gutters, 3mm nominal sides and 6mm nominal top/bottom body margins. PDF extraction independently verifies only 3.985, 2.989 and 2.391 PDF-point glyph sizes (the TeX-to-PDF conversion), with all body roles at 3.985. No hidden prose resizing found. Exactly two portrait A4 pages, each 595.276 x 841.89 PDF pt; embedded fonts; no overfull, missing-character or package warning. Underfull narrow-paragraph diagnostics remain without observed visual defects.

Measured *all-ink* clearance from independent 600dpi renders, using a 40/255 darkness threshold: left/right approximately 2.96mm; top 2.96mm on page 1 and 2.92mm on page 2; bottom 3.73mm. These raster measurements include logo and glyph overhangs, unlike text-metric bounding boxes. Nominal 3mm margins are not a guarantee of 3mm ink clearance. Unknown printer compatibility remains an explicit limitation, not an acceptance gate: no physical print test was performed.

The body offers `(204 - 3*1)*285 = 57,285 mm²` per page excluding gutters, approximately 94.8% of the old 60,421.64mm² reference envelope. Occupancy reported by implementation and consistent with full-page viewing: page 1 columns 89.3/90.9/92.8/90.6%; page 2 93.1/93.0/91.5/93.8%. Remaining bottom reserve is visible and disclosed, not padding used to manufacture an apparent full page. Identical `pdftotext PDF - | wc -w` counts: current specimen 11,040, older 4pt specimen 12,092, older 3.835pt specimen 16,220. These are extraction tokens, not equivalent mathematical information or a guarantee that a different course corpus fits. Final population must use and measure the available reserve.

This acceptance freezes the generic visual system only. It does not certify generic mathematical correctness or a future course-specific derivative. That populated derivative still needs its own two full-page and dense-math review passes. Owner-arranged Pro review remains pending.


## Typography reopened for hierarchy redesign

The Owner reopened the freeze after populated review found that minor-source bands and major-source bands had equal rank. The next version must demonstrate full source hierarchy, distinct formal/question/solution roles, stronger concept navigation and selective method/conclusion emphasis. After pure administrative material is moved out, progressively test larger type or leading within the two-page constraint and 3.835pt body floor. Earlier generic acceptance does not certify this new populated design. Review remains pending stable redesigned builds.


## Populated hierarchy review — first redesign pass

The redesigned hierarchy produces a material visual improvement: major black bands, local ruled topics, distinct question markers and bold concepts, underlined formal labels, and selective bold-math conclusions. Acceptance is nevertheless rejected: independent checking found three pages in the declared two-page build. The 0.4mm gutter is also visually marginal. Correct the page-count check; prefer a wider gutter and balanced font/leading combination. Mathematical method anchors need local bold-math selection, not text bold alone. Generic correspondence and final populated review remain pending.


## Matching generic redesign — full and dense review

Immutable generic PDF SHA-256 `7d931881bb15c4a51fcfd823e21b7e98a56f973a67c661f2c4b7624ec2b5a820`: independently two A4 pages, 4pt body/3.95pt leading and native math4/3/2.4. Both full pages plus 600dpi native math, diagram, cases and tables were inspected. Updated source/question/result hierarchy is visible; no glyph collision or table overflow observed. One continuation label is stranded at page-1 column-3 bottom; move it to resumed content or remove it when the next numbered theorem provides sufficient context. Freeze pending that repair and final populated continuation review.


## Matching generic v4 — visual acceptance

Immutable PDF SHA-256 `6a517aeef31982dbe361306a32c65e7569efa2b94106d366936da9b6f7073ab0` passes visual review. Independent extraction confirms two A4 pages and only 3.985/2.989/2.391 PDF-point glyph sizes (4/3/2.4 TeX pt). Both full pages and 600dpi dense native mathematics and compact-diagram crops were inspected. The stranded continuation is removed; numbered/identified column starts provide coherent context. Source hierarchy, question markers and concepts, formal labels, solution markers, cases, tables and diagram remain clear. No clipping, collision or width overflow observed. Body typography is 4pt with 3.86pt leading and 0.6mm gutters. Final populated artifact acceptance remains separate; a module furniture placement can differ without changing the semantic/type system.

## Final matching specimen v5 — accepted

Immutable PDF SHA-256 `f8ad7e95c3cde74f1470808193bca102668697155599da029968b59acb3b4029`. Both fresh full-page renders and 600dpi dense mathematics/compact diagram inspection pass. Independent PDF check confirms two A4 pages and glyph sizes 3.985/2.989/2.391 PDF pt, corresponding to 4/3/2.4 TeX pt. Final body 4pt, leading 3.78pt, gutter 0.6mm; body bottom 5.47mm and footer baseline 1.6mm. Identified column continuations, source hierarchy, question markers, concepts, formal labels and solution markers remain clear. No observed clipping, collision or wide-object overflow.

Independent 600dpi threshold<200 all-ink clearance: left 1.736mm, top 1.693mm, right at least 1.736mm, bottom 1.312mm. Physical printer compatibility has not been tested. The fixed specimen intentionally remains under capacity at final dense typography: body-to-footer font-bbox reserve is 59.155mm on page 1 and 52.407mm on page 2. It is a native-object and semantic-style demonstration, not a fully packed page stress test. No unreviewed filler was added. Final visual acceptance applies to the stated hash.

## Final canonical follow-up — PASS

PDF SHA-256 `9a7651bd0b8a70f4f20f42d5d29685a0bf3ddfc46fbae90da7e8ba16f7f1060f` independently verifies as two A4 pages. Full page 2 and 600dpi crops of Corollary 17.1, the recurrence transition and footers inspected. The numbered corollary is distinct and attached to its statement; Q8(b) continuation correctly identifies the resumed question. No observed collision, clipping, stranded heading or new footer issue. Typography and geometry remain the accepted settings.

The specimen remains below full capacity. Independent character-bbox measurement gives body-to-footer reserves approximately 59.3mm and 52.8mm on pages 1/2 (body bottom y=665.265pt and 683.618pt). These approximate reserves supersede earlier specimen measurements; they are not maximum-capacity claims. Physical-printer compatibility remains untested.

## Spacer removal candidate — corrections required

SHA-256 `1933ee7c0360955102db22413873061ad8f810d991ceb93467d64d9268db80a3`; independently two A4 pages. Both full pages and all four affected minipage regions inspected at 600dpi. Removing the internal Q8 spacer correctly joins setup to part (a); topology's preceding gap is also compact.

Two regressions prevent acceptance: page-1 column 4 starts with the unlabelled last line of Theorem 13B, whose label and first lines remain at column 3 bottom; place the complete theorem at the next column start. Page-1 column 2 and 3 minipage content starts approximately 8pt above the ordinary body start, visibly intruding into the header band; align their first baselines with the other columns through top-aligned container handling, without reinstating arbitrary internal 8pt gaps. Footers remain visibly clear. The earlier PASS is superseded for this candidate.

## Corrected top alignment and semantic break — PASS

Final SHA-256 `2b6c204ec0a2d8dc3441ad33bf508069f95fc663428a0d065d1b6595950f191b`; independently two A4 pages. Both full pages and 600dpi crops of all four affected minipages inspected. The dimension-formula and integral-test blocks now occupy the normal body band; Theorem 13B begins intact and labelled at column 4. The four legacy 8pt spacers are absent. Q8 setup flows into part (a) with ordinary mathematical line clearance; topology's topic/body remains together. No new collision, clipping, orphaned context or footer defect observed. Fonts and furniture remain unchanged.

Updated character-bbox body-to-footer reserve: approximately 60.3mm on page 1 and 52.8mm on page 2 (body bottom y=662.489pt and 683.618pt). This remains a below-capacity object/style specimen, not a packed-page stress test. This acceptance supersedes the rejected spacer-removal candidate; physical-printer compatibility remains untested.
