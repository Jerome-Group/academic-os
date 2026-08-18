# academic-os — context

Running a degree: the modules taken in a semester, the work each one demands, and the folders and
schedules that keep both findable.

## Language

The ubiquitous language of this repository: the words the code, the issues and the commits all
use for the same thing. An entry earns its place when two people — or a person and an agent —
could reasonably mean different things by the same word.

Each entry is the term, what it means **here**, and the near-synonyms to avoid so the wrong one
does not creep back in.

**Module**:
One taught unit of the degree, identified by its module code (`MH2100`). The unit of enrolment
and the unit of organisation — everything else here is scoped to one.
_Avoid_: course, class, subject. *Course* is NTULearn's word for the same thing and appears when
quoting it; *class* is a timetabled session.

**Module folder**:
The directory holding one module's material, laid out to `docs/module-folder-contract.md` and
named for the module code alone. It lives inside the Drive mount, never in this repository.
_Avoid_: module repo — a module folder is not a git repository, and the contract's own deferred
work is what would change that.

**Drive mount**:
The folder on the RAID0 that is synchronised with Google Drive. It is one local view of Drive,
not a second copy to reconcile with the cloud.
_Avoid_: RAID0 copy, local replica

**The contract**:
`docs/module-folder-contract.md`, normative. A module folder that disagrees with it is wrong, and
a rule that is not in it is not a rule.
_Avoid_: the template, the convention. Both suggest a starting point that may be departed from,
which is the opposite of what it is.

**Seed**:
Creating a module folder from the contract, at the start of a semester, after researching what
that module actually has. Additive and one-way: seeding never removes or renames anything.
_Avoid_: scaffold, generate, init

**Conformance**:
The state in which a module folder satisfies every universal and applicable context-derived rule
in the contract.
_Avoid_: exact match, synchronisation

**Deviation**:
A current, observable disagreement between a module folder and an applicable contract rule.
_Avoid_: drift — drift means a change between observations, not merely a present mismatch

**Drift**:
A change in a module folder's conformance between two observations.
_Avoid_: deviation, mismatch

**Repair**:
An approved change to an existing module folder that resolves a deviation without changing the
contract. Unlike a seed, a repair may rename, move, or remove structure.
_Avoid_: seed, migration

**Repair plan**:
The private, versioned and explicitly approved description of one module repair. It binds a
complete Drive-ID inventory, decisions, preconditions, ordered operations, curation events and a
digest; changing any of them invalidates approval.
_Avoid_: shell script, path list

**Recovery snapshot**:
The verified pre-repair evidence needed to restore a module: an ID-mapped Drive copy plus a
SHA-256 byte snapshot on separate storage. Read-only and user-immutable is not regulatory WORM.
_Avoid_: audit observation, Drive Trash

**Contract version**:
The increasing identifier for a distinct set of normative folder requirements. It identifies
which contract a module folder was prepared to follow.
_Avoid_: repository version, commit

**Audit observation**:
A complete record of a module folder's paths, available metadata and conformance results at one
audit time. Comparing audit observations reveals drift without recording file contents.
_Avoid_: backup, snapshot

**Universal structure**:
The directories every module folder has, whatever the module is. Distinguished from the
**context-derived structure**, which appears only when the module has the thing it holds — labs,
projects, quizzes.
_Avoid_: base, default

**Assessment category**:
One of the canonical graded-work directories — `10 Quizzes`, `20 Tests`, `30 Midterms`,
`40 Finals`, `50 Assignments`. Contents are flat; what distinguishes two files is in their names.
_Avoid_: assessment type, exam folder

**Academic contents**:
The material a module folder holds — lecture material, tutorials, notes, submissions, graded work.
Some of it is NTU's and some is a personal record; none of it is committable here
(`docs/adr/0002`).
_Avoid_: files, data. Both are too broad to carry the rule.

**NTULearn mirror**:
The importer-owned copy of NTULearn material inside a module folder's declared importer roots. It
tracks the source and is never reorganised or renamed by curation.
_Avoid_: curated materials, source folder

**Importer root**:
A Definition-declared, automation-owned module directory such as `NTULearn` or
`NTULearn_Tutorial`. Its descendants preserve importer names and sit outside curation rules.
_Avoid_: curated folder, learning materials

