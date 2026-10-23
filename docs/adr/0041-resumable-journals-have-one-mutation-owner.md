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

Repair mutation requires lowercase change-set storage IDs. Plan creation preserves the supplied
approved ID. Uppercase IDs remain inspectable but require deliberate reconciliation before mutation;
the system does not rename a journal or rewrite an approved plan's identity or digest. This avoids
different cold ownership keys addressing one filename on a case-insensitive filesystem.

This protocol assumes one host, one SQLite implementation per process, stable canonical private
paths and a local filesystem with reliable SQLite locks. It does not coordinate copied or synced
state roots, prove network filesystem locking, make provider calls transactional, or remove the
existing same-user pathname-substitution limitation between filesystem syscalls.
