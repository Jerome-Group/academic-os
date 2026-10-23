--------------------------- MODULE SeedOwnership ---------------------------
EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS PartialTarget, Environment, Broken, MaxFaults

Trees == {"stage", "target"}
Slots == 0..5
Empty == [kind |-> "absent", identity |-> 0, bytes |-> "empty"]
Directory(identity) == [kind |-> "directory", identity |-> identity, bytes |-> "empty"]
File(identity, bytes) == [kind |-> "file", identity |-> identity, bytes |-> bytes]
Link == [kind |-> "link", identity |-> 3, bytes |-> "foreign"]
Parent(n) == CASE n = 0 -> {} [] n = 1 -> {0} [] n = 2 -> {0, 1}
                  [] n = 3 -> {0, 1} [] OTHER -> {0, 1, 2}
InitialTree == [n \in Slots |-> Empty]
InitialTarget == [n \in Slots |-> IF PartialTarget /\ n \in {0, 1}
                                  THEN Directory(1)
                                  ELSE IF PartialTarget /\ n = 3
                                       THEN File(1, "approved") ELSE Empty]

VARIABLE s
vars == <<s>>

Init == s = [pc |-> "boundary", tree |-> "stage", slot |-> 0, generation |-> 1,
             fs |-> [t \in Trees |-> IF t = "target" THEN InitialTarget ELSE InitialTree],
             receipts |-> [t \in Trees |-> IF t = "target" /\ PartialTarget
                          THEN [n \in Slots |-> IF n \in {0, 1} THEN Directory(1) ELSE Empty]
                          ELSE InitialTree],
             observed |-> Empty, created |-> FALSE, pending |-> "none", tail |-> "none",
             prefix |-> 0, crashes |-> 0, retries |-> 0, faults |-> 0, paused |-> FALSE,
             cleaning |-> FALSE,
             cleaned |-> FALSE, verified |-> FALSE, auditSlot |-> 0, ancestor |-> 0, removing |-> FALSE,
             unclaimedEffect |-> FALSE, foreignDeleted |-> FALSE,
             escapedWrite |-> FALSE, adopted |-> FALSE, completed |-> FALSE]

RootMatches(t) == s.fs[t][0].kind = "directory" /\
                  (s.fs[t][0] = s.receipts[t][0] \/
                   (Broken = "claim" /\ t = "stage" /\ s.fs[t][0] = Directory(s.generation)))
Escapes(t, n) == \E p \in Parent(n): s.fs[t][p].kind = "link"
StageExact == \A n \in Slots: s.fs["stage"][n] = s.receipts["stage"][n]
PublicationOwnership == /\ RootMatches("target")
                        /\ \A n \in {1, 2}: s.fs["target"][n] = s.receipts["target"][n]
                                               /\ s.fs["target"][n].kind = "directory"
Refuse == s' = [s EXCEPT !.pc = "refused"]

Boundary == /\ s.pc = "boundary"
            /\ s' = [s EXCEPT !.removing = FALSE, !.pc = IF s.slot = 0 /\ s.fs[s.tree][0] = Empty
                                     THEN "mkdir-root" ELSE "lstat-root"]
MkdirRoot == /\ s.pc = "mkdir-root"
             /\ IF s.fs[s.tree][0] = Empty
                   THEN s' = [s EXCEPT !.fs[s.tree][0] = Directory(s.generation),
                                      !.created = TRUE, !.pc = "capture-root"]
                   ELSE Refuse
CaptureRoot == /\ s.pc = "capture-root"
               /\ s' = [s EXCEPT !.observed = s.fs[s.tree][0], !.pc = "realpath-new-root"]
RealpathNewRoot == /\ s.pc = "realpath-new-root"
                   /\ IF s.observed.kind = "directory" /\ s.observed = s.fs[s.tree][0]
                         THEN s' = [s EXCEPT !.pending = "root", !.pc = "journal-open"]
                         ELSE Refuse
