# Learn accepts an explicit teaching folder

An independently studied course may already hold the pinned Teaching workspace while its source
collection lives outside the semester tree. Moving that collection under a Module code would imply
the enrollment identity the system's Module means, and copying it would give the course two homes.

The Owner can instead invoke `/learn` with an absolute folder path. The router resolves that exact
directory, checks its materialized local teaching controls, reads its Profile for identity and
scope, and yields to the live procedure as before. Incomplete controls stop the route; the router
does not seed a folder. A path conveys no enrollment, grading, task-list or compute entitlement.

This extends ADR-0017's discovery boundary without moving conduct into the skill. Ordinary
module-code lookup still discovers one directory inside a semester under `Modules/`, independently
of the working directory. Both harnesses retain explicit user invocation. No configuration file,
academic path, new personal-course contract or automatic discovery heuristic is introduced.

The alternative was an implicit search over personal collections. That would require an identity
convention and a second ambiguity mechanism before the personal-course contract exists. An explicit
path spends a little effort at invocation and preserves the existing source collection and its
Drive identity. Its cost is that a path may differ between machines; the Owner supplies the path
on the machine where teaching happens.

Revisit when personal courses need automatic discovery or machine maintenance. Those need a
contract and configuration of their own; this route does not enroll personal folders in Module
audits, task provisioning or NTULearn imports.
