# Research Procedure

How {{PROJECT_NAME}} turns sources and questions into understanding the Owner can reconstruct.
The durable outputs are reading notes, mathematics, experiments, meeting notes, Claims and
Research-map pointers—not conversation transcripts.

Read `docs/10 Sources and Provenance.md` before relying on a source.

## Choose one question

Start with one explicit mathematical question from `70 Research/QUESTIONS.md` or a Research-map
thread. Name its scope tightly enough that a session can produce evidence: a definition to
reconstruct, an example to compute, an implication to prove, or a counterexample to seek.

Find its registered sources and existing Reading, Mathematics and Experiment artifacts through
`00 Project Admin/40 Research Map.yaml`. Where none exists, source work comes first.

## Work the question

Use one or more of these modes, preserving the question across them:

- **Reading** — work a precise source passage with the reading-note template. State the source's
  claim, reconstruct it in the Owner's words and expose every unresolved step.
- **Mathematics** — use the mathematics-note template for definitions, examples, proof attempts
  and proofs. Mark assumptions and status; a proof attempt stays an attempt until every step is
  checked by the Owner.
- **Experiment** — use the experiment-record template for finite examples or computation. Record
  input, method, environment and output so another run can reproduce it. An experiment motivates
  or tests a Claim; it does not prove a general one.

Agents may explain a source, ask the Owner to recover a step, search for references, test examples,
compile LaTeX and critique an argument. Candidate agent-written mathematics stays in `.scratch/`.
It moves into Research only as the Owner's reconstructed or rewritten version, after citations and
dependencies are checked. Record material adopted help in
`00 Project Admin/60 Contribution and AI Use.md`.

The pass completes when it leaves one durable artifact and the Owner can state what changed: a
question narrowed, a source understood, an example reproduced, a proof advanced, or a Claim
settled. Coverage alone is not completion.

## Claims and questions

`70 Research/CLAIMS.md` is the human ledger for statements the project may rely on. Each entry
carries a heading `## stable-key — Short label`, one `- Status: value` line and:

- a stable short key and status: `candidate`, `checked`, `refuted` or `superseded`;
- the statement with assumptions and scope;
- Source IDs with precise locators;
- the Owner-authored Mathematics or Experiment artifact that checks it;
- remaining dependencies or a superseding Claim.

A Claim becomes `checked` only when the Owner can reconstruct the argument and has verified every
citation. A counterexample makes it `refuted`; a corrected statement supersedes rather than erases
it.

`70 Research/QUESTIONS.md` holds mathematical unknowns, not work scheduling. Strike or move a
question only after naming what settled it; park one with the reason and evidence needed. Its
heading uses the same stable-key interface and its status is `open`, `parked` or `settled`. An
actionable next step becomes a Google Task rather than turning the Questions file into a plan.

## Research map

One Research-map thread ties a topic's Source IDs to its Reading, Mathematics and Experiment
artifacts. Update the thread after the durable artifact exists. The map carries no prose proof,
deadline, task queue or cursor. Close a thread only when its named question is settled or the Owner
records why the project no longer pursues it.

## Supervisor meetings

Before a meeting, copy the meeting template and fill the questions brought, current evidence and
decisions sought. Afterwards, record the guidance in attributed language and separate it from the
Owner's interpretation.

The Owner confirms the note before it becomes durable in `20 Supervisor Meetings/`, named
`YYYY-MM-DD Topic.md`. Turn explicit follow-ups into Tasks. A supervisor suggestion changes a
Claim, source role or Research-map thread only after the Owner works through and records the
effect.

## Glossary

`70 Research/GLOSSARY.md` defines the mathematics used in this project, with a Source ID and locator
where the definition is not the Owner's. Project-organisational words belong in `CONTEXT.md`. Apply
that split before adding either.

## Parking

Park a step whose source cannot be reopened, whose argument has a gap the Owner cannot reconstruct,
whose computation cannot be reproduced, or whose supervisor guidance remains ambiguous. Preserve
the partial artifact, label its status accurately and name the next evidence rather than smoothing
over the gap.
