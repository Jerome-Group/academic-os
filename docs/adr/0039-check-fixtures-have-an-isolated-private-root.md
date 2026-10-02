# Check fixtures have an isolated private root

Status: accepted. Issue: #278.

Sandboxed repository checks use an exclusive private fixture/temp directory alongside the code
checkout. Grant that exact directory and the checkout; keep controller receipts, unrelated siblings
and external writes outside the grants. Network access remains disabled. Read-only reviewers gain
no extra writable root. Preserve rendered fixture evidence when a healthy unchanged checkout retires.

Rooting temporary files inside the code checkout made synthetic private state violate the same
containment guards real operation must obey. Ordinary checks passed, but the deployed check-only
entrypoint failed. A focused installed-sandbox fixture reproduced the refusal. Broadening grants to
the parent evidence directory would expose controller receipts; bypassing containment would weaken
the production contract. An exact owned sibling root preserves both boundaries.

This supersedes only ADR-0038's requirement that temporary variables point inside the code checkout.
Its network, privacy, tool-channel, protected merge and target authority boundaries remain. Failed
check output must drain before process exit so retained diagnostics include the failure, not merely
the start of a long test transcript. Production entrypoint verification supplements ordinary CI.
