# A source cut into many artifacts is one rederived decision

A combined PDF is worked into a chapter apiece. Each chapter lands in the module's own directories,
and the pass that put it there recorded a `curated` line naming it — one line per chapter, all
against the one source. Every line then asserts that its destination holds that source's content,
so every later pass compares the two, finds a difference, and reports it. The difference is the
work: a chapter cut out of a combined document is not the document. Nothing can settle it, and the
comparison runs again the next morning.

The register already has the word for this. `rederived` is *the item was worked, its content is now
somewhere in the folder, and no verbatim copy was the right output* — and it names the artifacts in
`derived` rather than a `destination`. What the pass reached for instead was the decision that
promises a copy.

**One source worked into several artifacts is one `rederived` decision.** The line names every
artifact the work produced, and it closes the item, so no destination comparison is owed and no
divergence is reported. This is the decision that was always available; it is not a new mechanism,
and the register's five decisions and `schema_version` 3 are unchanged.

## A verbatim copy among the cuts keeps its own curated line

The case is not clean. A source cut into chapters is frequently *also* placed whole, and that whole
copy is a real `curated` decision: its bytes are the source's bytes, and comparing them is a
comparison that means something. One module holds exactly this — a combined document filed as a
course-wide copy beside the six chapters cut out of it, and the copy still hashes to the source.

So the correction is decided per destination and not per source. A destination whose bytes are the
source's is a copy and its line stands. A destination whose bytes are not is a cut, and it belongs
in the `derived` list of the one `rederived` line the correction appends. Reading the source as
"split, therefore nothing about it was ever copied" would supersede a decision that was correct,
and the module would lose the record of where its whole copy went.

## The corrected item gains a line; nothing already written moves

Same restraint as [`0019`](0019-register-identity-migrates-by-superseding-and-decides-nothing-else.md),
for the same reason. The register is append-only history read top to bottom, and the `curated` lines
were what the pass decided on the day it decided them. A `rederived` line supersedes them by
arriving after them and naming what they named; editing them would make the file claim a decision
was taken on a date when it was not.

`supersedes` names the superseded event the way that record established — `<source_id>@<timestamp>`
— which is one string naming every line the batch wrote, because the lines a single pass appended
for one item share both halves.

## An unreadable digest on one line does not stop the item

A correction is offered only where the source still hashes to what the standing lines recorded:
differing bytes are an update arrival, and which issue the module should hold is the Owner's. One
live register records a digest a character short of a sha-256 on a single line of a batch of
thirteen, and the other twelve agree with the source.

Refusing the item over that line would leave the whole source uncorrected and reporting daily, which
is the cost [`0018`](0018-the-morning-believes-a-schema-not-a-transcript.md)'s successor measured
when one bad entry discarded a whole pass: the smaller claim gets the smaller answer. The unreadable
digest is reported and costs its destination nothing — that digest is the *source's*, so it says
whether the batch can be trusted rather than what the destination holds. A digest that *is* readable
and disagrees is the update arrival, and that stops the item.

## Nothing is closed that a worked-on copy could be

Bytes tell a cut from a copy, and they cannot tell a cut from the whole source placed and then
annotated. Both differ from the source, and MF-CURATION-002 says the second is **told** rather than
closed — so a correction that read every differing destination as a cut would quietly retire a
report the contract promises about the Owner's own annotated work.

What separates them is whether the batch's whole copy is accounted for. A batch holding a
destination that still hashes to the source has it, so everything else in that batch is what the
work produced. A batch holding none might have had its whole copy worked on, and there the pass
reports the source and corrects nothing. The one it cannot rule out is the one it does not decide.

## Consequences

The morning stops reporting a divergence it cannot settle. That is the point, and it is also the
risk: a `rederived` line closes the item, so a chapter file that later goes missing or is replaced
is no longer compared against anything. The trade is deliberate — the comparison being retired was
never true, and a comparison that always fails tells a reader nothing about the morning it fails on.

**The cohort correction is `curation rederive`, previewed.** It reads the same active cohort audit
selects, hashes each candidate source and every destination its standing lines name, and prints
what it would append. Nothing is written without `--apply`, every append proves itself under
`docs/agents/safe-drive-testing.md` at the mounted tier, and the run is journalled. A second run
over a corrected register plans nothing, because the item's standing line is now the `rederived` one
and a `rederived` line is not a split to correct.

**The seeded procedure gains the rule, and the cohort's copies gain it on a `pinned refresh`.** Until
that runs, a module's own copy of the Curation Procedure does not name the case and a pass reading
only that folder can reach for `curated` again. The morning prompt is not where this belongs: it is
a rule about what a decision means, which is the procedure's and the contract's.

## Revisit when

A source's derived artifacts need to be compared against anything at all — a chapter that should
still be there and is not. The answer then is a rule about `derived` paths existing, which is a
question about the module's own material rather than about the source that produced it.