LstatRoot == /\ s.pc = "lstat-root"
             /\ IF RootMatches(s.tree)
                   THEN s' = [s EXCEPT !.observed = s.fs[s.tree][0], !.pc = "realpath-root"]
                   ELSE IF Broken = "adopt" /\ s.tree = "stage" /\ s.slot = 0 /\
                           s.fs["stage"][0].kind = "directory" /\ s.receipts["stage"][0] = Empty
                        THEN s' = [s EXCEPT !.created = FALSE, !.observed = s.fs["stage"][0],
                                           !.pc = "realpath-new-root"]
                        ELSE Refuse
RealpathRoot == /\ s.pc = "realpath-root"
                /\ IF s.observed = s.fs[s.tree][0] /\ RootMatches(s.tree)
                      THEN s' = [s EXCEPT !.ancestor = 0,
                                 !.pc = IF s.slot = 0 THEN "advance" ELSE "lstat-parents"]
                      ELSE Refuse
LstatParents == /\ s.pc = "lstat-parents"
                /\ IF (s.fs[s.tree][s.ancestor].kind = "directory" /\
                       (s.fs[s.tree][s.ancestor] = s.receipts[s.tree][s.ancestor] \/
                        (s.ancestor = 0 /\ Broken = "claim" /\ s.tree = "stage"))) \/ Broken = "escape"
                      THEN s' = [s EXCEPT !.observed = s.fs[s.tree][s.ancestor],
                                 !.pc = "realpath-parents"] ELSE Refuse
RealpathParents == /\ s.pc = "realpath-parents"
                   /\ IF (s.observed = s.fs[s.tree][s.ancestor] /\ s.observed.kind = "directory") \/ Broken = "escape"
                         THEN s' = [s EXCEPT !.ancestor = @ + 1,
                                    !.pc = IF s.ancestor + 1 \in Parent(s.slot) THEN "lstat-parents"
                                           ELSE IF s.removing THEN "inspect-removal-entry" ELSE "inspect-leaf"] ELSE Refuse
InspectLeaf == /\ s.pc = "inspect-leaf"
               /\ IF s.fs[s.tree][s.slot] = Empty
                     THEN s' = [s EXCEPT !.pc = IF s.slot \in {1, 2} THEN "mkdir-entry" ELSE "open-file"]
                     ELSE IF (s.tree = "stage" /\ s.fs[s.tree][s.slot] = s.receipts[s.tree][s.slot]) \/
                             (s.tree = "target" /\ ((s.slot \in {1, 2} /\
                              s.fs[s.tree][s.slot] = s.receipts[s.tree][s.slot]) \/
                              (s.slot \in {3, 4} /\ s.fs[s.tree][s.slot].kind = "file" /\
                               s.fs[s.tree][s.slot].bytes = "approved")))
                          THEN s' = [s EXCEPT !.pc = "advance"] ELSE Refuse
MkdirEntry == /\ s.pc = "mkdir-entry"
              /\ s.fs[s.tree][s.slot] = Empty
              /\ s' = [s EXCEPT !.fs[s.tree][s.slot] = Directory(s.generation),
                       !.unclaimedEffect = @ \/ (s.tree = "stage" /\ s.receipts["stage"][0] = Empty),
                       !.escapedWrite = @ \/ Escapes(s.tree, s.slot), !.pc = "capture-entry"]
OpenFile == /\ s.pc = "open-file"
            /\ s.fs[s.tree][s.slot] = Empty
            /\ s' = [s EXCEPT !.fs[s.tree][s.slot] = File(s.generation, "empty"),
                     !.unclaimedEffect = @ \/ (s.tree = "stage" /\ s.receipts["stage"][0] = Empty),
                     !.escapedWrite = @ \/ Escapes(s.tree, s.slot), !.pc = "write-file"]
WriteFile == /\ s.pc = "write-file"
             /\ s' = [s EXCEPT !.fs[s.tree][s.slot].bytes = "approved",
                      !.escapedWrite = @ \/ Escapes(s.tree, s.slot), !.pc = "sync-file"]
