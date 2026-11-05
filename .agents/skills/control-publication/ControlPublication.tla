---------------------- MODULE ControlPublication ----------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Alias, Broken
Writers == {1, 2}
Candidates == {1, 2}
Target(c) == IF Alias THEN 1 ELSE c
VARIABLES pc, target, gate, boot, progress, expected, head, complete,
          intent, observed, receipt, settled, active, outstanding,
          replaced, rejected, crashed, restarted, selectedOld, selectedCount
vars == <<pc, target, gate, boot, progress, expected, head, complete,
          intent, observed, receipt, settled, active, outstanding,
          replaced, rejected, crashed, restarted, selectedOld, selectedCount>>
Init == /\ pc = [w \in Writers |-> 0]
        /\ target = [w \in Writers |-> 1]
        /\ gate = 0 /\ boot = 0
        /\ progress = [w \in Writers |-> 0]
        /\ expected = [w \in Writers |-> 0]
        /\ head = [c \in Candidates |-> 0]
        /\ complete = {} /\ intent = {} /\ observed = {}
        /\ receipt = {} /\ settled = {} /\ active = {}
        /\ outstanding = 0 /\ replaced = FALSE /\ rejected = {}
        /\ crashed = FALSE /\ restarted = FALSE
        /\ selectedOld = [w \in Writers |-> 0]
        /\ selectedCount = [c \in Candidates |-> [h \in 0..2 |-> 0]]

AnchorResolution(w,c) ==
  /\ pc[w] = 0 /\ pc' = [pc EXCEPT ![w] = 1]
  /\ target' = [target EXCEPT ![w] = Target(c)]
  /\ UNCHANGED <<gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Gate(w) ==
  /\ pc[w] = 1 /\ (gate = 0 \/ Broken = "namespace")
  /\ gate' = w /\ pc' = [pc EXCEPT ![w] = 2]
  /\ active' = active \cup {w}
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>

Bootstrap(w,n) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = n /\ boot' = n + 1
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
LedgerExclusiveCreate(w) == Bootstrap(w,0)
LedgerSelfReservation(w) == Bootstrap(w,1)
LedgerReservationSync(w) == Bootstrap(w,2)
AnchorReservationSync(w) == Bootstrap(w,3)
NamespaceExclusiveCreate(w) == Bootstrap(w,4)
NamespaceSelfClaim(w) == Bootstrap(w,5)
NamespaceClaimSync(w) == Bootstrap(w,6)
NamespaceParentSync(w) == Bootstrap(w,7)

Begin(w) ==
  /\ gate = w /\ pc[w] = 2 /\ (boot = 8 \/ (boot = 9 /\ Broken = "parent-barrier"))
  /\ (intent \subseteq settled \/ Broken = "predecessor")
  /\ pc' = [pc EXCEPT ![w] = 3]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
RefusePending(w) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = 8 /\ ~(intent \subseteq settled)
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount>>

ExpectedHeadResolution(w) ==
  /\ gate = w /\ pc[w] = 3
  /\ expected' = [expected EXCEPT ![w] = head[target[w]]]
  /\ pc' = [pc EXCEPT ![w] = 4]
  /\ UNCHANGED <<target,gate,boot,progress,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Step(w,n,following) ==
  /\ gate = w /\ w \in active /\ pc[w] = n
  /\ (~replaced \/ Broken = "claim")
  /\ pc' = [pc EXCEPT ![w] = following]
  /\ progress' = [progress EXCEPT ![w] = following]
  /\ UNCHANGED <<target,gate,boot,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Advance(w,n) == Step(w,n,n+1)
PlanAppend(w) == Advance(w,4)
PlanSync(w) == Advance(w,5)
StageReservation(w) == Advance(w,6)
StageReservationSync(w) == Advance(w,7)
StageExclusiveCreate(w) == Advance(w,8)
StagePhysicalClaim(w) == Advance(w,9)
StageClaimSync(w) == Advance(w,10)
StageParentSync(w) == Advance(w,11)
DirectoryExclusiveCreate(w) == Advance(w,12)
DirectoryPhysicalClaim(w) == Advance(w,13)
DirectoryClaimSync(w) == Advance(w,14)
DirectoryParentSync(w) == Step(w,15,70)
FileExclusiveCreate(w) == Step(w,70,16)
FilePhysicalClaim(w) == Advance(w,16)
FileClaimSync(w) == Advance(w,17)
WriteGuard(w) ==
  /\ gate = w /\ w \in active /\ pc[w] = 18 /\ outstanding = 0
  /\ (~replaced \/ Broken = "claim")
  /\ outstanding' = w /\ pc' = [pc EXCEPT ![w] = 19]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,replaced,rejected,crashed,restarted,selectedOld,
       selectedCount>>
