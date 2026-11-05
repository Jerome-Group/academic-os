# Artifact naming is evidenced and complete-set

Status: accepted for read-only proposals. Normative activation pending contract 8.

## Decision

Classification remains an evidenced judgment. One pure naming owner consumes accepted metadata,
the complete artifact set and typed occupied paths. CLI `naming plan` and Operations `naming_plan`
return that owner's plan. Neither opens native academic content or writes a destination.

`urn:academic-os:naming-request:1` and `urn:academic-os:naming-policy:1` own input shapes.
Type declarations derive from those schemas through `npm run controls:generate`. Offline Ajv
validates shapes. The existing strict JSON reader rejects ambiguous or malformed byte input.
Semantic checks cover real Gregorian days, adjacent academic years, placement and tokens.
Entry diagnostic pointers are relative to the retained artifact. Global pointers address the request.

`module-artifact-naming/1` requires contract 8. Every proposal currently carries `not-admitted`,
including a caller declaring version 8. That declaration cannot activate a contract or confer
write authority. Contract 7 remains normative for existing Modules. Its curated validator calls
the shared owner under `legacy-curated-name/7`; Textbook chapters retain MF-TEXTBOOK-004.
The canonical writer release must promote the normative naming rules and activation together.

## Proposal policy

Existing category destinations remain exact. Assessment homes stay flat. Tutorial groups and
context-derived Resource categories require supplied placement evidence. Projects and Labs retain
their five workspace children. Unclassified and Miscellaneous do not resolve a classification.
Importer interiors and textbook division naming remain separate domains.

Tokens retain accepted case, internal capitals, uncased-script words and source identifiers. The owner performs no
capitalization inference. Display names use NFC. Source strings, stable IDs, version-bound legacy
identities and evidence references stay unchanged in the returned metadata.

The token order is Module, category, source sequence, title, explicit `Source` identifiers,
academic year, issued day, content traits, annotation trait, grading trait, other qualifiers and
necessary semantic disambiguators. Qualifiers and disambiguators sort by UTF-8 bytes. Source
sequences declare preservation or minimum two-digit padding. Importer ordering is never inferred
as a sequence. Other meaningful identifiers retain their spelling as explicit source tokens.

Content, annotation and grading are independent. Questions may be annotated and graded.
`questions-and-solutions` emits both qualifiers. Known clean artifacts emit `Clean`; unknown
traits emit no claim. Reserved trait qualifiers cannot contradict the typed traits. Representation
kind, role and extension stay independent. A compound native extension stays whole, and a native
bundle remains a bundle rather than a rendered file.

Collision comparison applies NFKC, Unicode 16.0.0 full non-Turkic case folding, then NFKC.
Pinned assigned-codepoint and general-category tables bound the supported character set and token
rules. Later or unassigned scalars remain unresolved. Node must implement Unicode 16 or later
normalization. The [Unicode normalization stability rules](https://www.unicode.org/reports/tr15/#Versioning)
make normalization of this admitted character set stable across supported runtimes.
[Unicode 16 CaseFolding](https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt),
[DerivedAge](https://www.unicode.org/Public/16.0.0/ucd/DerivedAge.txt) and
[DerivedGeneralCategory](https://www.unicode.org/Public/16.0.0/ucd/extracted/DerivedGeneralCategory.txt)
are pinned by SHA-256 in `scripts/generate-naming-unicode.mjs`. Pass those three downloaded files,
in category, fold and age order, to regenerate the checked-in tables. `--check` compares them
without replacement. The source license accompanies the generated data.

Resolution compares the whole candidate set and all occupied paths. A file or native bundle
blocks descendants. An existing directory permits children with its exact spelling. Equivalent
directory spellings remain ambiguous. A colliding candidate adds all accepted semantic
disambiguators in stable order, then the owner compares the complete set again. It repeats when
a generated name introduces another collision. Remaining collisions have no output path.
Enumeration, timestamps and identity hashes never choose a suffix. Components over 240 UTF-8 bytes
remain unresolved rather than losing information through truncation.

## Consequences

A deterministic proposal is reviewable without changing a Module. Accepted metadata can later
feed migration and curation through the same owner. The planner does not establish that supplied
evidence was read or that a classification is correct. It cannot mint authority from an evidence ID.

Legacy curation event identities and their exactly two-digit ordering-prefix behavior remain
unchanged. A future source-identity migration must retain those version-bound values rather than
recompute frozen registers with this naming policy.
