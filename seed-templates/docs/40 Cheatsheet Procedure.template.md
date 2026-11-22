# Cheatsheet Procedure

How MODULE_CODE creates, revises, audits, verifies and packages a source-led cheatsheet. The
Owner's assessment scope, page limit, native font floor, content and furniture govern this run.
Existing authorization covers routine reversible work. Ask only for incompatible constraints or a
material unresolved source choice. Keep coursework and operational evidence inside the Module.

The `/cheatsheet` route supplies `cheatsheet-tool.mjs`. Run `schema` before creating evidence;
use its current command and measurement schemas. Commands name this Module root and the
module-relative `support/<artifact-id>/manifest.yaml`; no repository configuration is needed.

## 1. Resolve assessment context and enumerate sources

For preparation, run `prepare --module-root <root> --module-code MODULE_CODE --assessment <name>`.
It reads the normative Source Map in declaration order, including tutorial roles and missing
solutions. Read the Profile assessment rows and cited notices; discover relevant importer material
when the map is incomplete. Check offering, issued dates, scope and permitted materials against
current assessment evidence. A local hash proves bytes, not upstream freshness. Historical material
can supply practice and solutions; it cannot establish current assessment scope or permission.

Use color for every new and revised cheatsheet. Apply the semantic ink and highlights in
`references/layout-interface.md`. Grayscale is a legibility check on the color release.
If issued assessment rules explicitly prohibit color, identify the rule and its source and
flag the conflict before claiming the file is permitted in the exam.

Establish page count, native body-size preference and floor, columns and furniture.
Confirm the deadline. Around
4 pt is a configurable dense-sheet starting preference, never a universal assessment permission.
The Owner or assessment may require larger type. Show the proposed source selection with locators,
authority, hashes, gaps and exclusions; reuse an explicit selection already supplied. Resolve an
unambiguous selection autonomously. Ask one targeted question only for a material ambiguity.

Read every selected source completely. Enumerate definitions, results, hypotheses, examples,
exercises, tutorial/test questions, historical questions with solutions, and every numbered or
lettered subpart. Distinguish example `Eg.` from exercise `Ex.` even when numbers coincide. Give
each item a stable ID, source locator and type; record omitted optional items with reasons. A
Source Map entry, label count or keyword match is not an enumeration of its contents.

Read `70 Learning/REVISIT.md` and relevant lecture, tutorial, revision and past-paper session
records. Open the underlying attempts or feedback when cited. Record each recurring or costly
failure with the record locator, observed error, assessment relevance and the sheet item it earns.
Distinguish an observed error, a prompted reconstruction and an unaided success. Use this evidence
to rank discretionary space after required coverage. When records are sparse, record the gap and
prioritize issued assessment guidance.

### Choose what earns space on a final

Read the relevant past finals that fit the current scope and format. For each distinct sitting,
identify the question and subpart, the marks where printed, the required task, and the method,
condition or answer form it tests. Group comparable tasks across sittings. Count repeated parts of
one paper as one sitting for recurrence. Record excluded papers and gaps in the available years.

Rank discretionary items by current relevance, recurrence across sittings, documented marks,
reuse across question types and the Owner's mistakes. Use judgment to choose what helps under exam
conditions. A rare proof step can earn more space than a frequent routine computation if the step
is hard to reconstruct or prevents a costly error. Select a representative exercise that teaches
the same decision, and keep the exact paper or exercise ID for retrieval. Record the decisive
source locators and selection reason in the coverage note. Distinguish what the papers show from
your judgment. Preserve required coverage. Make the ranking and highlighting choices autonomously.

### Match the final's wording and working

Use the nearest applicable official final marking scheme for mathematical wording, hypotheses,
notation, required working, acceptable answer forms and rounding or proof conventions. Use an
official final solution where it supplies the needed detail. Where final guidance is missing for
that item, use the issued tutorial marking scheme or solution, then the issued lecture notes.
Record the exact item and source used for each fallback. Use the current offering's convention
when older sources conflict, and name any unresolved difference that changes an answer.
Describe mark allocations or accepted alternatives only when the source explicitly gives them.
Where the sources leave a step unstated, derive it, label the derivation, and record the gap.

For non-final assessments, compare each selected method or worked item with its corresponding
official solution or marking scheme. Treat personal records as evidence of study needs and keep
their private references out of the sheet and exported review package.

Completion: current assessment and constraints have evidence; every selected source item and
subpart is enumerated; gaps and authority conflicts are resolved or named as concrete blockers.

## 2. Select the release and preserve prior work

The release is one matching `<artifact>.tex` and `<artifact>.pdf` pair directly in
`10 Learning Materials/30 Personal Notes/`. Durable working files live in `support/<artifact-id>/`;
disposable builds use a fresh `.scratch/cheatsheets/<artifact-id>/<run-id>/`.

