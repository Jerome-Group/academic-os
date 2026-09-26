# Seeding claims a root before additive publication

The Module contract advances from 6 to 7 and Research-project contract from 2 to 3.
MF-SEED-002 and RP-SEED-002 now require exclusive root creation, a durable device/inode claim,
and additive publication after staging validation.

Node offers no portable exclusive directory rename: ordinary rename can replace an empty folder
that appeared after approval. Another absence check only narrows that race. Exclusive mkdir
preserves the competing name; exclusive file creation preserves existing content. Publication
can expose a partial tree. Resume requires the journalled root identity, checked before each
publication write. A root created before its claim reached durable state refuses resume rather
than inferring ownership from matching contents. Completed legacy journals remain read-only
verifiable when their target, plan and contract bindings still match.

These versions change publication conduct, not folder structure or NTULearn destinations.
Existing version-6 Modules and version-2 Research projects need only deliberate reviewed
acknowledgement in their Definition contract_version fields; pinned refresh does not update those
locally authored stamps. No structural migration is needed. Older versions retain their existing
structural transition requirements. This implementation and its tests write synthetic temporary trees only; no real
Module, Research-project or Drive folder is changed in this session.