SyncFile == /\ s.pc = "sync-file" /\ s' = [s EXCEPT !.pc = "close-file"]
CloseFile == /\ s.pc = "close-file" /\ s' = [s EXCEPT !.pc = "capture-entry"]
CaptureEntry == /\ s.pc = "capture-entry"
                /\ s' = [s EXCEPT !.observed = s.fs[s.tree][s.slot], !.pc = "hash-entry"]
HashEntry == /\ s.pc = "hash-entry"
             /\ IF s.observed = s.fs[s.tree][s.slot] /\ s.observed.identity = s.generation /\
                    (s.slot \in {1, 2} \/ s.observed.bytes = "approved")
                   THEN s' = [s EXCEPT !.pending = "entry", !.pc = "journal-open"] ELSE Refuse

JournalOpen == /\ s.pc = "journal-open" /\ s' = [s EXCEPT !.pc = "journal-write"]
JournalWrite == /\ s.pc = "journal-write"
                /\ s' = [s EXCEPT !.tail = "written", !.pc = "journal-sync"]
JournalSync == /\ s.pc = "journal-sync"
               /\ s' = [s EXCEPT !.prefix = @ + 1, !.tail = "none",
                        !.receipts[s.tree][s.slot] = IF s.pending \in {"root", "entry"} /\
                            ~(Broken = "claim" /\ s.tree = "stage" /\ s.slot = 0)
                            THEN s.observed ELSE @,
                        !.adopted = @ \/ (s.pending = "root" /\ s.tree = "stage" /\ ~s.created),
                        !.pc = "journal-close"]
JournalClose == /\ s.pc = "journal-close"
                /\ s' = [s EXCEPT !.pc = CASE s.pending = "remove" -> "remove-entry"
                                            [] s.pending = "cleaned" -> "cleaned"
                                            [] OTHER -> "checkpoint",
                                   !.pending = "none"]
Checkpoint == /\ s.pc = "checkpoint" /\ s' = [s EXCEPT !.pc = "advance"]
Advance == /\ s.pc = "advance"
           /\ s' = [s EXCEPT !.slot = @ + 1,
                    !.pc = IF s.slot < 4 THEN "boundary" ELSE IF s.tree = "stage"
                           THEN "stage-audit" ELSE "audit-boundary"]
StageAudit == /\ s.pc = "stage-audit"
              /\ s' = [s EXCEPT !.tree = "target", !.slot = 0,
                       !.pc = IF Broken = "complete" THEN "complete" ELSE "boundary"]
Pause == /\ s.pc = "stage-audit" /\ s.retries = 0 /\ StageExact
         /\ s' = [s EXCEPT !.paused = TRUE, !.pc = "cleanup-preflight", !.slot = 4]
AuditBoundary == /\ s.pc = "audit-boundary"
                 /\ s' = [s EXCEPT !.auditSlot = 0, !.pc = "audit-lstat"]
AuditLstat == /\ s.pc = "audit-lstat"
              /\ IF (s.auditSlot \in {0, 1, 2} /\
                      s.fs["target"][s.auditSlot] = s.receipts["target"][s.auditSlot]) \/
                     (s.auditSlot \in {3, 4} /\ s.fs["target"][s.auditSlot].kind = "file")
                    THEN s' = [s EXCEPT !.pc = "audit-read"] ELSE Refuse
AuditRead == /\ s.pc = "audit-read"
             /\ IF s.auditSlot < 3 \/ s.fs["target"][s.auditSlot].bytes = "approved"
                   THEN s' = [s EXCEPT !.auditSlot = @ + 1,
                              !.pc = IF s.auditSlot < 4 THEN "audit-lstat" ELSE "cleanup-preflight",
                              !.slot = 4, !.tree = "stage", !.verified = s.auditSlot = 4]
                   ELSE Refuse
CleanupPreflight == /\ s.pc = "cleanup-preflight"
                    /\ s' = [s EXCEPT !.cleaning = TRUE, !.auditSlot = 0, !.pc = "cleanup-lstat"]
