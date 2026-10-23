---------------------- MODULE JournalMutationOwnership ----------------------
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS Binding, Broken
Processes == 1..2
Journals == 1..2
Journal(p) == IF Binding = "same" THEN 1 ELSE p
CallbackPCs == {"identity-lstat", "identity-realpath", "read", "staging",
               "publication", "journal-open", "journal-write", "journal-sync",
               "journal-close", "cleanup", "verification", "expire", "drain"}

VARIABLE s
vars == <<s>>
Init == s = [pc |-> [p \in Processes |-> "acquire"],
             owner |-> [j \in Journals |-> 0],
             journal |-> [j \in Journals |-> <<>>],
             completed |-> [j \in Journals |-> FALSE],
             sequence |-> [p \in Processes |-> 0],
             phase |-> [p \in Processes |-> "operation"],
             pending |-> [p \in Processes |-> "none"],
             active |-> {}, expired |-> {}, crashes |-> 0, restarts |-> 0,
             unownedRead |-> FALSE, unownedEffect |-> FALSE,
             prematureRelease |-> FALSE]

Acquire(p) == /\ s.pc[p] = "acquire"
              /\ (s.owner[Journal(p)] = 0 \/ Broken = "bypass")
              /\ s' = [s EXCEPT !.pc[p] = "identity-lstat",
                        !.owner[Journal(p)] = IF Broken = "bypass" THEN @ ELSE p,
                        !.active = @ \cup {p}, !.expired = @ \ {p}]
Busy(p) == /\ s.pc[p] = "acquire" /\ s.owner[Journal(p)] # 0
           /\ Broken # "bypass"
           /\ s' = [s EXCEPT !.pc[p] = "done"]
IdentityLstat(p) == /\ s.pc[p] = "identity-lstat"
                    /\ s' = [s EXCEPT !.pc[p] = "identity-realpath"]
IdentityRealpath(p) == /\ s.pc[p] = "identity-realpath"
                       /\ s' = [s EXCEPT !.pc[p] = "read"]
Read(p) == /\ s.pc[p] = "read"
           /\ s' = [s EXCEPT !.sequence[p] = Len(s.journal[Journal(p)]),
                     !.unownedRead = @ \/ s.owner[Journal(p)] # p,
                     !.phase[p] = "operation",
                     !.pc[p] = IF s.completed[Journal(p)] THEN "expire" ELSE "staging"]
Staging(p) == /\ s.pc[p] = "staging"
              /\ s' = [s EXCEPT !.pc[p] = "publication",
                        !.unownedEffect = @ \/ s.owner[Journal(p)] # p]
Publication(p) == /\ s.pc[p] = "publication"
                  /\ s' = [s EXCEPT !.pc[p] = "journal-open",
                            !.unownedEffect = @ \/ s.owner[Journal(p)] # p]
JournalOpen(p) == /\ s.pc[p] = "journal-open"
                  /\ s' = [s EXCEPT !.pc[p] = "journal-write"]
JournalWrite(p) == /\ s.pc[p] = "journal-write"
                   /\ s' = [s EXCEPT !.pc[p] = "journal-sync",
                             !.journal[Journal(p)] = Append(@, s.sequence[p]),
                             !.unownedEffect = @ \/ s.owner[Journal(p)] # p]
JournalSync(p) == /\ s.pc[p] = "journal-sync"
                  /\ s' = [s EXCEPT !.pc[p] = "journal-close",
                            !.completed[Journal(p)] = @ \/ s.phase[p] = "outcome"]
JournalClose(p) == /\ s.pc[p] = "journal-close"
                   /\ s' = [s EXCEPT !.sequence[p] = @ + 1,
                             !.pc[p] = IF s.phase[p] = "outcome" THEN "expire" ELSE "cleanup"]
Cleanup(p) == /\ s.pc[p] = "cleanup"
              /\ s' = [s EXCEPT !.pc[p] = "verification",
                        !.unownedEffect = @ \/ s.owner[Journal(p)] # p]
Verification(p) == /\ s.pc[p] = "verification"
                   /\ s' = [s EXCEPT !.pc[p] = "journal-open", !.phase[p] = "outcome"]
Expire(p) == /\ s.pc[p] = "expire"
             /\ s' = [s EXCEPT !.pc[p] = "drain", !.expired = @ \cup {p}]
Drain(p) == /\ s.pc[p] = "drain"
            /\ s.pending[p] = "none"
            /\ s' = [s EXCEPT !.pc[p] = "rollback", !.active = @ \ {p}]
Rollback(p) == /\ s.pc[p] = "rollback"
               /\ s' = [s EXCEPT !.pc[p] = "close",
                         !.owner[Journal(p)] = IF @ = p THEN 0 ELSE @]
