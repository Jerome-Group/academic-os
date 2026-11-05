---------------------- MODULE ControlPublication ----------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Alias, Broken
Writers == {1, 2}
Candidates == {1, 2}
Target(c) == IF Alias THEN 1 ELSE c
VARIABLES pc, target, gate, boot, progress, expected, head, complete,
          intent, observed, receipt, settled, active, outstanding,
          replaced, rejected, crashed, restarted, selectedOld, selectedCount, attempt, unclaimed, orphanRecords, supplied
vars == <<pc, target, gate, boot, progress, expected, head, complete,
          intent, observed, receipt, settled, active, outstanding,
          replaced, rejected, crashed, restarted, selectedOld, selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Init == /\ pc = [w \in Writers |-> 0]
        /\ target = [w \in Writers |-> 1]
        /\ gate = 0 /\ boot = 0
        /\ progress = [w \in Writers |-> 0]
        /\ expected = [w \in Writers |-> 0]
        /\ supplied = [w \in Writers |-> 0]
        /\ head = [c \in Candidates |-> 0]
        /\ complete = {} /\ intent = {} /\ observed = {}
        /\ receipt = {} /\ settled = {} /\ active = {}
        /\ outstanding = 0 /\ replaced = FALSE /\ rejected = {}
        /\ crashed = FALSE /\ restarted = FALSE
        /\ attempt = [w \in Writers |-> 0]
        /\ unclaimed = {} /\ orphanRecords = {}
        /\ selectedOld = [w \in Writers |-> 0]
        /\ selectedCount = [c \in Candidates |-> [h \in 0..2 |-> 0]]

CallerRequest(w,c,h) ==
  /\ pc[w] = 0 /\ pc' = [pc EXCEPT ![w] = 1]
  /\ target' = [target EXCEPT ![w] = Target(c)]
  /\ supplied' = [supplied EXCEPT ![w] = h]
  /\ UNCHANGED <<gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords>>
AnchorResolution(w) ==
  /\ pc[w] = 1 /\ pc' = [pc EXCEPT ![w] = 71]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Gate(w) ==
  /\ pc[w] = 71 /\ (gate = 0 \/ Broken = "namespace")
  /\ gate' = w /\ pc' = [pc EXCEPT ![w] = 2]
  /\ active' = active \cup {w}
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>

Bootstrap(w,n) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = n /\ boot' = n + 1
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
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
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RefusePending(w) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = 8 /\ ~(intent \subseteq settled)
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>

ExpectedHeadResolution(w) ==
  /\ gate = w /\ pc[w] = 3
  /\ (supplied[w] = head[target[w]] \/ Broken = "expected")
  /\ expected' = [expected EXCEPT ![w] = head[target[w]]]
  /\ pc' = [pc EXCEPT ![w] = 4]
  /\ UNCHANGED <<target,gate,boot,progress,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
InitialStaleRefusal(w) ==
  /\ gate = w /\ pc[w] = 3 /\ supplied[w] # head[target[w]]
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Step(w,n,following) ==
  /\ gate = w /\ w \in active /\ pc[w] = n
  /\ (~replaced \/ Broken = "claim")
  /\ pc' = [pc EXCEPT ![w] = following]
  /\ progress' = [progress EXCEPT ![w] = following]
  /\ UNCHANGED <<target,gate,boot,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
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
       selectedCount,attempt,unclaimed,orphanRecords,supplied>>
WriteSyscall(w) ==
  /\ gate = w /\ pc[w] = 19 /\ outstanding = w
  /\ pc' = [pc EXCEPT ![w] = 20] /\ outstanding' = 0
  /\ progress' = [progress EXCEPT ![w] = 20]
  /\ UNCHANGED <<target,gate,boot,expected,head,complete,intent,observed,
       receipt,settled,active,replaced,rejected,crashed,restarted,selectedOld,
       selectedCount,attempt,unclaimed,orphanRecords,supplied>>
FileSync(w) == Advance(w,20)
FileReadback(w) == Advance(w,21)
GenerationDirectorySync(w) == Advance(w,22)
PromotionIntent(w) == Step(w,23,89)
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
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
HeadReservation(w) == Step(w,30,90)
HeadCreate(w) == Advance(w,31)
HeadClaim(w) == Step(w,32,91)
HeadWrite(w) == Advance(w,33)
HeadSync(w) == Advance(w,34)
HeadReady(w) == Step(w,93,36)
PendingReceipt(w) ==
  /\ gate = w /\ pc[w] = 80
  /\ intent' = intent \cup {w} /\ pc' = [pc EXCEPT ![w] = 81]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
ExpectedHeadGuard(w) ==
  /\ gate = w /\ pc[w] = 37
  /\ head[target[w]] = expected[w]
  /\ (~replaced \/ Broken = "claim")
  /\ pc' = [pc EXCEPT ![w] = 38]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
