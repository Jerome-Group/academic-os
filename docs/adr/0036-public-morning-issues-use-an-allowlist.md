# Public morning issues use an allowlist

Status: accepted. Issue: #261.

Morning reports combine private filesystem paths, source names and model-authored evidence.
Publishing the complete local report to this public repository's issue tracker exposes that
material, including when a clean rerun appends its resolution to an older issue.

Keep complete reports and recovery evidence in private local state. Public issue bodies carry
fixed labels, domain status, counts and allowlisted failure codes. Unknown codes become
`maintenance-failure`; evidence, errors, placements and artifact paths stay local. The existing
cohort marker continues to identify managed issues. A resolution replaces its body with the
public summary rather than carrying old free text forward.

Synthetic tests exercise issue creation, update and resolution with private-looking material in
each free-text surface. Read-only executable readiness supplies installation evidence without
running maintenance or changing configuration. Current imports remain evidence about imports,
not recovery of a failed maintenance session.

Launcher failures before a full report exists leave an atomic private receipt and notify on
failure/recovery transitions. Launcher completion reports execution only; maintenance and
mathematical correctness still require their own evidence.

This change prevents future publication. Existing public history needs separately scoped review;
it does not establish that earlier exposure was removed.