Read the Profile, Definition, Source Map, selected sources and existing manifest/coverage. Preserve
importer originals and Owner attempts byte for byte. Hash every source and record its module-relative
path, stable locator and authority, strongest first: Owner constraint, current issued material,
official solution, audited module work, registered textbook, historical material, original example
filling an identified gap. Current scope and issued sources resolve conflicts.

Before revision, inventory the previous release's content and proved unique drafts. Classify every
object under its release/support tree as durable or reproducible. Retain superseded unique work in
`support/<artifact-id>/history/` with hashes. Reconcile prior statements, arguments, examples and
question parts against the revised release: retained, corrected, equivalently condensed or explicitly
retired with a reason. Preserve useful prior content unless the requested scope or a documented
correction changes it. A successful regeneration alone does not establish preservation. Run `preservation` against the
current manifest, a frozen `--baseline-tex` and its `--baseline-sha256`. The default exact policy
protects complete ordered mathematics; `preserve-existing` permits explicit additions. This catches
literal expression drift, while macro meanings, prose hypotheses and proof sufficiency still need
source review.

Completion: every input has a locator, digest and authority; every existing unique object and every
prior content item has an explicit disposition.

A template may itself be a hashed source of an existing release. Before adapting a shared template,
inspect current/history manifests and construction records for that path. Keep a frozen source and
its compatible template pair byte-identical, even when they match an older shared seed. Select the
reviewed versioned upstream pair for the new artifact and stage it separately; never repair an older
release's fingerprints or silently replace its source path. Report a held template or preexisting
historical conflict explicitly.

For a new release, snapshot mutable construction/style inputs byte for byte under its existing
support/content home before declaring their hashes. Retain the original path and digest as
provenance; cite the immutable snapshot as the release input. Verify the copy, preserve the original,
and inline required style code in the portable top-level TeX. A provenance snapshot does not create
a second authoring authority. This lets later shared-template upgrades preserve the earlier release.

## 3. Declare one authoring authority

Maintain `support/<artifact-id>/manifest.yaml` (schema version 1) and `coverage.csv`. Declare exactly
one composition mode: `self-contained`, where the top-level release TeX is authoritative, or
`fragments`, where ordered digested files under `support/<artifact-id>/content/` are authoritative
and their exact concatenation produces the release TeX. Edit the declared authority.

For transformed self-contained construction, record `authoring.construction` with digested `recipe`,
ordered `inputs`, `base_tex_sha256` and `output_tex_sha256`; keep it beneath support. `regeneration-check`
checks a proposed construction JSON against a staged `--candidate` and the still-current authority. It
never publishes. If current authoritative bytes differ, reconcile direct edits into the recipe or
retire the construction record before regenerating; never overwrite first and reconcile later.

Regenerate through fresh staging. Retain the generator/version, command, input digests and staged
output digest; compare that output with the intended release before promotion. Transformations must
be materialized in the authoritative fragments before exact concatenation, or their final output
must become the self-contained authority. Generated copies and historical inputs carry provenance,
not a second editable authority. After every authority edit, rebuild the PDF and hash the release pair again.

Record artifact identity, scope, release/support paths, paper, `constraints.color: color`,
pages, columns, preferred/floor
body size, sources and SHA-256, coverage path, release TeX/PDF hashes and review status. `passed`
names the exact reviewed PDF SHA-256. Every subsequent edit returns the release to `unreviewed`.
Requested model credits are furniture; actual reviewer provenance is observed history.

Coverage uses the exact header:

```text
item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note
```

For every new or revised required source, declare its independent `required_locators` inventory,
compared with the original issued bytes. Legacy provenance-only locators remain readable; an undeclared or partly declared inventory
leaves completeness unproved. Reconcile coverage with that enumeration and the prior-content inventory.
Priorities are `required`,
`high`, `useful`, `extension`; dispositions are `verbatim`, `condensed`, `cross-reference`, `excluded`,
`pending`. Every included item points to a stable artifact label. Every exclusion has a reason;
required items stay included. Use notes to identify type/subpart, qualifications and preservation
changes. Coverage presence does not prove that the cited reasoning is sufficient.

Run `audit` on the declared paths to prove source digests, authoring correspondence and release
hashes before fitting.

Completion: one declared authority reproduces the release; coverage accounts for every enumerated
item and prior-content disposition; manifest, source and release hashes agree.

## 4. Author rigorous, breakable content and fit it

Use the mathematics-cheatsheet semantic interface. Configure geometry, columns, native body/math
sizes and furniture per sheet. Organize the body around the decisions the Owner makes when solving a
problem. Put each relevant definition, result or counterexample next to the decision it changes.

