# Cheatsheet Procedure

How MODULE_CODE creates, revises, audits, verifies and packages a source-led cheatsheet. The
requested operation and the Owner's stated scope, page limit, font floor and furniture are the
constraints for the run. Existing authorization covers routine reversible work within that request.
Ask only when two constraints cannot hold together or the source authority is unresolved.

The `/cheatsheet` route supplies its bundled `cheatsheet-tool.mjs`. Run its `schema` operation once
to resolve command inputs. Every helper command names this module root and the module-relative
`support/<artifact-id>/manifest.yaml`; it uses no repository configuration.

## 1. Resolve assessment context and select sources

For preparation, run `prepare --module-root <root> --module-code MODULE_CODE --assessment <name>`.
It reuses the normative Source Map, preserving unit order, tutorial roles and missing-solution
locators. Read its Profile assessment rows and their cited evidence; discover assessment notices
and relevant importer material when the map is incomplete. Local hashes prove bytes, not upstream
freshness. Check offering and issued dates against the current assessment. Historical practice
can support coverage but cannot establish current scope or permission to use a sheet.

Establish permitted materials, assessed topics, pages, font floor, furniture and deadline from
current evidence and Owner constraints. Show proposed sources with locators, authority, hashes,
known gaps and exclusions. Reuse an explicit “take from” selection already supplied in the request
or existing manifest. Select unambiguous current sources autonomously; ask one targeted question
for material missing, stale or conflicting evidence, ambiguous release identity or incompatible
constraints. Record the decision and continue the same outcome without asking at each stage.

Completion: assessment and constraints have evidence; selected sources cover the stated scope;
material unresolved choices have been resolved or the run names its concrete blocker.

## 2. Select the release and protect its sources

The release is one matching `<artifact>.tex` and `<artifact>.pdf` pair directly in
`10 Learning Materials/30 Personal Notes/`. Its durable working set is
`support/<artifact-id>/`; disposable compilation and fitting output goes in
`.scratch/cheatsheets/<artifact-id>/<run-id>/`.

Read the Profile, Definition, Source Map, requested sources and any existing manifest and coverage
table. Preserve importer originals and Owner attempts byte for byte. Hash every source used. Record
module-relative paths, stable locators and one authority from strongest to weakest: Owner constraint,
current issued material, official solution, audited module work, registered textbook, historical
material, then an original example filling an identified gap. Current assessment scope and issued
sources govern when authorities conflict.

Classify every existing object under the release and support tree before moving or retiring it.
Move a superseded durable draft into `support/<artifact-id>/history/` only after its bytes are proved;
leave reproducible run output in scratch.

Completion: every input has a locator, digest and authority; every existing unique object has a
durable or disposable classification.

## 3. Declare one authoring authority

Create or update `support/<artifact-id>/manifest.yaml` and
`support/<artifact-id>/coverage.csv`. The manifest uses schema version 1 and declares exactly one
composition mode:

- `self-contained`: the top-level release TeX is authored directly and its digest is authoritative;
- `fragments`: the ordered, digested files under `support/<artifact-id>/content/` are authoritative,
  and their exact concatenation produces the top-level release TeX.

The manifest records artifact ID, title and scope; top-level release paths; support path; A4,
monochrome, page, column and preferred/floor body-size constraints; sources with authority, locator
and SHA-256; coverage path; release TeX/PDF hashes; and review status. `passed` names the exact
released PDF hash. Any edit after review returns the current release to `unreviewed` until that exact
PDF passes again. A requested credit is furniture; it does not assert a review occurred.

Coverage CSV uses this exact header:

```text
item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note
```

Record every required item and question part. Priorities are `required`, `high`, `useful`, or
`extension`; dispositions are `verbatim`, `condensed`, `cross-reference`, `excluded`, or `pending`.
An included item points to its stable artifact label. An exclusion carries its reason. Required
items remain included.

Completion: the release source equals its declared authority; the manifest and coverage table
describe all constraints, sources and required coverage without contradiction.

Run the helper's `audit` operation. It must parse the manifest and coverage from their declared
paths, prove every source digest, and prove authoring/release hashes before fitting.

