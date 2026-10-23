# Resumable journals have one mutation owner

Status: accepted. Issue: #335.

Two cooperating resumes could read the same JSONL prefix, allocate the same next sequence and
both perform effects. Append-only sequence validation detected the resulting corruption after
the fact. Stage ownership and provider recovery receipts cannot arbitrate those two invocations.

One SQLite write transaction now owns one canonical local journal for the whole apply callback,
before continuation reads and through mounted/provider effects, cleanup, final verification and
the durable outcome. Preview remains read-only. Repair exposes a bound mutation session instead
of unrestricted append. The session expires when its callback settles; admitted operations still
pending then drain under the owner. Previously handled failures retain their recovery semantics.

The permanent ownership file lives in a separate private namespace under the canonical state
root. SQLite alone opens, creates and closes it and manages any transient companion files.
No application descriptor reads or closes an active ownership file: an ordinary descriptor close
can cancel POSIX locks held by SQLite in the same process. The observed empty ownership files
also permit recovery from a constructor crash before permission normalization. Unexpected
nonempty files, links, multiple links, special files and unsafe metadata refuse without alteration.

Only successful nonblocking acquisition authorizes the callback. Live and stopped owners refuse
competitors; observed process death allows SQLite to recover and a successor to acquire without
deleting or replacing ownership files. Callback, drain and release errors remain operational
failures rather than effect-free busy refusals. Recovery still validates current JSONL and durable
artifact provenance; ambiguous histories remain blocked.

The lease key folds only the journal basename to lowercase under its canonical parent. This keeps
cold case aliases under one owner on case-insensitive filesystems. On case-sensitive filesystems,
distinct case spellings conservatively contend. Journal paths, supplied approved IDs, events and
plan digests retain their spelling; no rename or approval rewrite occurs. Existing noncanonical
path spellings may refuse before mutation rather than select an ambiguous identity.

This protocol assumes one host, one SQLite implementation per process, stable canonical private
paths and a local filesystem with reliable SQLite locks. It does not coordinate copied or synced
state roots, prove network filesystem locking, make provider calls transactional, or remove the
existing same-user pathname-substitution limitation between filesystem syscalls.