Turn each selected learning gap into usable running text. Name the observable cue for choosing a
method, the condition that permits it, the decisive calculation or proof step, and the check that
would catch the recorded error. Put that check beside the step where the error arises. For a
worked solution, carry the reasoning through to the requested result. For a proof, retain the
quantified hypotheses, nontrivial implications and conclusion. Present a short complete chain of
reasoning even when the reference sheet has room for only one example of the method.

Use the issued convention in the explanation itself. For example, an integration method can derive
its bounds from the region, while a quotient method can derive its conclusion from the ideal
hypothesis. Collapse repetitive examples into one worked instance and a precise cross-reference
when the same argument applies. Preserve exceptions and steps that differ.

Label source qualifications/corrections visibly and record their reason/authority. Preserve the
source's distinguishable wording where it matters; a corrected claim must not masquerade as a
verbatim source statement. Keep notation and hypotheses consistent across related items.

Use `Eg.`, `Ex.` and `Pf.` consistently. For automated presentation, `present-references` formats
only explicit `\SheetRef{key}` markers from a JSON identity map (`kind`, complete `id`, optional
plain-text `display`); write its returned source into staging. It preserves mathematics, identity
arguments and ordinary words. Resolve note tags to their actual type from the source; never infer a
type from an ambiguous N prefix. `SourceItemRef{kind}{display}{stable id}` preserves the
item type as well as its display number. Bold key hypotheses, method pivots, conclusions and
counterexample/source tags selectively, including a Chinese remainder theorem tag when relevant.
Keep surrounding exposition regular weight. Short run-in proof stages remain breakable paragraphs;
`KeepBlock` reserves opening lines rather than boxing an entire argument. Nested semantic wrappers
must not create empty paragraphs. Avoid long minipages or boxes that force a large unused tail.

Keep the sheet white with black running text. Apply the five color roles in
`references/layout-interface.md` to selected material. Prefer short highlights for statement
labels, exercise titles or decisive moves, terms, and paper IDs. Highlight the complete
numbered label as one unit, including its type and identifier, as in `Def. 2.28`.

Put at least one visible color cue inside the body of every worked solution, proof sketch
and substantive explanation. Highlight the term the Owner needs to find, the condition that
permits the method, the decisive move, or the formula or result worth finding again. Use
distinct role colors when different roles appear. Prefer a short opaque fill for a lookup
phrase or decisive step. Use `KeyTerm` for bold highlighted terms and `KeyTerm*` to underline
the few terms readers most need to find. Keep surrounding sentences black. Apply this pass
to both retained and new explanations.

Use the shared `Worked`, `QuestionPart` and `Proof` wrappers for new worked items and proofs.
Put each cue inside the reasoning argument. A colored `Sol.` or `Pf.` label, an exercise title,
and a colored paper ID serve navigation. Every worked explanation still needs its own cue.

Choose highlights from recurring mistakes, exam patterns and the Owner's learning gaps. Give
a compact theorem or lemma one solid background when its conditions and conclusion are best
read together. Highlight each lookup term at its most useful occurrence. Give any point on
the page one fill. Use a single opaque field behind a passage and disjoint fills for separate
tags. Keep adjacent routine text on white. Use rust ink for pitfalls and retain the headings,
underlines and boxes for grayscale.

Provide slim, distinct top/bottom navigation bands configured for this sheet, a compact page/section
map and page numbers. A map describes real labels; any claimed page/column range must match the
current build. Every split identifies the exact continued item and direction, including resumed
proof or question subparts. Inspect navigation against the rendered break positions after fitting.
Reserve and measure its clearance from body text and furniture.

Compile serially: one build owns its fresh output directory until completion. Begin at the preferred
font size, then measure the actual current PDF.

- Spare space: restore required content first, then deepen explanations and worked reasoning, then
  add useful counterexamples. Optional final extensions come last and are identified as extensions.
  Expand highest-priority source-backed material before spacing; remaining space does not justify
  filler or weakening layout clearances.
- Overflow: remove duplicate framing, cross-reference repeats, condense while preserving the full
  argument, then remove lowest-priority optional material. Only then adjust native font size within
  the permitted floor. Geometric scaling is outside the interface.

Save schema-versioned fit observations with their measurement/manual/unknown evidence and exact
build identity. Run `fit`, apply one returned step and measure again. Unknown geometry or review
observations remain unknown; zero is an observed value. Page count, required content, mathematical
sufficiency, navigation/clearance and font floor hold simultaneously. `blocked` and `user-choice`
name their reasons; an unresolved hard constraint needs an Owner choice.

Completion: the current release meets the simultaneous content and measured layout constraints;
coverage dispositions and hashes describe those exact bytes.

## 5. Verify separate gates on frozen bytes

`schema` lists the required TeX/Poppler executables. `audit` checks declared correspondence without
changing the release. `verify` rebuilds the top-level release TeX alone in a fresh isolated directory,
with caller TeX search paths and user latexmk configuration excluded. Inputs must belong to the
release or installed TeX distribution. Host-local hidden files fail portability.

