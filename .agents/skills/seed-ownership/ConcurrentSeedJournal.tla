------------------------ MODULE ConcurrentSeedJournal ------------------------
EXTENDS Integers, Sequences
VARIABLES pc, localSequence, journal
vars == <<pc, localSequence, journal>>
Init == /\ pc = [p \in 1..2 |-> "read"]
        /\ localSequence = [p \in 1..2 |-> 0]
        /\ journal = <<>>
Read(p) == /\ pc[p] = "read"
           /\ localSequence' = [localSequence EXCEPT ![p] = Len(journal)]
           /\ pc' = [pc EXCEPT ![p] = "open"] /\ UNCHANGED journal
Open(p) == /\ pc[p] = "open" /\ pc' = [pc EXCEPT ![p] = "append"]
           /\ UNCHANGED <<localSequence, journal>>
AppendRecord(p) == /\ pc[p] = "append"
             /\ journal' = Append(journal, localSequence[p])
             /\ pc' = [pc EXCEPT ![p] = "sync"] /\ UNCHANGED localSequence
Sync(p) == /\ pc[p] = "sync" /\ pc' = [pc EXCEPT ![p] = "done"]
           /\ UNCHANGED <<localSequence, journal>>
Next == \E p \in 1..2: Read(p) \/ Open(p) \/ AppendRecord(p) \/ Sync(p)
UniqueSequence == \A i, j \in 1..Len(journal): i # j => journal[i] # journal[j]
Spec == Init /\ [][Next]_vars
=============================================================================