WriteSyscall(w) ==
  /\ gate = w /\ pc[w] = 19 /\ outstanding = w
  /\ pc' = [pc EXCEPT ![w] = 20] /\ outstanding' = 0
  /\ progress' = [progress EXCEPT ![w] = 20]
  /\ UNCHANGED <<target,gate,boot,expected,head,complete,intent,observed,
       receipt,settled,active,replaced,rejected,crashed,restarted,selectedOld,
       selectedCount>>
FileSync(w) == Advance(w,20)
FileReadback(w) == Advance(w,21)
GenerationDirectorySync(w) == Advance(w,22)
PromotionIntent(w) == Advance(w,23)
PromotionGuard(w) == Advance(w,24)
PromotionSyscall(w) == Advance(w,25)
SourceParentSync(w) == Advance(w,26)
DestinationParentSync(w) == Advance(w,27)
PromotionReadback(w) == Advance(w,28)
CompleteGraphReadback(w) ==
  /\ gate = w /\ pc[w] = 29 /\ (~replaced \/ Broken = "claim")
  /\ complete' = IF Broken = "complete" THEN complete ELSE complete \cup {w}
  /\ pc' = [pc EXCEPT ![w] = 30]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
HeadReservation(w) == Advance(w,30)
HeadCreate(w) == Advance(w,31)
HeadClaim(w) == Advance(w,32)
HeadWrite(w) == Advance(w,33)
HeadSync(w) == Advance(w,34)
HeadReady(w) == Advance(w,35)
PendingReceipt(w) ==
  /\ gate = w /\ pc[w] = 36
  /\ intent' = intent \cup {w} /\ pc' = [pc EXCEPT ![w] = 37]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
ExpectedHeadGuard(w) ==
  /\ gate = w /\ pc[w] = 37
  /\ (head[target[w]] = expected[w] \/ Broken = "expected")
  /\ (~replaced \/ Broken = "claim")
  /\ pc' = [pc EXCEPT ![w] = 38]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
SelectorRename(w) ==
  /\ gate = w /\ pc[w] = 38 /\ w \in active
  /\ head' = [head EXCEPT ![target[w]] = w]
  /\ selectedOld' = [selectedOld EXCEPT ![w] = head[target[w]]]
  /\ selectedCount' = [selectedCount EXCEPT ![target[w]][head[target[w]]] = @ + 1]
  /\ pc' = [pc EXCEPT ![w] = 39]
  /\ UNCHANGED <<target,gate,boot,progress,expected,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted>>
HeadParentSync(w) == Advance(w,39)
HeadReadback(w) ==
  /\ gate = w /\ pc[w] = 40 /\ head[target[w]] = w
  /\ observed' = observed \cup {w} /\ pc' = [pc EXCEPT ![w] = 41]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
ReceiptReservation(w) == Advance(w,41)
ReceiptCreate(w) == Advance(w,42)
ReceiptClaim(w) == Advance(w,43)
ReceiptWrite(w) == Advance(w,44)
ReceiptSync(w) == Advance(w,45)
ReceiptReady(w) == Advance(w,46)
ReceiptPromotionGuard(w) == Advance(w,47)
ReceiptPromotionSyscall(w) ==
  /\ gate = w /\ pc[w] = 48
  /\ receipt' = receipt \cup {w} /\ pc' = [pc EXCEPT ![w] = 49]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
ReceiptSourceParentSync(w) == Advance(w,49)
ReceiptDestinationParentSync(w) == Advance(w,50)
ReceiptReadback(w) == Advance(w,51)
Settlement(w) ==
  /\ gate = w /\ pc[w] = 52 /\ w \in observed /\ w \in receipt
  /\ settled' = settled \cup {w} /\ pc' = [pc EXCEPT ![w] = 60]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Expiry(w) ==
  /\ gate = w /\ pc[w] = 60
  /\ active' = active \ {w} /\ pc' = [pc EXCEPT ![w] = 61]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Drain(w) ==
  /\ gate = w /\ pc[w] = 61 /\ outstanding = 0
  /\ pc' = [pc EXCEPT ![w] = 62]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Release(w) ==
  /\ gate = w /\ pc[w] = 62 /\ outstanding = 0
  /\ gate' = 0 /\ pc' = [pc EXCEPT ![w] = 63]
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Replacement ==
  /\ ~replaced /\ gate # 0 /\ pc[gate] \in 4..37
  /\ replaced' = TRUE
  /\ UNCHANGED <<pc,target,gate,boot,progress,expected,head,complete,intent,
       observed,receipt,settled,active,outstanding,rejected,crashed,restarted,
       selectedOld,selectedCount>>
RejectReplacement(w) ==
  /\ gate = w /\ replaced /\ pc[w] \in 4..38 /\ outstanding = 0
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,
       observed,receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount>>
Crash(w) ==
  /\ ~crashed /\ gate = w /\ pc[w] \in 2..52
  /\ crashed' = TRUE /\ gate' = 0 /\ active' = active \ {w}
  /\ outstanding' = 0 /\ pc' = [pc EXCEPT ![w] = 54]
  /\ progress' = [progress EXCEPT ![w] = pc[w]]
  /\ UNCHANGED <<target,boot,expected,head,complete,intent,observed,
       receipt,settled,replaced,rejected,restarted,selectedOld,selectedCount>>