CleanupLstat == /\ s.pc = "cleanup-lstat"
                /\ IF s.fs["stage"][s.auditSlot] = s.receipts["stage"][s.auditSlot] \/ Broken = "delete"
                      THEN s' = [s EXCEPT !.pc = "cleanup-hash"] ELSE Refuse
CleanupHash == /\ s.pc = "cleanup-hash"
               /\ IF s.fs["stage"][s.auditSlot] = s.receipts["stage"][s.auditSlot] \/ Broken = "delete"
                     THEN s' = [s EXCEPT !.auditSlot = @ + 1, !.pc = "cleanup-list"] ELSE Refuse
CleanupList == /\ s.pc = "cleanup-list"
               /\ s' = [s EXCEPT !.pc = IF s.auditSlot > 5 THEN "cleanup-boundary" ELSE "cleanup-lstat"]
CleanupBoundary == /\ s.pc = "cleanup-boundary"
                   /\ s' = [s EXCEPT !.pc = "inspect-removal"]
InspectRemoval == /\ s.pc = "inspect-removal"
                  /\ s' = [s EXCEPT !.removing = TRUE, !.ancestor = 0,
                           !.pc = IF Broken = "delete" THEN "inspect-removal-entry" ELSE "lstat-parents"]
InspectRemovalEntry == /\ s.pc = "inspect-removal-entry"
                       /\ IF (s.fs["stage"][s.slot].kind = s.receipts["stage"][s.slot].kind /\
                              s.fs["stage"][s.slot].identity = s.receipts["stage"][s.slot].identity /\
                              s.fs["stage"][5] = Empty) \/ Broken = "delete"
                             THEN s' = [s EXCEPT !.pc = "hash-removal-entry"] ELSE Refuse
HashRemovalEntry == /\ s.pc = "hash-removal-entry"
                    /\ IF s.fs["stage"][s.slot] = s.receipts["stage"][s.slot] \/ Broken = "delete"
                          THEN s' = [s EXCEPT !.pending = "remove", !.pc = "journal-open"] ELSE Refuse
RemoveEntry == /\ s.pc = "remove-entry"
               /\ s' = [s EXCEPT !.foreignDeleted = @ \/
                        (s.fs["stage"][s.slot] # s.receipts["stage"][s.slot]) \/
                        (Broken = "delete" /\ s.slot = 0 /\ s.fs["stage"][5] # Empty),
                        !.fs["stage"][s.slot] = Empty,
                        !.fs["stage"][5] = IF Broken = "delete" /\ s.slot = 0 THEN Empty ELSE @,
                        !.receipts["stage"][s.slot] = Empty,
                        !.slot = IF s.slot = 0 THEN 0 ELSE @ - 1,
                        !.pending = IF s.slot = 0 THEN "cleaned" ELSE "none",
                        !.pc = IF s.slot = 0 THEN "journal-open" ELSE "cleanup-boundary"]
Cleaned == /\ s.pc = "cleaned"
           /\ s' = [s EXCEPT !.cleaned = TRUE, !.auditSlot = 0,
                    !.pc = IF s.paused THEN "retry" ELSE "final-lstat"]
FinalLstat == /\ s.pc = "final-lstat"
              /\ IF s.fs["target"][s.auditSlot] = s.receipts["target"][s.auditSlot] /\
                     s.fs["target"][s.auditSlot].kind = "directory"
                    THEN s' = [s EXCEPT !.observed = s.fs["target"][s.auditSlot], !.pc = "final-realpath"] ELSE Refuse
FinalRealpath == /\ s.pc = "final-realpath"
                 /\ IF s.observed = s.fs["target"][s.auditSlot] /\ s.observed.kind = "directory"
                       THEN s' = [s EXCEPT !.auditSlot = @ + 1,
                                  !.pc = IF s.auditSlot = 2 THEN "complete" ELSE "final-lstat"] ELSE Refuse