Run `verify --module-root <root> --manifest <path> --evidence-directory <fresh-module-relative-path>`.
Choose a fresh durable directory below this artifact's support tree. Retain that build's identity,
AUX, complete log, visible-font `fonts.xml`, full `pdftohtml -xml -hidden` output in `full.xml`,
separate exact hashes and page renders. Inspect full XML, including
off-page text, rather than a cropped or body-only extraction. Bind every observation to the exact
TeX/PDF SHA-256 and build ID; resolve paths from the current report, never a remembered scratch run.
Verify embedded fonts, native body floor, page constraint, no missing glyphs/overfull boxes/scaling,
and semantic/raster correspondence between the rebuilt and released PDFs.
For color releases, `verify` checks every page for visible color and tests shared wrappers for
semantic cues inside explanations and obvious number-only tags. It checks within declared body
margins when available. The rendered review below establishes whether the cues are in the
right place and identify the right material.

Run a second pass from the PDF, with the authoring source closed for the first scan. Inspect every
page at A4 actual size (100% print scaling). Re-solve one fragile worked item per section using the
printed body alone. Check that the method choice, required conditions, decisive step and result
are recoverable without supplying an omitted argument. Reconcile each selected learning gap with
the page and item that addresses it, then compare against the issued source or marked solution.
For a final, reconcile the highlighted items with the past-paper ranking and check the printed
answer form and decisive steps against the cited authority. Record missing reasoning and
conventions by page and item.

Review the exact release PDF at actual size in color and grayscale. Sweep every page column
from top to bottom. Record the page and column, each worked item or explanation's printed locator,
the body cue and its function, and any missing or split label. Follow continuations across
columns and pages and check resumed reasoning. A column with no worked material still gets
a label, contrast and spacing check.

Check that numbered highlights cover the full typed label, key terms print bold, important
underlines and proof or solution underlines are visible, and neighboring normal text remains
legible. Check highlights for overlap, dark stripes and collisions. Read the same items in
grayscale using labels, weight, boxes and underlines. Use the exact-hash layout verdict to
retain the review. Fix every failed item in the authoring source, rebuild, and repeat the check
on the changed pages and their continuations.

Freeze the PDF SHA-256 before review. Reviewers independent of authoring assess these distinct gates:

1. **Source completeness:** independently read every selected source and reconcile every item and
   subpart with coverage, including historical solutions and exclusions.
2. **Prior-content preservation:** reconcile the previous inventory and every claimed correction or
   equivalent condensation; a label surviving does not prove its argument survived.
3. **Mathematical sufficiency:** check definitions, hypotheses, exceptional cases and worked reasoning
   against sources; establish that condensed proofs/solutions still justify their conclusions.
4. **Selected proof checks:** independently rederive difficult or fragile arguments and calculations;
   record which items were checked and the remaining scope. Sampled checks do not establish all items.
5. **Layout:** inspect every full page and enlarged images of every column at the frozen PDF hash.
   Check emphasis in color and grayscale, all-ink bounds, clipping, collisions, navigation/body
   clearances, voids and every continuation.
6. **Portability:** inspect the fresh isolated build, recorded inputs and release correspondence.

Retain each verdict with its scope, reviewer provenance and exact PDF hash. A mechanical pass cannot
stand in for a mathematical or visual pass. A targeted mutation must fail for its intended semantic
reason, with the failure inspected; a missing file, wrong build or unrelated prerequisite failure is
not that evidence. Restore original bytes and re-establish passing evidence afterward.

Completion: every required gate passed for the exact frozen release, or the handoff names each
unavailable/pending gate without declaring review passed. Any edit invalidates affected evidence
and requires the current bytes to be frozen and reviewed again.

## 6. Package and hand off

Run `package-review` with a fresh destination. It packages the release pair, manifest, coverage,
authoritative fragments where applicable, exact cited source bytes/provenance, checksums and isolated
compile instructions; it validates those bytes and compiles them in isolation before publication.
Retain the exact review/build evidence alongside the release and identify it in the handoff.

The exclusively created destination retains its identity claim. After failure, inspect the partial
claim/bytes, preserve unique work and recover into a fresh destination. Existing destinations are
refused. Set `passed` only when required independent reviews passed the exact packaged PDF hash.

Completion: packaged checksums verify, isolated compilation succeeds, and review state names the
exact packaged PDF or remains pending/unreviewed. Handoff names the release pair, package, evidence,
exact hashes and every remaining limitation.

Preparation/revision continues through authoring, coverage, fitting, independent review, portability
and packaging as one outcome. Resume interrupted work from its manifest, coverage, preserved history
and actual hashes; re-audit changed sources and constraints. Repeated runs retain artifact identity
and use fresh build/evidence/package paths rather than inferring completion from existing files.
