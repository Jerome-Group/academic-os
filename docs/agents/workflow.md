# Repository work

Read `AGENTS.md`, the relevant contract and ADRs, then discover the supported surface through
`capabilities index`. Trace the requested outcome into code, instructions and verification.

Work from an issue with checkable acceptance criteria. For uncertain or multi-session work,
preserve the decisions, evidence, scope and remaining questions in the issue or a linked plan.
Resolve routine implementation choices autonomously. Ask for a material unresolved decision or
missing authority with the concrete proposed result ready for review.

Use installed engineering skills where their discipline improves the work. Their names and
availability vary by harness; an unavailable wrapper does not prevent authorized discovery,
implementation or verification. Agent-facing document changes load `writing-for-agents`.

Fix evidenced defects with a regression at the public seam. Independent review precedes the pull
request. Resolve findings, run required checks against the exact head, tick delivered issue
criteria and report drift under [`acceptance-criteria.md`](acceptance-criteria.md).
`CONTRIBUTING.md` owns issue, branch, pull-request and attribution requirements. Merge authority
comes from the Owner's current request.

At context boundaries, preserve target identities, decisions, evidence and the next executable
step. Resume from that handoff rather than replaying completed work. An ordinary reply leaves the
objective active; a blocked step does not prevent independent authorized work.

Public primary-source research belongs in `docs/research/`, one cited file per question, through
an ordinary pull request. Private operational evidence stays outside the repository.
Throwaway prototypes stay on a linked `prototype/<name>` branch; merge their validated decision
rather than their experimental implementation.