Retry == /\ s.pc = "retry" /\ s.retries = 0
         /\ s' = [s EXCEPT !.generation = 2, !.retries = 1, !.paused = FALSE,
                  !.tree = "stage", !.slot = 0, !.cleaned = FALSE, !.cleaning = FALSE, !.pc = "boundary"]
Complete == /\ s.pc = "complete"
            /\ IF (s.cleaned /\ s.verified) \/ Broken = "complete"
                  THEN s' = [s EXCEPT !.completed = TRUE, !.pc = "done"] ELSE Refuse

EnvironmentStep == /\ s.faults < MaxFaults
                   /\ (s.pc \in {"boundary", "cleanup-preflight", "cleanup-boundary", "audit-boundary"} \/
                       (Environment = "syscall" /\ s.pc \notin {"done", "refused", "crashed", "retry"}))
                   /\ \E t \in Trees, n \in Slots, node \in {Empty, Link, Directory(3), File(3, "foreign"), File(1, "foreign")}:
                         /\ s.fs[t][n] # node
                         /\ s' = [s EXCEPT !.fs[t][n] = node, !.faults = @ + 1,
                                  !.pc = CASE s.pc = "boundary" -> IF s.slot = 0 /\
                                                                     (IF t = s.tree /\ n = 0 THEN node ELSE s.fs[s.tree][0]) = Empty
                                                                   THEN "mkdir-root" ELSE "lstat-root"
                                              [] s.pc = "cleanup-boundary" -> "inspect-removal"
                                              [] s.pc = "audit-boundary" -> "audit-lstat"
                                              [] s.pc = "cleanup-preflight" -> "cleanup-preflight"
                                              [] OTHER -> @]
Crash == /\ s.crashes = 0 /\ s.pc \notin {"done", "refused", "crashed", "retry"}
         /\ s' = [s EXCEPT !.crashes = 1, !.pc = "crashed",
                  !.fs[s.tree][s.slot] = IF s.pc = "write-file" THEN File(s.generation, "partial") ELSE @,
                  !.tail = IF s.tail = "written" THEN "ambiguous" ELSE @]
Resume == /\ s.pc = "crashed"
          /\ IF s.tail = "ambiguous" \/ s.retries = 1
                THEN Refuse ELSE s' = [s EXCEPT !.retries = 1, !.created = FALSE, !.auditSlot = 0,
                         !.slot = IF s.cleaning THEN @ ELSE 0,
                         !.pending = "none", !.pc = IF s.cleaned THEN "final-lstat"
                                                  ELSE IF s.cleaning THEN "cleanup-preflight" ELSE "boundary"]

Next == Boundary \/ MkdirRoot \/ CaptureRoot \/ RealpathNewRoot \/ LstatRoot \/ RealpathRoot \/
        LstatParents \/ RealpathParents \/ InspectLeaf \/ MkdirEntry \/ OpenFile \/ WriteFile \/
        SyncFile \/ CloseFile \/ CaptureEntry \/ HashEntry \/ JournalOpen \/ JournalWrite \/
        JournalSync \/ JournalClose \/ Checkpoint \/ Advance \/ StageAudit \/ Pause \/
        AuditBoundary \/ AuditLstat \/ AuditRead \/ CleanupPreflight \/ CleanupLstat \/ CleanupHash \/
        CleanupList \/ CleanupBoundary \/ InspectRemoval \/ InspectRemovalEntry \/ HashRemovalEntry \/
        RemoveEntry \/ Cleaned \/ FinalLstat \/
        FinalRealpath \/ Retry \/ Complete \/ EnvironmentStep \/ Crash \/ Resume

ClaimBeforeStageEffect == ~s.unclaimedEffect
NoForeignDeletion == ~s.foreignDeleted
NoEscapedWriteAtGuardedBoundary == ~s.escapedWrite
NoAdoptionFromPathOrBytes == ~s.adopted
CompletionRequiresVerifiedPublicationAndCleanup == s.completed => s.verified /\ s.cleaned /\ PublicationOwnership
Spec == Init /\ [][Next]_vars
=============================================================================