**Curation**:
Classifying an item from the NTULearn mirror, copying it into its canonical home, and giving the
copy its curated name. Curation preserves the source item and asks for a decision when placement
is ambiguous.
_Avoid_: move, sync, import

**Curation decision**:
The recorded classification of one NTULearn item as curated, source-only, or requiring a human
decision. A curated decision also identifies the canonical destination and its provenance.
_Avoid_: guess, placement note

**Rederivation**:
Integrating an NTULearn item's content into one or more derived artifacts — module docs, notes,
the module profile — rather than copying the file itself. Recorded in the curation register as its
own decision, naming the derived artifacts where a curated decision names a destination.
_Avoid_: curation — that places a verbatim renamed copy; summarising, extraction

**Module profile**:
The human-facing description of one module, kept at `00 Module Admin/00 Module Profile.md` inside
its module folder. It does not define what the auditor enforces.
_Avoid_: module definition, manifest

**Module definition**:
The machine-readable declaration of one module's identity, contract version, and applicable
context-derived structure, kept at `00 Module Admin/10 Module Definition.yaml`.
_Avoid_: module profile, manifest

**Curation register**:
The append-only history of decisions that connect importer items to curated copies, kept at
`00 Module Admin/20 Curation Register.jsonl`.
_Avoid_: NTULearn state, file inventory

**Monitoring cohort**:
The modules in the active semester, which are checked continuously. Past and future modules sit
outside the cohort and change only after a user request or an agent proposal the user accepts.
_Avoid_: all modules, managed modules

**Live calendar**:
The Google Calendar state that is authoritative for which Calendar items actually exist and what
their current details are.
_Avoid_: Calendar workspace, private plan

**Calendar workspace**:
The private, agent-managed mirror of the Live calendar together with unpromoted Proposals. Humans
do not edit it directly, and its exact schedule data stays outside this public repository.
_Avoid_: Live calendar, source of truth

**Calendar item**:
One entry in the calendar system: either a Calendar event or a Calendar milestone.
_Avoid_: task, time block

**Calendar event**:
A Calendar item with a start and end during which something happens, such as a class, meeting,
appointment, exam or sleep.
_Avoid_: task, work block

**Calendar milestone**:
A Calendar item marking a fixed date or instant without claiming an occupied interval, such as a
deadline.
_Avoid_: Calendar event, task due date

**Owned calendar**:
One of the three calendars the calendar system controls: the primary **Academic** calendar for
classes, assessments, deadlines and invitations; **Commitments** for meetings, appointments,
one-off travel and social events; or **Routine** for sleep and recurring life structure.
_Avoid_: observed calendar, event category

**Observed calendar**:
A visible calendar consulted for conflicts but not controlled by the calendar system, such as a
read-only shared or subscribed calendar.
_Avoid_: owned calendar, managed calendar

**Invited event**:
A Calendar event organised by someone else. Refresh mirrors it and conflict checks include it, but
the calendar system never changes its response, attendees or organiser-owned details.
_Avoid_: owned event

**Recurring series**:
A rule that produces repeated Calendar events together with explicit dated exceptions for changed
or cancelled occurrences.
_Avoid_: duplicated events

**Routine event**:
A recurring life-structure Calendar event such as sleep, exercise, meals, routine travel,
showering or a personal daily standup. It is transparent by default and therefore does not mark
time busy.
_Avoid_: task, fixed commitment

**Refresh**:
An unattended, pull-only update from the Live calendar into the Calendar workspace. It never
changes the Live calendar and preserves unpromoted Proposals; it runs daily, before an interactive
calendar session and after every Promotion.
_Avoid_: synchronisation, promotion

**Proposal**:
An agent-authored Calendar item change in the Calendar workspace that has not entered the Live
calendar.
_Avoid_: draft event, live event

**Promotion**:
An in-session agent action that applies a Proposal to the Live calendar, verifies the resulting
live state, then Refreshes the Calendar workspace.
_Avoid_: refresh, unattended sync

**Calendar tombstone**:
The retained private record that a formerly live Calendar item was deleted. It prevents Refresh
or Promotion from silently recreating that item and retains its last-known details for explicit
restoration.
_Avoid_: Proposal, archived event