Close(p) == /\ s.pc[p] = "close"
            /\ s' = [s EXCEPT !.pc[p] = "done"]
AdmitPending(p) == /\ s.pc[p] = "verification" /\ p \notin s.expired
                   /\ s' = [s EXCEPT !.pc[p] = "expire", !.pending[p] = "read"]
PendingRead(p) == /\ s.pending[p] = "read"
                  /\ s' = [s EXCEPT !.pending[p] = "mkdir"]
PendingMkdir(p) == /\ s.pending[p] = "mkdir"
                   /\ s' = [s EXCEPT !.pending[p] = "open"]
PendingOpen(p) == /\ s.pending[p] = "open"
                  /\ s' = [s EXCEPT !.pending[p] = "write"]
PendingWrite(p) == /\ s.pending[p] = "write"
                   /\ s' = [s EXCEPT !.pending[p] = "sync",
                             !.journal[Journal(p)] = Append(@, s.sequence[p]),
                             !.unownedEffect = @ \/ s.owner[Journal(p)] # p]
PendingSync(p) == /\ s.pending[p] = "sync"
                  /\ s' = [s EXCEPT !.pending[p] = "close"]
PendingClose(p) == /\ s.pending[p] = "close"
                   /\ s' = [s EXCEPT !.pending[p] = "directory-open"]
PendingDirectoryOpen(p) == /\ s.pending[p] = "directory-open"
                           /\ s' = [s EXCEPT !.pending[p] = "directory-sync"]
PendingDirectorySync(p) == /\ s.pending[p] = "directory-sync"
                           /\ s' = [s EXCEPT !.pending[p] = "directory-close"]
PendingDirectoryClose(p) == /\ s.pending[p] = "directory-close"
                            /\ s' = [s EXCEPT !.pending[p] = "none"]
EarlyRelease(p) == /\ Broken = "early-release" /\ s.pc[p] \in CallbackPCs
                   /\ s.owner[Journal(p)] = p
                   /\ s' = [s EXCEPT !.owner[Journal(p)] = 0,
                             !.prematureRelease = TRUE]
Crash(p) == /\ s.crashes = 0
            /\ s.pc[p] \notin {"acquire", "done", "dead"}
            /\ s' = [s EXCEPT !.pc[p] = "dead", !.crashes = 1,
                      !.active = @ \ {p}, !.expired = @ \cup {p},
                      !.pending[p] = "none",
                      !.owner[Journal(p)] = IF @ = p THEN 0 ELSE @]
Restart(p) == /\ s.pc[p] = "dead" /\ s.restarts = 0
              /\ s' = [s EXCEPT !.pc[p] = "acquire", !.restarts = 1]

Next == \E p \in Processes: Acquire(p) \/ Busy(p) \/ IdentityLstat(p) \/
        IdentityRealpath(p) \/ Read(p) \/ Staging(p) \/ Publication(p) \/
        JournalOpen(p) \/ JournalWrite(p) \/ JournalSync(p) \/ JournalClose(p) \/
        Cleanup(p) \/ Verification(p) \/ Expire(p) \/ Drain(p) \/ Rollback(p) \/
        Close(p) \/ AdmitPending(p) \/ PendingRead(p) \/ PendingMkdir(p) \/
        PendingOpen(p) \/ PendingWrite(p) \/ PendingSync(p) \/ PendingClose(p) \/
        PendingDirectoryOpen(p) \/ PendingDirectorySync(p) \/ PendingDirectoryClose(p) \/
        EarlyRelease(p) \/ Crash(p) \/ Restart(p)

ExclusiveCallbacks == \A j \in Journals: Cardinality({p \in s.active: Journal(p) = j}) <= 1
OwnerThroughCallback == \A p \in s.active: s.owner[Journal(p)] = p
ReadRequiresOwner == ~s.unownedRead
EffectsRequireOwner == ~s.unownedEffect
UniqueSequence == \A j \in Journals: \A a, b \in 1..Len(s.journal[j]):
                                    a # b => s.journal[j][a] # s.journal[j][b]
FreeJournalAvailable == \A p \in Processes:
                         s.pc[p] = "acquire" /\ s.owner[Journal(p)] = 0 => ENABLED Acquire(p)
CrashClearsOwner == \A p \in Processes: s.pc[p] = "dead" => p \notin {s.owner[j]: j \in Journals}
ReleaseAfterCallback == ~s.prematureRelease
ExpiredSession == \A p \in s.expired: s.pc[p] \notin CallbackPCs \ {"drain"}
Spec == Init /\ [][Next]_vars
=============================================================================
