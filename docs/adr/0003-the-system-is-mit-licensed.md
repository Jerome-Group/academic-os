# The system is MIT licensed

`LICENSE` is MIT. It replaces, wholesale, the all-rights-reserved file this repository was
generated with — the Organisation's written form of *no licence has been chosen yet*, which says in
its own closing paragraph that a repository meant to be open replaces it and records why here. This
is that record.

The hub's ADR-0049 left the question open on purpose when the repository was created, so that the
gap read as deliberate rather than forgotten. This closes it.

## Why a licence at all

Withholding rights is the reversible direction and granting them is not, so the case for waiting is
always available. It loses here on what this repository is *for*.

The repository is published so that someone else can run their degree the way this one is run. That
is an invitation to copy — the folder contract, the naming rules, the conventions — and an
invitation to copy is a grant of rights or it is nothing. Source-available says a reader may look
at the contract and not that they may use it, which is the opposite of the offer being made.
Publishing a system as an example while reserving every right to it is a contradiction a reader has
to resolve by guessing, and they will guess wrong in whichever direction costs them least.

So the choice is not *now versus later*. It is *coherent versus not*.

## Why MIT, when most of this is prose

This is the part that is not `ntulearn`'s argument. That repository is code, where MIT is the
obvious answer. Here the licensed work is a folder contract, a set of conventions, and — later —
whatever automation runs them. The documentation-native licences are the real alternatives:

- **CC BY 4.0** is built for exactly this kind of work and would be defensible. It costs
  attribution as a condition, which is a requirement this repository has no interest in enforcing,
  and it is explicitly not recommended for software — so the day the first script lands, the
  repository is either relicensed or carrying two licences for one tree.
- **CC0 / public domain** grants the most and disclaims warranty least. The disclaimer matters more
  here than the grant: this describes a system for handling a person's academic record, and
  somebody who follows it and loses coursework should find the "AS IS" paragraph rather than a
  question.
- **Apache-2.0** adds a patent grant and a NOTICE mechanism, both of which protect a contributor
  base and a patent position that do not exist. The cost is a licence a reader of a folder contract
  will not finish.
- **GPL-3.0** would make a claim on what other people build out of this. There is nothing here
  worth that claim; a way of naming directories is not a commons to defend.
- **MIT** grants use, modification and redistribution in a paragraph, keeps the warranty
  disclaimer, and is recognised by GitHub's `licensee`, so the sidebar states the position instead
  of leaving a reader to infer it from silence — which was the seeded file's whole complaint.

MIT applying to prose is the objection, and it is a real one: it says "the Software". It defines
that term as the files it ships with, so it operates correctly on a repository of Markdown, and the
practice of licensing documentation repositories this way is old enough to be unremarkable. That is
worse-fitting language in exchange for one licence that will still be right when the automation
arrives, and the alternative — the right words today and a relicence later — is a worse trade for a
repository that is explicitly shaped to grow.

## What the licence does not cover

MIT covers what is **in this repository**: the contract, the conventions, the records, and any code
that follows. It says nothing about the material the system organises, because none of that is here
and none of it is the Owner's to license — lecture material and assessments belong to their authors
and to NTU, and `docs/adr/0002` is why they will never be in a commit for this file to reach.

Worth stating plainly, because `LICENSE` is the file a reader checks, and the question it *looks*
like it answers — "may I do what I like with the coursework this describes?" — is not one it
answers at all.

## Consequences

- **This is not reversible.** Anything published under MIT stays available under MIT to whoever
  already has it; a later relicence binds only what comes after. That is the accepted cost, and it
  is why this is a record rather than a commit message.
- **Contributions arrive under MIT.** Inbound-equals-outbound is the default reading, and with the
  repository public and its issues on, that is what a contributor is agreeing to.
- **`LICENSE` is no longer a seeded file here.** It is owned by this repository, so the
  Organisation's refresh of seeded documents leaves it alone (hub ADR-0039) — the mechanism
  working, not drift.
- **Two of the Organisation's three public repositories are now MIT and one is not.** The reason
  `f1-analytics` is not is in the hub's ADR-0019 and is about being read rather than run; a reader
  comparing them finds a decision in each rather than an inconsistency.

## Revisit when

- **The first real automation lands.** MIT was chosen partly because it survives that transition —
  worth confirming it did, rather than assuming.
- **Someone contributes something substantial.** A contributor base is the condition that makes
  Apache-2.0's patent grant worth its length.
- **Anything in this repository stops being the Owner's to license.** A borrowed template, a
  copied rubric, a contract fragment from a department — the licence covers only what is the
  Owner's to grant, and a file that is not needs to be kept out or attributed rather than silently
  swept under it.