**Stale proposal**:
A Proposal whose relevant live state changed or was deleted after the Proposal was prepared. It
must be rebased or abandoned before Promotion.
_Avoid_: conflict resolution, current proposal

**Management horizon**:
The configured instant from which Live calendar items are mirrored and managed, extending without
a future cutoff. Earlier items remain in Google Calendar but outside routine management.
_Avoid_: calendar history, academic year

**Proposal source**:
An extensible input that an agent may translate into Proposals, such as an instruction, timetable,
academic notice, supplied document or calendar import. Tasks and GitHub Issues are never Proposal
sources.
_Avoid_: Live calendar, task integration

**Calendar conflict**:
An overlap found before Promotion across Owned and Observed calendars. Fixed commitments block for
a decision, Routine overlaps warn, and Calendar milestones never occupy time.
_Avoid_: live overlap, task collision

**Placement suggestion**:
A non-mutating warning that a Live calendar item appears on the wrong Owned calendar. Refresh
mirrors the item where it actually is; only a Promotion may move it.
_Avoid_: automatic classification, Proposal

**Stale calendar**:
An Owned calendar whose latest Refresh failed. Its last-good mirror remains available, but it
cannot support Promotion or a complete conflict check until Refresh succeeds.
_Avoid_: empty calendar, failed proposal

**Stale register**:
A Task register whose latest pull failed. Its last-good rows remain readable, and it catches up on
the next successful pull rather than by being edited.
_Avoid_: out-of-date register, unsynced register

**Task**:
A piece of work to complete, owned by task management even when it has a do-date. It is not a
Calendar item.
_Avoid_: Calendar event, Calendar milestone

**Do-date**:
The single date a Task carries — the day the work is planned to be done. It is never a deadline
and never carries a time; a deadline is a Calendar milestone.
_Avoid_: due date. That is Google's name for the same field, and it reads as a deadline — exactly
the misreading this term exists to prevent.

**Task register**:
The agent-managed mirror of one module's Google Tasks list, kept at
`00 Module Admin/30 Task Register.yaml` inside its module folder. The list is the live authority;
the register catches up by pull, never wins a conflict, and carries the provenance the list
cannot.
_Avoid_: task list — that is the live authority the register mirrors; task history — the register
is current state, not an append-only record like the Curation register.

**Operations server**:
The MCP server this repository builds and runs on the mini, exposing its operations — task
operations first, later surfaces joining the same server — to any MCP-speaking agent on the
Tailnet. A machine registers it once at user scope; module folders and their routers never carry
its transport.
_Avoid_: the MCP server — says the protocol, not which surface; the CLI — the same operations run
locally on the mini, not the remote surface; API, backend.

**Tailnet**:
The Owner's private Tailscale network joining the mini and every machine an agent works from.
Reachability on it is the Operations server's entire authorisation — no credential sits on top —
so a machine joins by signing in to Tailscale, never by carrying a key file.
_Avoid_: VPN, private tunnel — both read as infrastructure still to be built, when the tailnet
already runs.

**Teaching workspace**:
The `70 Learning` half of the contract: teaching a subject as the way of learning it, organised by
activity — lectures, tutorials, revision, past papers — with each activity keeping its own
Learning records. Its structure and templates are seeded for every module, used or not.
_Avoid_: notes. Personal notes are `10 Learning Materials/30 Personal Notes`, which is a different
thing done for a different reason.

**Lecture-unit**:
One step of a module's own lecture numbering — a week or a lecture, named exactly as the module
names it. The spine of the Source map and the unit of lecture work in the Teaching workspace.
Several files can belong to one unit; a unit is never subdivided further.
_Avoid_: lecture, class — a unit may span several lecture files; part — a part is a file within a
unit, not a unit.

**Source map**:
The machine-readable declaration of one module's Lecture-units and what belongs to each — topics,
lecture artifacts, textbook chapters, tutorials — kept at `00 Module Admin/40 Source Map.yaml`.
Lecture-units are authoritative: everything else maps onto them.
_Avoid_: syllabus, reading list. Both suggest a human-facing plan rather than the mapping
automations consume.