## 4. Create or revise from coverage

Use the mathematics-cheatsheet semantic interface. Configure geometry, columns, native body size and
furniture from the manifest. Give sections and topics stable readable identifiers, use readable
source badges, include a compact page/section map and page numbers, and label every continuation.
Retain source wording as a quote only when the distinction matters; label mathematical
qualifications and original examples by their actual authority.

Compile and measure after each material revision. Begin at the preferred font size.

- Sparse: restore required detail first; then expand rigorous explanation and source-backed examples
  from highest priority downward. Use spacing only after content is complete. Remaining whitespace
  never licenses invented filler.
- Overflow: remove duplicate framing; cross-reference repeats; shorten solutions while retaining
  conditions and reasoning; then cut optional content from lowest priority upward.

Page count, all required coverage and the body-size floor are simultaneous gates. If required
content still overflows at the floor, report the measured conflict and ask which constraint changes.
Geometric scaling is outside this interface.

Completion: measured output meets every hard constraint, every coverage disposition is truthful and
the manifest hashes the current release pair.

Save the measured fields reported by the compile/inspection pass as the helper's measurement JSON,
then run `fit`. Apply one returned expansion, compression or native-font step and measure again.
`blocked` and `user-choice` are stopping states with their recorded reasons.

## 5. Audit or verify

The automated verification pass requires `latexmk` and Poppler's `pdfinfo`, `pdffonts`, `pdftotext`,
`pdftoppm` and `pdftohtml` executables on `PATH`; the helper's `schema` output lists them.

`audit` checks declared manifest/source correspondence, authoring correspondence, constraints,
stable source labels, exclusions and review truth without changing the release. Declared locators do
not enumerate every required source part: read sources to establish completeness independently.
`verify` additionally proves included labels occur in compiled auxiliary evidence, then:

1. copies only the top-level release TeX into a fresh directory and compiles it with `latexmk`;
2. proves portrait A4 and the page constraint, native body size at or above the floor, embedded
   fonts, no missing glyphs, no overfull boxes and no geometric scaling;
3. compares extracted text and 180 dpi renders with the released PDF;
4. inspects every page and column for clipping, collisions, clearances, readable navigation and
   identified continuations;
5. checks every required item and mathematical assumption against its cited source.

Compilation prerequisites are TeX-distribution packages declared by the source. A hidden local file
is a failed portability check.

Run the helper's `verify` operation on the current manifest.

Completion: the rebuilt document matches the released PDF semantically and visually, and the report
identifies the exact TeX and PDF hashes reviewed.

## 6. Package review

Create a fresh review directory containing the top-level release pair, manifest, coverage table,
declared authoritative fragments when present, exact cited source bytes and their provenance, `SHA256SUMS` and a README with the isolated compile
command. Compile that package in isolation before handoff. Record reviewer/model provenance only as
observed history; set `passed` only when the reviewer passed the exact packaged PDF hash.

Run the helper's `package-review` operation with a new destination. Publication retains that
exclusively created directory, records its identity claim, and copies files exclusively. A failure
leaves the partial destination for reconciliation; inspect its claim and bytes, preserve unique
work, and recover into a fresh destination. Existing destinations are refused. It resolves manifest and coverage
from the module, validates them together, packages exact bytes, recompiles those bytes in isolation,
and records the verification result before publishing the directory.

Completion: every packaged checksum verifies, isolated compilation succeeds, and review state names
the exact packaged PDF or remains pending/unreviewed.

Preparation and revision continue through authoring, coverage, fitting, mathematical and visual
review, portable verification and packaging as one outcome. A helper pass proves only its reported
mechanical gates. Inspect every rendered page and independently check required mathematics,
assumptions and worked reasoning before recording a review pass. Name any unavailable gate.

Resume an interrupted run from its manifest, coverage, classified history and actual release hashes.
Re-audit sources and constraints before reuse; changed inputs invalidate affected coverage and
review. Preserve proved unique drafts. Repeated runs reuse the same artifact identity and select a
fresh scratch run and package destination; they never infer completion from files merely existing.