Restart(w) ==
  /\ crashed /\ ~restarted /\ pc[w] = 54 /\ gate = 0
  /\ restarted' = TRUE /\ gate' = w /\ active' = active \cup {w}
  /\ pc' = [pc EXCEPT ![w] = IF boot = 7 THEN 2 ELSE IF w \in intent THEN
       IF head[target[w]] = w THEN 39 ELSE 37 ELSE IF progress[w] \in 4..36 THEN 58 ELSE 60]
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,selectedOld,
       selectedCount>>
RetryExpectedHead(w) ==
  /\ gate = w /\ pc[w] = 58
  /\ (head[target[w]] = expected[w] \/ Broken = "expected")
  /\ pc' = [pc EXCEPT ![w] = IF progress[w] = 19 THEN 18 ELSE progress[w]]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
RetryStaleHead(w) ==
  /\ gate = w /\ pc[w] = 58 /\ head[target[w]] # expected[w]
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount>>
ExistingNamespaceClaimReplay(w) ==
  /\ gate = w /\ restarted /\ pc[w] = 2 /\ boot = 7
  /\ boot' = 9
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
ReplayedNamespaceParentSync(w) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = 9 /\ boot' = 8
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount>>
Next == Replacement \/ \E w \in Writers:
  (\E c \in Candidates: AnchorResolution(w,c)) \/ Gate(w) \/
  LedgerExclusiveCreate(w) \/ LedgerSelfReservation(w) \/ LedgerReservationSync(w) \/
  AnchorReservationSync(w) \/ NamespaceExclusiveCreate(w) \/ NamespaceSelfClaim(w) \/
  NamespaceClaimSync(w) \/ NamespaceParentSync(w) \/ Begin(w) \/ RefusePending(w) \/
  ExpectedHeadResolution(w) \/ PlanAppend(w) \/ PlanSync(w) \/ StageReservation(w) \/
  StageReservationSync(w) \/ StageExclusiveCreate(w) \/ StagePhysicalClaim(w) \/
  StageClaimSync(w) \/ StageParentSync(w) \/ DirectoryExclusiveCreate(w) \/
  DirectoryPhysicalClaim(w) \/ DirectoryClaimSync(w) \/ DirectoryParentSync(w) \/ FileExclusiveCreate(w) \/
  FilePhysicalClaim(w) \/ FileClaimSync(w) \/ WriteGuard(w) \/ WriteSyscall(w) \/
  FileSync(w) \/ FileReadback(w) \/ GenerationDirectorySync(w) \/ PromotionIntent(w) \/
  PromotionGuard(w) \/ PromotionSyscall(w) \/ SourceParentSync(w) \/
  DestinationParentSync(w) \/ PromotionReadback(w) \/ CompleteGraphReadback(w) \/
  HeadReservation(w) \/ HeadCreate(w) \/ HeadClaim(w) \/ HeadWrite(w) \/ HeadSync(w) \/
  HeadReady(w) \/ PendingReceipt(w) \/ ExpectedHeadGuard(w) \/ SelectorRename(w) \/
  HeadParentSync(w) \/ HeadReadback(w) \/ ReceiptReservation(w) \/ ReceiptCreate(w) \/
  ReceiptClaim(w) \/ ReceiptWrite(w) \/ ReceiptSync(w) \/ ReceiptReady(w) \/
  ReceiptPromotionGuard(w) \/ ReceiptPromotionSyscall(w) \/ ReceiptSourceParentSync(w) \/
  ReceiptDestinationParentSync(w) \/ ReceiptReadback(w) \/ Settlement(w) \/
  Expiry(w) \/ Drain(w) \/ Release(w) \/ RejectReplacement(w) \/ Crash(w) \/ Restart(w) \/
  ExistingNamespaceClaimReplay(w) \/ ReplayedNamespaceParentSync(w) \/ RetryExpectedHead(w) \/ RetryStaleHead(w)
OneOwner == Cardinality(active) <= 1
SelectedComplete == \A c \in Candidates: head[c] # 0 => head[c] \in complete
SuccessAfterReadback == settled \subseteq (observed \cap receipt)
PredecessorSettled == \A w \in Writers: pc[w] \in 3..38 =>
  \A v \in intent \ {w}: v \in settled
ExpectedHead == \A w \in Writers: pc[w] \in 39..52 => selectedOld[w] = expected[w]
SameOldHead == \A c \in Candidates: \A h \in 0..2: selectedCount[c][h] <= 1
OutstandingOwned == outstanding # 0 => gate = outstanding /\ outstanding \in active
ParentBarrierBeforeUse == \A w \in Writers: pc[w] \in 3..52 => boot # 9
Spec == Init /\ [][Next]_vars
=======================================================================
