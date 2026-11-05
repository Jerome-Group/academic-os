--------------------- MODULE CurationRegisterOwnership ---------------------
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS Binding, Broken
Processes == 1..2
Registers == 1..2
Target(p) == IF Binding = "same" THEN 1 ELSE p
Steps == {
  <<"cohort-lstat", "cohort-realpath">>,
  <<"cohort-realpath", "cohort-read">>,
  <<"source-lstat", "source-read">>,
  <<"source-read", "artifact-lstat">>,
  <<"artifact-lstat", "artifact-read">>,
  <<"artifact-read", "acquire">>,
  <<"identity-lstat", "identity-realpath">>,
  <<"identity-realpath", "journal-mkdir">>,
  <<"journal-mkdir", "intent-open">>,
  <<"intent-open", "intent-write">>,
  <<"intent-write", "intent-sync">>,
  <<"intent-sync", "intent-close">>,
  <<"intent-close", "owned-lstat">>,
  <<"owned-lstat", "owned-realpath">>,
  <<"owned-realpath", "owned-read">>,
  <<"owned-source-lstat", "owned-source-read">>,
  <<"owned-source-read", "owned-artifact-lstat">>,
  <<"owned-artifact-lstat", "owned-artifact-read">>,
  <<"owned-artifact-read", "replacement-read">>,
  <<"temporary-open", "temporary-write">>,
  <<"temporary-sync", "temporary-close">>,
  <<"temporary-close", "final-read">>,
  <<"result-open", "result-write">>,
  <<"result-write", "result-sync">>,
  <<"result-sync", "result-close">>,
  <<"refused-open", "refused-write">>,
  <<"refused-write", "refused-sync">>,
  <<"refused-sync", "refused-close">>,
  <<"refused-close", "rollback">>,
  <<"close", "done">>
}
CallbackPCs == {"identity-lstat", "identity-realpath", "journal-mkdir",
  "intent-open", "intent-write", "intent-sync", "intent-close",
  "owned-lstat", "owned-realpath", "owned-read", "owned-source-lstat",
  "owned-source-read", "owned-artifact-lstat", "owned-artifact-read",
  "replacement-read", "temporary-open", "temporary-write", "temporary-sync",
  "temporary-close", "final-read", "rename", "readback", "result-open",
  "result-write", "result-sync", "result-close", "refused-open",
  "refused-write", "refused-sync", "refused-close"}

VARIABLE s
vars == <<s>>
Init == s = [pc |-> [p \in Processes |-> "observe"],
             owner |-> [r \in Registers |-> 0],
             register |-> [r \in Registers |-> <<0>>],
             observed |-> [p \in Processes |-> <<>>],
             temporary |-> [p \in Processes |-> <<>>],
             confirmed |-> {}, staleReplacement |-> FALSE]

Observe(p) == /\ s.pc[p] = "observe"
              /\ s' = [s EXCEPT !.pc[p] = "cohort-lstat",
                        !.observed[p] = s.register[Target(p)]]
Step(p) == \E step \in Steps:
             /\ s.pc[p] = step[1]
             /\ s' = [s EXCEPT !.pc[p] = step[2]]
CohortRead(p) == /\ s.pc[p] = "cohort-read"
                 /\ s' = [s EXCEPT !.pc[p] =
                   IF s.register[Target(p)] = s.observed[p]
                   THEN "source-lstat" ELSE "done"]
Acquire(p) == /\ s.pc[p] = "acquire"
              /\ (s.owner[Target(p)] = 0 \/ Broken = "bypass")
              /\ s' = [s EXCEPT !.pc[p] = "identity-lstat",
                        !.owner[Target(p)] = IF Broken = "bypass" THEN @ ELSE p]
Busy(p) == /\ s.pc[p] = "acquire" /\ s.owner[Target(p)] # 0
           /\ Broken # "bypass"
           /\ s' = [s EXCEPT !.pc[p] = "done"]
OwnedRead(p) == /\ s.pc[p] = "owned-read"
                /\ s' = [s EXCEPT !.pc[p] =
                  IF s.register[Target(p)] = s.observed[p]
                  THEN "owned-source-lstat" ELSE "refused-open"]
ReplacementRead(p) == /\ s.pc[p] = "replacement-read"
                      /\ s' = [s EXCEPT !.pc[p] =
                        IF s.register[Target(p)] = s.observed[p]
                        THEN "temporary-open" ELSE "refused-open"]
TemporaryWrite(p) == /\ s.pc[p] = "temporary-write"
                     /\ s' = [s EXCEPT !.pc[p] = "temporary-sync",
                               !.temporary[p] = Append(s.observed[p], p)]
FinalRead(p) == /\ s.pc[p] = "final-read"
                /\ s' = [s EXCEPT !.pc[p] =
                  IF s.register[Target(p)] = s.observed[p]
                  THEN "rename" ELSE "refused-open"]
Rename(p) == /\ s.pc[p] = "rename"
             /\ s' = [s EXCEPT !.pc[p] = "readback",
                       !.register[Target(p)] = s.temporary[p],
                       !.staleReplacement = @ \/
                         s.register[Target(p)] # s.observed[p]]
Readback(p) == /\ s.pc[p] = "readback"
               /\ s' = [s EXCEPT !.pc[p] =
                 IF s.register[Target(p)] = s.temporary[p]
                 THEN "result-open" ELSE "refused-open"]
ResultClose(p) == /\ s.pc[p] = "result-close"
                  /\ s' = [s EXCEPT !.pc[p] = "rollback",
                            !.confirmed = @ \cup {p}]
Rollback(p) == /\ s.pc[p] = "rollback"
               /\ s' = [s EXCEPT !.pc[p] = "close",
                         !.owner[Target(p)] = IF @ = p THEN 0 ELSE @]
EarlyRelease(p) == /\ Broken = "early-release" /\ s.pc[p] \in CallbackPCs
                   /\ s.owner[Target(p)] = p
                   /\ s' = [s EXCEPT !.owner[Target(p)] = 0]

Next == \E p \in Processes: Observe(p) \/ Step(p) \/ CohortRead(p) \/
        Acquire(p) \/ Busy(p) \/ OwnedRead(p) \/ ReplacementRead(p) \/
        TemporaryWrite(p) \/ FinalRead(p) \/ Rename(p) \/ Readback(p) \/
        ResultClose(p) \/ Rollback(p) \/ EarlyRelease(p)

CurationAppendPreserved ==
  /\ \A r \in Registers: Head(s.register[r]) = 0
  /\ \A p \in s.confirmed:
       \E i \in 1..Len(s.register[Target(p)]): s.register[Target(p)][i] = p
CurationNoStaleReplacement == ~s.staleReplacement
Spec == Init /\ [][Next]_vars
=============================================================================