**Learning record**:
One numbered markdown record in a Teaching workspace activity area, capturing a session against
the named sources it worked from. Records are superseded, never deleted, and one marked as
understanding is evidence-gated: demonstrated, not merely covered.
_Avoid_: transcript, session log — a record keeps what matters later, not what was said; notes.

**Revisit register**:
The Teaching workspace's list of what deserves another pass: confusion, questions the Owner was
completely stuck on, and exam-important questions. Agent-proposed, Owner-accepted, and worked
through and struck manually; it carries no dates and feeds no task system.
_Avoid_: task list, schedule, spaced repetition — all imply timing the register deliberately
refuses.

**Attempt**:
The Owner's completed work on a tutorial or paper, annotated on their own device and dropped into
the unit's workspace folder, where it is renamed with an `_Attempt` suffix. It is what the grading
pass reads.
_Avoid_: submission — graded coursework handed to the university lives in `50 Submissions`;
solution — the writeup the workspace itself produces.

**Textbook shelf**:
The `Textbooks` folder beside the semester roots in the Drive mount — the Owner-supplied,
full-book authority every module extracts chapters from. Books arrive only by the Owner's hand;
its `Archive` subfolder holds retired books, outside the Shelf index.
_Avoid_: library — nothing is borrowed or fetched; textbook folder — ambiguous with a module's
own `20 Textbook Chapters`.

**Shelf index**:
The agent-maintained catalogue at `00 Index.yaml` inside the Textbook shelf: one entry per book,
keyed by Book key, holding the exact filename, title, edition, authors, Division word and
checksum. It owns every book-level fact; agents append entries, and only the Owner renames or
removes one.
_Avoid_: register — registers are module-scoped; book list, catalogue file.

**Book key**:
The globally unique, filename-safe token that names one shelf book everywhere it is referred to —
Shelf index entry, Textbook register citation, chapter filename. First-author surname by default,
Owner-qualified on collision, and immutable once any chapter filename cites it.
_Avoid_: author — several books share one; abbreviation — a key resolves through the index, never
by parsing.

**Division**:
The unit a book divides itself by, in the book's own word — Chapter, Lecture, Part. Recorded once
in the book's Shelf index entry and written in full in chapter filenames; numbering is zero-padded
arabic even where the book prints roman, with the printed original kept in the Textbook register.
_Avoid_: chapter — the common case, not the rule; section.

**Textbook register**:
The chapter-scoped record of what has been extracted into one module, kept at
`00 Module Admin/50 Textbook Register.yaml` and seeded empty. Each entry cites a Book key with the
printed number, table-of-contents title, absolute page range, output filename and the book's
checksum at cut time; nothing book-level is repeated here.
_Avoid_: shelf index — that owns the books; chapter list, extraction log.

**Module glossary**:
The `CONTEXT.md` inside a module folder: that module's organisational language — what its material
is called and how it is classified and named. A term lands only after an ambiguity actually cost a
decision or an exchange; the test for belonging is whether the term changes where a file goes or
what it is named.
_Avoid_: workspace glossary — that is the subject speaking, not the filing of its material; notes.

**Workspace glossary**:
The `GLOSSARY.md` inside `70 Learning`: the subject-matter terms of the module itself, kept for
the learning. A ruling on what the lecturer's word means for classifying or naming files belongs
in the Module glossary instead.
_Avoid_: module glossary, definitions list.

**Module ADR**:
A decision record in a module folder's `docs/adr/`: a standing rule the module follows that the
contract does not force, whose reversal would strand records already built on it. Numbered from
`0001` within its module and immutable once written — a change of mind is a new superseding ADR —
and a per-item decision applying one cites it from the Curation register's evidence.
_Avoid_: curation decision — that classifies one item; repository ADR — a module ADR's numbering
and authority stop at its module folder.

Two terms are Organisation-wide and mean the same thing in every repository:

**Organisation**:
The `Jerome-Group` GitHub org — the top-level account that owns the repositories.
_Avoid_: team, group

**Baseline**:
The configuration every repository in the Organisation inherits — branch protection, the
security defaults, and the per-repository settings. It is applied from the management hub, not
from here.
_Avoid_: template, policy, default
