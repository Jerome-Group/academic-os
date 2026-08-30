# Deliverables Procedure

How {{PROJECT_NAME}} turns Research into a programme output without moving authorship away from
the Owner. The Project Definition's profile says which Deliverable workspaces exist; the Profile
and registered programme sources say what each one requires.

## Open the requirement

Start from one row in `00 Project Admin/50 Deliverable Register.yaml`. Reopen its authority in the
Source Register and verify the current programme template, format, submission route and confirmed
Calendar milestone. A standing month window or old-year date remains provisional and creates a
verification Task; it is not a confirmed deadline.

Before external review or submission, run the release gate in
`00 Project Admin/60 Contribution and AI Use.md`: current GenAI disclosure, confidentiality/data,
intellectual-property, human-subject and receiving-party rules. Record `not applicable` with
evidence; an unresolved branch parks release.

The step completes when every requirement being checked points to current authority and every gap
is visible. A remembered rubric or generated checklist is not authority.

## Start the workspace

Use the exact profile-derived directory under `30 Deliverables/`. Keep within it:

- the Owner's source and rendered artifact;
- the programme template, if one was supplied;
- attributed supervisor or reviewer feedback;
- a copy of `70 Research/templates/deliverable-check.md` for requirement checks;
- submission or acceptance evidence when it exists.

Name drafts `_Draft_01`, `_Draft_02` and so on unless the programme mandates a name. Keep LaTeX
auxiliary output in a local `build/`; keep the rendered artifact beside its source.

## Author and check

The Owner writes the mathematical exposition and chooses every adopted Claim. An agent may:

- compare the artifact with the registered requirement and programme template;
- verify that citations resolve and Claims match the Research artifacts they cite;
- compile, lint, measure, test links and inspect rendering;
- identify unclear exposition, unsupported statements and proof gaps;
- organise feedback as questions for the Owner.

Candidate wording or mathematics from an agent stays in `.scratch/` until the Owner rewrites or
reconstructs it, verifies it and chooses to adopt it. Record material adopted assistance in
`00 Project Admin/60 Contribution and AI Use.md` and follow any programme disclosure rule.

Checking completes when every applicable checklist line is evidenced, every open issue is named,
and the Owner can defend the submitted mathematics. A green compile establishes a PDF, not a
correct proof, submission or acceptance.

## Feedback and versions

Keep supervisor feedback attributed and dated. Apply it in a new draft; preserve a submitted or
reviewed artifact. Where feedback changes a mathematical Claim, return through the Research
procedure before changing the Deliverable.

Use the Deliverable register for status:

```text
not-started -> working -> supervisor-review -> ready -> submitted -> accepted
```

The chain may move backward when evidence requires revision. Set `submitted` only from submission
evidence and `accepted` only from programme or supervisor evidence.

## Tasks and Calendar

Actionable work is a Google Task and its register row. A fixed exact deadline is a Calendar
milestone. The Deliverable register links to both but owns neither dates nor work scheduling.
Its optional milestone is `Academic/<event-id>` from the Live Calendar provider identity. A title,
date, Proposal ID or planning label is not that identity.
Create only the next useful tasks; do not turn every checklist row, Claim or Research question into
a task.

## Parking

Park when the current template or deadline is unverified, a required citation cannot be reopened,
a Claim is unsupported, the Owner has not adopted generated material, feedback conflicts, or
submission evidence is missing. Preserve the artifact and report the exact missing evidence.
