# Evidence cites NTULearn, and never a path into it

Supersedes [ADR-0013](0013-evidence-cites-the-most-durable-form-available.md), which put an
official NTU URL first and an unnumbered interior path last. Both halves of that were wrong for
this system, and the second was wrong for a reason that applies to any numbering scheme.

Evidence names a mirror in one of three forms:

- an importer **landmark** — `Course.md`, `Last synced.md`, `Announcements/`, or a root itself;
- the document's **file name**, exactly as the mirror writes it;
- the document **named in words**, where the file name identifies nothing.

Nothing outside NTULearn is cited, and no citation walks into a mirror's interior.

## Why no external URL

ADR-0013 read the Definition's `<official URL or NTULearn reference>` as a preference and put the
URL first. It is not a preference; this system's evidence is what NTULearn issued to this student
for this offering. An official URL describes the course as published, which is a different claim
and often a different year — the standing OBTL a search turns up for a current offering can be
four years old. The Owner's answer is the shorter one: the folders record what the course actually
handed over, and a reader who wants the published description can go and read it.

## Why no path into the interior

A path into a mirror records the item's **position**, and a position moves whenever NTULearn
inserts above it. This has already gone wrong twice — a syllabus cited at slot 10 came to resolve
against the supplementary material that later filled the slot, and three curated files were
reported as having no register line because a search by their current numbers missed the older ones
their lines record.

ADR-0013's answer was to strip the number out of the citation. That works, and it was still the
wrong answer, because it treats a symptom as the disease. The disease is that a citation was
recording a position at all.

Nor is this the importer's to fix, which was the alternative considered. The importer could
renumber the mirror perfectly on every run and a citation written yesterday would still name the
wrong item today: renumbering keeps the *mirror* faithful to NTULearn's current order, and a
citation is a copy taken at a moment. The mirror is right to carry the numbers — that ordering is
how NTULearn presents the course, and reproducing it is the mirror's job. Only the citation has to
stop copying it.

So the mirror keeps its numbers and its order, and evidence stops recording either.

## What the three forms cost

A file name is not a path, so a reader searches the mirror for it rather than opening a location.
That is the trade, and it is cheap: the mirror is one tree, and a name is what a search takes.

A file name is also not always unique. The importer names every folder's own page
`ultraDocumentBody.md` — forty-four of them in one module of the current cohort — so for those
the file name identifies nothing and the document has to be named in words instead. That is why
the third form exists rather than being a courtesy.

Naming a document in words is weaker evidence than either, because nothing checks it resolves. It
is still better than a path that resolves to the wrong thing, which is the failure this record
exists to remove.

## Consequences

Two Profile cells lose their evidence outright. MH3220's academic units and course type were
known only from official NTU documents, and its mirror states neither, so those facts become
explicit unknowns rather than quietly keeping a citation this record forbids. That is the cost of
the rule landing where it does, and it is visible rather than absorbed.

The check is deterministic on the two structured citations — a Definition's
`evidence.<key>.source` and a Task row's `provenance.source` — and names the file name as the
repair. A Profile Evidence
cell is prose that MF-PROFILE-002 judges; pulling a citation out of prose reliably enough to fail a
folder would be inventing certainty, so the rule binds the Profile and the auditor does not police
it.

MF-IMPORTER-002 is withdrawn with ADR-0013. It asked a reader to confirm no official URL covered a
document, which is a question this system does not want answered.

The contract version holds at 4. A Definition citing an interior path was conformant before this
and is not after, and that is deviation — `contract_version` gates a folder missing structure, and
this adds none.

## Revisit when

A module's evidence cannot be stated in any of the three forms — a fact that exists only outside
NTULearn and matters enough that recording it as unknown is worse than citing where it came from.
MH3220's academic units are the first test of that and were answered the other way.