SelectorRename(w) ==
  /\ gate = w /\ pc[w] = 38 /\ w \in active
  /\ head' = [head EXCEPT ![target[w]] = w]
  /\ selectedOld' = [selectedOld EXCEPT ![w] = head[target[w]]]
  /\ selectedCount' = [selectedCount EXCEPT ![target[w]][supplied[w]] = @ + 1]
  /\ pc' = [pc EXCEPT ![w] = 39]
  /\ UNCHANGED <<target,gate,boot,progress,expected,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       attempt,unclaimed,orphanRecords,supplied>>
HeadParentSync(w) == Advance(w,39)
HeadReadback(w) ==
  /\ gate = w /\ pc[w] = 40 /\ head[target[w]] = w
  /\ observed' = observed \cup {w} /\ pc' = [pc EXCEPT ![w] = 41]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
ReceiptReservation(w) == Step(w,83,84)
ReceiptCreate(w) == Advance(w,42)
ReceiptClaim(w) == Step(w,43,85)
ReceiptWrite(w) == Advance(w,44)
ReceiptSync(w) == Advance(w,45)
ReceiptReady(w) == Step(w,95,47)
ReceiptPromotionGuard(w) == Step(w,88,48)
ReceiptPromotionSyscall(w) ==
  /\ gate = w /\ pc[w] = 48
  /\ receipt' = receipt \cup {w} /\ pc' = [pc EXCEPT ![w] = 49]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
ReceiptSourceParentSync(w) == Advance(w,49)
ReceiptDestinationParentSync(w) == Advance(w,50)
ReceiptReadback(w) == Advance(w,51)
Settlement(w) ==
  /\ gate = w /\ pc[w] = 96 /\ w \in observed /\ w \in receipt
  /\ settled' = settled \cup {w} /\ pc' = [pc EXCEPT ![w] = 60]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Expiry(w) ==
  /\ gate = w /\ pc[w] = 60
  /\ active' = active \ {w} /\ pc' = [pc EXCEPT ![w] = 61]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Drain(w) ==
  /\ gate = w /\ pc[w] = 61 /\ outstanding = 0
  /\ pc' = [pc EXCEPT ![w] = 62]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Release(w) ==
  /\ gate = w /\ pc[w] = 62 /\ outstanding = 0
  /\ gate' = 0 /\ pc' = [pc EXCEPT ![w] = 63]
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Replacement ==
  /\ ~replaced /\ gate # 0 /\ pc[gate] \in 4..37
  /\ replaced' = TRUE
  /\ UNCHANGED <<pc,target,gate,boot,progress,expected,head,complete,intent,
       observed,receipt,settled,active,outstanding,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RejectReplacement(w) ==
  /\ gate = w /\ replaced /\ pc[w] \in 4..38 /\ outstanding = 0
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,
       observed,receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
Crash(w) ==
  /\ ~crashed /\ gate = w /\ pc[w] \in (2..52 \cup {70} \cup 80..96)
  /\ unclaimed' = IF pc[w] \in {9,13,16} THEN unclaimed \cup {<<w,attempt[w]>>} ELSE unclaimed
  /\ crashed' = TRUE /\ gate' = 0 /\ active' = active \ {w}
  /\ outstanding' = 0 /\ pc' = [pc EXCEPT ![w] = 54]
  /\ progress' = [progress EXCEPT ![w] = pc[w]]
  /\ UNCHANGED <<target,boot,expected,head,complete,intent,observed,
       receipt,settled,replaced,rejected,restarted,selectedOld,selectedCount,attempt,orphanRecords,supplied>>
Restart(w) ==
  /\ crashed /\ ~restarted /\ pc[w] = 54 /\ gate = 0
  /\ restarted' = TRUE /\ gate' = w /\ active' = active \cup {w}
  /\ pc' = [pc EXCEPT ![w] = IF boot = 7 THEN 2 ELSE IF w \in intent THEN
       IF head[target[w]] = w THEN 39 ELSE 37 ELSE IF progress[w] \in (4..36 \cup {70,80} \cup 89..93) THEN 58 ELSE 60]
  /\ UNCHANGED <<target,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,outstanding,replaced,rejected,crashed,selectedOld,
       selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RetryExpectedHead(w) ==
  /\ gate = w /\ pc[w] = 58
  /\ (<<w,attempt[w]>> \notin unclaimed \/ Broken = "orphan")
  /\ ((intent \ {w}) \subseteq settled \/ Broken = "predecessor")
  /\ head[target[w]] = expected[w]
  /\ pc' = [pc EXCEPT ![w] = IF progress[w] = 19 THEN 18 ELSE progress[w]]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RetryStaleHead(w) ==
  /\ gate = w /\ pc[w] = 58 /\ head[target[w]] # expected[w]
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RetryPendingRefusal(w) ==
  /\ gate = w /\ pc[w] = 58 /\ ~((intent \ {w}) \subseteq settled)
  /\ pc' = [pc EXCEPT ![w] = 60] /\ rejected' = rejected \cup {w}
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
ExistingNamespaceClaimReplay(w) ==
  /\ gate = w /\ restarted /\ pc[w] = 2 /\ boot = 7
  /\ boot' = 9
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
RetryQuarantine(w) ==
  /\ gate = w /\ pc[w] = 58 /\ <<w,attempt[w]>> \in unclaimed
  /\ (intent \ {w}) \subseteq settled /\ head[target[w]] = expected[w]
  /\ pc' = [pc EXCEPT ![w] = 72]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
