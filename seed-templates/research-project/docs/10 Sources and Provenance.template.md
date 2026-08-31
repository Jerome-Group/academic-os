# Sources and Provenance

How evidence enters {{PROJECT_NAME}}, stays reopenable, and supports later mathematics. The Source
Register identifies sources; `references.bib` owns bibliographic facts; Research artifacts carry
the precise locators actually used.

Read `docs/00 Structure and Naming.md` first.

## Intake

For each candidate source:

1. Open the durable original: an official page or document, DOI record, publisher page, arXiv
   record, or supervisor-provided artifact.
2. Decide its authority (`primary`, `secondary` or `generated`) and role (`programme`, `project`,
   `core`, `reference` or `historical`) from evidence.
3. Give it one immutable Source ID and place any local file in its role home: Programme and
   Project, Core Sources, Reference Sources, URECA Preparation Archive, or Research Aids. A
   generated file uses Research Aids or Unclassified regardless of its role.
4. Add literature bibliography once to `10 Source Materials/references.bib`; record its BibTeX key
   rather than repeating bibliographic facts.
5. Add one Source-register row with a durable locator, local path when present, status and the
   evidence for its classification.

Intake completes when the source can be reopened from its row and another reader can tell why it
has its authority and role. A search result, generated summary or inaccessible citation does not
meet that bound.

## Source authority

**Primary** means the source itself: official programme guidance, the accepted project brief, a
paper or book being studied, a supervisor-provided statement. **Secondary** interprets a primary
source. **Generated** is an aid produced by a model or tool. Generated material may help locate or
question a source; it does not support a Claim.

Programme authority and mathematical authority are separate. An official URECA page governs a
deliverable requirement but proves no theorem. A published paper may support mathematics but does
not confirm this project's registration or deadline.

Research-policy authority is another branch. Before data collection or external release, register
and check the applicable programme, GenAI, data/confidentiality, intellectual-property and
human-subject rules. A pure-mathematics project may record a branch `not applicable` only with
evidence. Unknown ownership, confidentiality or ethics approval parks collection or release.

When sources disagree, register both, describe the exact conflict and leave its consequence in the
Profile's Known Gaps or Research Questions. Recency resolves only where the newer source identifies
the same governed fact and carries equal or higher authority.

## Reading

Start from a registered Source ID. Copy `70 Research/templates/reading-note.md` into
`70 Research/10 Reading/` and name it for that ID.

- Record pages, sections, theorem numbers or another precise locator.
- Separate the source's statement from the Owner's paraphrase, reconstruction and questions.
- Trace prerequisites to their own registered sources.
- Add mathematical terms to `70 Research/GLOSSARY.md` only when the work relies on them.
- Add unresolved mathematical questions to `70 Research/QUESTIONS.md`; actionable reading steps
  become Tasks.

Reading completes when the Owner can state what the selected passage claims, where it says so, and
which part remains unclear. A summary without a locator remains an aid.

## Core and Reference

A Reference source becomes Core when a Research artifact or Claim directly relies on it. Move the
local file, keep its Source ID, update the row's role and `local_file`, and update pointers in one
reviewed change. A Core source becomes retired only when every standing Claim and artifact either
keeps a valid pointer to it or names its replacement.

The Source Register is current state, not reading history. Reading artifacts retain what was
learned; Source rows retain identity, authority and placement.

## Historical and generated material

Historical project material keeps the authority it had: a proposal, abandoned plan or earlier
reading record does not become current because it is useful. Register it as historical and state
what it can evidence. URECA Historical files live in Preparation Archive; Generic Historical files
remain Unclassified.

Generated research aids live in a declared Research Aids directory or
`90 Resources/00 Unclassified/`. If one materially affects adopted work, register its provenance
and record the adoption in `00 Project Admin/60 Contribution and AI Use.md`. Its cited originals,
not the aid, support Claims.

Confidential, sensitive or personal data remains outside external tools unless the current policy's
conditions and authorisation are proved. The stricter rule of a programme, journal, conference or
other recipient governs what leaves the workspace.

## Parking

Park a source whose durable original cannot be found, whose identity collides, whose authority is
unclear, whose file differs from the cited version, or whose move would strand a pointer. Leave its
bytes untouched and name the evidence needed to settle it.