OrphanAppend(w) ==
  /\ gate = w /\ pc[w] = 72
  /\ orphanRecords' = orphanRecords \cup {<<w,attempt[w]>>}
  /\ pc' = [pc EXCEPT ![w] = 73]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,supplied>>
OrphanSync(w) == Step(w,73,74)
FreshAttempt(w) ==
  /\ gate = w /\ pc[w] = 74 /\ attempt[w] = 0
  /\ attempt' = [attempt EXCEPT ![w] = 1]
  /\ pc' = [pc EXCEPT ![w] = 6]
  /\ UNCHANGED <<target,gate,boot,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,unclaimed,orphanRecords,supplied>>
ReplayedNamespaceParentSync(w) ==
  /\ gate = w /\ pc[w] = 2 /\ boot = 9 /\ boot' = 8
  /\ UNCHANGED <<pc,target,gate,progress,expected,head,complete,intent,observed,
       receipt,settled,active,outstanding,replaced,rejected,crashed,restarted,
       selectedOld,selectedCount,attempt,unclaimed,orphanRecords,supplied>>
PromotionIntentSync(w) == Step(w,89,24)
HeadReservationSync(w) == Step(w,90,31)
HeadClaimSync(w) == Step(w,91,33)
HeadTemporaryReadback(w) == Step(w,35,92)
HeadTemporaryParentSync(w) == Step(w,92,93)
HeadReadySync(w) == Step(w,36,80)
IntentSync(w) == Step(w,81,37)
HeadObservedAppend(w) == Step(w,41,82)
HeadObservedSync(w) == Step(w,82,83)
ReceiptReservationSync(w) == Step(w,84,42)
ReceiptClaimSync(w) == Step(w,85,44)
ReceiptTemporaryReadback(w) == Step(w,46,94)
ReceiptTemporaryParentSync(w) == Step(w,94,95)
ReceiptReadySync(w) == Step(w,47,86)
ReceiptPromotionIntent(w) == Step(w,86,87)
ReceiptPromotionIntentSync(w) == Step(w,87,88)
SettlementAppend(w) == Step(w,52,96)
Next == Replacement \/ \E w \in Writers:
  (\E c \in Candidates, h \in 0..2: CallerRequest(w,c,h)) \/ AnchorResolution(w) \/ Gate(w) \/
  LedgerExclusiveCreate(w) \/ LedgerSelfReservation(w) \/ LedgerReservationSync(w) \/
  AnchorReservationSync(w) \/ NamespaceExclusiveCreate(w) \/ NamespaceSelfClaim(w) \/
  NamespaceClaimSync(w) \/ NamespaceParentSync(w) \/ Begin(w) \/ RefusePending(w) \/
  ExpectedHeadResolution(w) \/ InitialStaleRefusal(w) \/ PlanAppend(w) \/ PlanSync(w) \/ StageReservation(w) \/
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
  ExistingNamespaceClaimReplay(w) \/ ReplayedNamespaceParentSync(w) \/ RetryExpectedHead(w) \/ RetryStaleHead(w) \/ RetryPendingRefusal(w) \/
  RetryQuarantine(w) \/ OrphanAppend(w) \/ OrphanSync(w) \/ FreshAttempt(w) \/
  PromotionIntentSync(w) \/ HeadReservationSync(w) \/ HeadClaimSync(w) \/ HeadTemporaryReadback(w) \/ HeadTemporaryParentSync(w) \/ HeadReadySync(w) \/ IntentSync(w) \/ HeadObservedAppend(w) \/ HeadObservedSync(w) \/ ReceiptReservationSync(w) \/ ReceiptClaimSync(w) \/ ReceiptTemporaryReadback(w) \/ ReceiptTemporaryParentSync(w) \/ ReceiptReadySync(w) \/ ReceiptPromotionIntent(w) \/ ReceiptPromotionIntentSync(w) \/ SettlementAppend(w)
OneOwner == Cardinality(active) <= 1
SelectedComplete == \A c \in Candidates: head[c] # 0 => head[c] \in complete
SuccessAfterReadback == settled \subseteq (observed \cap receipt)
PredecessorSettled == \A w \in Writers: pc[w] \in 3..38 =>
  \A v \in intent \ {w}: v \in settled
ExpectedHead == \A w \in Writers: pc[w] \in (39..52 \cup 82..88 \cup {94,95,96}) => selectedOld[w] = supplied[w]
SameOldHead == \A c \in Candidates: \A h \in 0..2: selectedCount[c][h] <= 1
OutstandingOwned == outstanding # 0 => gate = outstanding /\ outstanding \in active
ParentBarrierBeforeUse == \A w \in Writers: pc[w] \in 3..52 => boot # 9
NoUnclaimedUse == \A w \in Writers: pc[w] \in 18..52 => <<w,attempt[w]>> \notin unclaimed
OrphanRetention == orphanRecords \subseteq unclaimed
Spec == Init /\ [][Next]_vars
=======================================================================
