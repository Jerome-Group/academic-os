-------------------------- MODULE NativeSelectorMove --------------------------
EXTENDS Naturals, FiniteSets, Sequences, TLC
CONSTANTS Broken, SelectorKind
VARIABLES pc, gate, scope, claims, physicalLocation, recordedLocation, moveIntent,
     archiveIntent, barriers, moveObserved, nativeSettlement, receipt, retainedAttempts,
     success, attempt, crashCount, crashed, savedPc, expectedOld, readonlyResult, readonlyBasis,
     archiveObserved, generationSettled, refused
vars == <<pc, gate, scope, claims, physicalLocation, recordedLocation, moveIntent,
     archiveIntent, barriers, moveObserved, nativeSettlement, receipt, retainedAttempts,
     success, attempt, crashCount, crashed, savedPc, expectedOld, readonlyResult, readonlyBasis,
     archiveObserved, generationSettled, refused>>
Init == /\ pc = 1 /\ gate = TRUE /\ scope = "exact-request-intent-bridge"
 /\ claims = {} /\ physicalLocation = [new |-> "temporary", old |-> "fixed"]
 /\ recordedLocation \in {"temporary", "false-name"} /\ moveIntent = 0
 /\ archiveIntent = 0 /\ barriers = {} /\ moveObserved = 0 /\ nativeSettlement = FALSE
 /\ receipt = {} /\ retainedAttempts \in {{}, {1, 2}} /\ success = FALSE /\ attempt = Cardinality(retainedAttempts) + 1
 /\ crashCount = 0 /\ crashed = FALSE /\ savedPc = 0
 /\ expectedOld \in {"old-object-and-bytes", "foreign-object"}
 /\ readonlyResult = "none" /\ readonlyBasis = [move |-> 0, archive |-> 0, newHead |-> "temporary", oldLocation |-> "fixed", observed |-> 0, archiveObserved |-> 0, exact |-> FALSE] /\ archiveObserved = 0 /\ generationSettled = FALSE /\ refused = FALSE
ReserveAttemptAppendIndex == 1
ReserveAttemptSyncIndex == 2
GenerationCreateIndex == 3
GenerationClaimAppendIndex == 4
GenerationClaimSyncIndex == 5
GenerationWriteIndex == 6
GenerationFileSyncIndex == 7
GenerationReadbackIndex == 8
GenerationParentSyncIndex == 9
GenerationPromotionIntentAppendIndex == 10
GenerationPromotionIntentSyncIndex == 11
GenerationPromotionSyscallIndex == 12
GenerationSourceParentSyncIndex == 13
GenerationDestinationParentSyncIndex == 14
GenerationDestinationReadbackIndex == 15
GenerationPromotionObservedAppendIndex == 16
GenerationPromotionObservedSyncIndex == 17
GenerationFinalOwnedReadIndex == 18
GenerationFinalFileSyncIndex == 19
GenerationFinalParentSyncIndex == 20
GenerationSettleAppendIndex == 21
GenerationSettleSyncIndex == 22
PolicySelectorIntentAppendIndex == 23
PolicySelectorIntentSyncIndex == 24
CreateFileIndex == 25
AppendFullPhysicalClaimIndex == 26
SyncClaimIndex == 27
WriteBytesIndex == 28
SyncFileIndex == 29
ReadbackBytesAndMetadataIndex == 30
SyncTemporaryParentIndex == 31
AppendMoveIntentIndex == 32
SyncMoveIntentIndex == 33
AppendArchiveIntentIndex == 34
SyncArchiveIntentIndex == 35
GuardFrozenExpectedOldIndex == 36
SelectorSwapSyscallIndex == 37
GuardOldArchiveIndex == 38
ArchiveSyscallIndex == 39
SyncNamespaceAfterSwapArchiveIndex == 40
ReadbackOldAtExactTemporaryOrArchiveIndex == 41
AppendArchiveObservedIndex == 42
SyncArchiveObservedIndex == 43
ReadbackNewHeadIndex == 44
SyncNewFileIndex == 45
SyncNewParentIndex == 46
AppendMoveObservedIndex == 47
SyncMoveObservedIndex == 48
SelectorPostObservationOwnedReadIndex == 49
SettleRegistrationOrSelectorIndex == 50
SyncNativeSettlementIndex == 51
AppendReceiptIntentIndex == 52
SyncReceiptIntentIndex == 53
ReceiptCreateIndex == 54
ReceiptClaimAppendIndex == 55
ReceiptClaimSyncIndex == 56
ReceiptWriteIndex == 57
ReceiptFileSyncIndex == 58
ReceiptReadbackTemporaryIndex == 59
ReceiptParentSyncIndex == 60
ReceiptPromotionIntentAppendIndex == 61
ReceiptPromotionIntentSyncIndex == 62
ReceiptPromotionSyscallIndex == 63
ReceiptSourceParentSyncIndex == 64
ReceiptDestinationParentSyncIndex == 65
ReceiptDestinationReadbackIndex == 66
ReceiptPromotionObservedAppendIndex == 67
ReceiptPromotionObservedSyncIndex == 68
ReceiptFinalOwnedReadIndex == 69
ReceiptFinalFileSyncIndex == 70
ReceiptFinalParentSyncIndex == 71
AppendReceiptSettledIndex == 72
SyncReceiptSettledIndex == 73
ReceiptPostSettlementOwnedReadIndex == 74
ReturnSuccessIndex == 75
GenerationBarrierSteps == {"GenerationClaimSync", "GenerationFileSync", "GenerationReadback", "GenerationParentSync", "GenerationPromotionIntentSync", "GenerationSourceParentSync", "GenerationDestinationParentSync", "GenerationDestinationReadback", "GenerationPromotionObservedSync", "GenerationFinalOwnedRead", "GenerationFinalFileSync", "GenerationFinalParentSync"}
SelectorBarrierSteps == {"SyncClaim", "WriteBytes", "SyncFile", "ReadbackBytesAndMetadata", "SyncTemporaryParent", "SyncNamespaceAfterSwapArchive", "ReadbackOldAtExactTemporaryOrArchive", "ReadbackNewHead", "SyncNewFile", "SyncNewParent", "SelectorPostObservationOwnedRead"}
ReceiptSteps == {"AppendReceiptIntent", "SyncReceiptIntent", "ReceiptCreate", "ReceiptClaimAppend", "ReceiptClaimSync", "ReceiptWrite", "ReceiptFileSync", "ReceiptReadbackTemporary", "ReceiptParentSync", "ReceiptPromotionIntentAppend", "ReceiptPromotionIntentSync", "ReceiptPromotionSyscall", "ReceiptSourceParentSync", "ReceiptDestinationParentSync", "ReceiptDestinationReadback", "ReceiptPromotionObservedAppend", "ReceiptPromotionObservedSync", "ReceiptFinalOwnedRead", "ReceiptFinalFileSync", "ReceiptFinalParentSync", "AppendReceiptSettled", "SyncReceiptSettled", "ReceiptPostSettlementOwnedRead"}
Advance(label, i) == /\ ~crashed /\ ~refused /\ gate /\ pc = i
 /\ (label # "AppendMoveObserved" \/ archiveObserved = 2)
 /\ pc' = (IF label = "GuardFrozenExpectedOld" /\ expectedOld # "old-object-and-bytes"
             THEN 0 ELSE IF label = "SettleRegistrationOrSelector" /\ recordedLocation = "false-name" /\ Broken # "location"
             THEN 0 ELSE IF label = "GenerationFinalParentSync" /\ SelectorKind = "registration" THEN CreateFileIndex ELSE IF label = "SyncNativeSettlement" /\ SelectorKind = "registration" THEN ReturnSuccessIndex ELSE i + 1)
 /\ refused' = (refused \/ (label = "GuardFrozenExpectedOld" /\ expectedOld # "old-object-and-bytes")
                    \/ (label = "SettleRegistrationOrSelector" /\ recordedLocation = "false-name" /\ Broken # "location"))
 /\ claims' = (IF label = "GenerationClaimAppend" THEN claims \cup {"generation"}
              ELSE IF label = "AppendFullPhysicalClaim" THEN claims \cup {"selector"} ELSE claims)
 /\ physicalLocation' = (IF label = "SelectorSwapSyscall" THEN [new |-> "fixed", old |-> "swapped-temporary"]
                       ELSE IF label = "ArchiveSyscall" THEN [physicalLocation EXCEPT !.old = "archive"] ELSE physicalLocation)
 /\ moveIntent' = (IF label = "AppendMoveIntent" THEN 1 ELSE IF label = "SyncMoveIntent" THEN 2 ELSE moveIntent)
 /\ archiveIntent' = (IF label = "AppendArchiveIntent" THEN 1 ELSE IF label = "SyncArchiveIntent" THEN 2 ELSE archiveIntent)
 /\ barriers' = (IF label \in (GenerationBarrierSteps \cup SelectorBarrierSteps) THEN barriers \cup {label} ELSE barriers)
 /\ archiveObserved' = (IF label = "AppendArchiveObserved" THEN 1 ELSE IF label = "SyncArchiveObserved" THEN 2 ELSE archiveObserved)
 /\ moveObserved' = (IF label = "AppendMoveObserved" THEN 1 ELSE IF label = "SyncMoveObserved" THEN 2 ELSE moveObserved)
 /\ nativeSettlement' = (nativeSettlement \/ (label = "SettleRegistrationOrSelector" /\ (recordedLocation # "false-name" \/ Broken = "location")))
 /\ receipt' = (IF label \in ReceiptSteps THEN receipt \cup {label} ELSE receipt)
 /\ generationSettled' = (generationSettled \/ (label = "GenerationSettleSync" /\ SelectorKind = "policy") \/ (label = "GenerationFinalParentSync" /\ SelectorKind = "registration"))
 /\ success' = (success \/ label = "ReturnSuccess")
 /\ UNCHANGED <<gate, scope, recordedLocation, retainedAttempts, attempt, crashCount, crashed, savedPc, expectedOld, readonlyResult, readonlyBasis>>
ReserveAttemptAppend == Advance("ReserveAttemptAppend", ReserveAttemptAppendIndex)
ReserveAttemptSync == Advance("ReserveAttemptSync", ReserveAttemptSyncIndex)
GenerationCreate == Advance("GenerationCreate", GenerationCreateIndex)
GenerationClaimAppend == Advance("GenerationClaimAppend", GenerationClaimAppendIndex)
GenerationClaimSync == Advance("GenerationClaimSync", GenerationClaimSyncIndex)
GenerationWrite == Advance("GenerationWrite", GenerationWriteIndex)
GenerationFileSync == Advance("GenerationFileSync", GenerationFileSyncIndex)
GenerationReadback == Advance("GenerationReadback", GenerationReadbackIndex)
GenerationParentSync == Advance("GenerationParentSync", GenerationParentSyncIndex)
GenerationPromotionIntentAppend == Advance("GenerationPromotionIntentAppend", GenerationPromotionIntentAppendIndex)
GenerationPromotionIntentSync == Advance("GenerationPromotionIntentSync", GenerationPromotionIntentSyncIndex)
GenerationPromotionSyscall == Advance("GenerationPromotionSyscall", GenerationPromotionSyscallIndex)
GenerationSourceParentSync == Advance("GenerationSourceParentSync", GenerationSourceParentSyncIndex)
GenerationDestinationParentSync == Advance("GenerationDestinationParentSync", GenerationDestinationParentSyncIndex)
GenerationDestinationReadback == Advance("GenerationDestinationReadback", GenerationDestinationReadbackIndex)
GenerationPromotionObservedAppend == Advance("GenerationPromotionObservedAppend", GenerationPromotionObservedAppendIndex)
GenerationPromotionObservedSync == Advance("GenerationPromotionObservedSync", GenerationPromotionObservedSyncIndex)
GenerationFinalOwnedRead == Advance("GenerationFinalOwnedRead", GenerationFinalOwnedReadIndex)
GenerationFinalFileSync == Advance("GenerationFinalFileSync", GenerationFinalFileSyncIndex)
GenerationFinalParentSync == Advance("GenerationFinalParentSync", GenerationFinalParentSyncIndex)
GenerationSettleAppend == /\ SelectorKind = "policy" /\ Advance("GenerationSettleAppend", GenerationSettleAppendIndex)
GenerationSettleSync == /\ SelectorKind = "policy" /\ Advance("GenerationSettleSync", GenerationSettleSyncIndex)
PolicySelectorIntentAppend == /\ SelectorKind = "policy" /\ Advance("PolicySelectorIntentAppend", PolicySelectorIntentAppendIndex)
PolicySelectorIntentSync == /\ SelectorKind = "policy" /\ Advance("PolicySelectorIntentSync", PolicySelectorIntentSyncIndex)
CreateFile == Advance("CreateFile", CreateFileIndex)
AppendFullPhysicalClaim == Advance("AppendFullPhysicalClaim", AppendFullPhysicalClaimIndex)
SyncClaim == Advance("SyncClaim", SyncClaimIndex)
WriteBytes == Advance("WriteBytes", WriteBytesIndex)
SyncFile == Advance("SyncFile", SyncFileIndex)
ReadbackBytesAndMetadata == Advance("ReadbackBytesAndMetadata", ReadbackBytesAndMetadataIndex)
SyncTemporaryParent == Advance("SyncTemporaryParent", SyncTemporaryParentIndex)
AppendMoveIntent == Advance(IF Broken = "intent" THEN "OmitAppendMoveIntent" ELSE "AppendMoveIntent", AppendMoveIntentIndex)
SyncMoveIntent == Advance(IF Broken = "intent" THEN "OmitSyncMoveIntent" ELSE "SyncMoveIntent", SyncMoveIntentIndex)
AppendArchiveIntent == Advance("AppendArchiveIntent", AppendArchiveIntentIndex)
SyncArchiveIntent == Advance("SyncArchiveIntent", SyncArchiveIntentIndex)
GuardFrozenExpectedOld == Advance("GuardFrozenExpectedOld", GuardFrozenExpectedOldIndex)
SelectorSwapSyscall == Advance("SelectorSwapSyscall", SelectorSwapSyscallIndex)
GuardOldArchive == Advance("GuardOldArchive", GuardOldArchiveIndex)
ArchiveSyscall == Advance("ArchiveSyscall", ArchiveSyscallIndex)
SyncNamespaceAfterSwapArchive == Advance("SyncNamespaceAfterSwapArchive", SyncNamespaceAfterSwapArchiveIndex)
ReadbackOldAtExactTemporaryOrArchive == Advance("ReadbackOldAtExactTemporaryOrArchive", ReadbackOldAtExactTemporaryOrArchiveIndex)
AppendArchiveObserved == Advance("AppendArchiveObserved", AppendArchiveObservedIndex)
SyncArchiveObserved == Advance("SyncArchiveObserved", SyncArchiveObservedIndex)
ReadbackNewHead == Advance("ReadbackNewHead", ReadbackNewHeadIndex)
SyncNewFile == Advance("SyncNewFile", SyncNewFileIndex)
SyncNewParent == Advance("SyncNewParent", SyncNewParentIndex)
AppendMoveObserved == Advance("AppendMoveObserved", AppendMoveObservedIndex)
SyncMoveObserved == Advance("SyncMoveObserved", SyncMoveObservedIndex)
SelectorPostObservationOwnedRead == Advance("SelectorPostObservationOwnedRead", SelectorPostObservationOwnedReadIndex)
SettleRegistrationOrSelector == Advance("SettleRegistrationOrSelector", SettleRegistrationOrSelectorIndex)
SyncNativeSettlement == Advance("SyncNativeSettlement", SyncNativeSettlementIndex)
AppendReceiptIntent == Advance("AppendReceiptIntent", AppendReceiptIntentIndex)
SyncReceiptIntent == Advance("SyncReceiptIntent", SyncReceiptIntentIndex)
ReceiptCreate == Advance("ReceiptCreate", ReceiptCreateIndex)
ReceiptClaimAppend == Advance("ReceiptClaimAppend", ReceiptClaimAppendIndex)
ReceiptClaimSync == Advance("ReceiptClaimSync", ReceiptClaimSyncIndex)
ReceiptWrite == Advance("ReceiptWrite", ReceiptWriteIndex)
ReceiptFileSync == Advance("ReceiptFileSync", ReceiptFileSyncIndex)
ReceiptReadbackTemporary == Advance("ReceiptReadbackTemporary", ReceiptReadbackTemporaryIndex)
ReceiptParentSync == Advance("ReceiptParentSync", ReceiptParentSyncIndex)
ReceiptPromotionIntentAppend == Advance("ReceiptPromotionIntentAppend", ReceiptPromotionIntentAppendIndex)
ReceiptPromotionIntentSync == Advance("ReceiptPromotionIntentSync", ReceiptPromotionIntentSyncIndex)
ReceiptPromotionSyscall == Advance("ReceiptPromotionSyscall", ReceiptPromotionSyscallIndex)
ReceiptSourceParentSync == Advance("ReceiptSourceParentSync", ReceiptSourceParentSyncIndex)
ReceiptDestinationParentSync == Advance("ReceiptDestinationParentSync", ReceiptDestinationParentSyncIndex)
ReceiptDestinationReadback == Advance("ReceiptDestinationReadback", ReceiptDestinationReadbackIndex)
ReceiptPromotionObservedAppend == Advance("ReceiptPromotionObservedAppend", ReceiptPromotionObservedAppendIndex)
ReceiptPromotionObservedSync == Advance("ReceiptPromotionObservedSync", ReceiptPromotionObservedSyncIndex)
ReceiptFinalOwnedRead == Advance("ReceiptFinalOwnedRead", ReceiptFinalOwnedReadIndex)
ReceiptFinalFileSync == Advance("ReceiptFinalFileSync", ReceiptFinalFileSyncIndex)
ReceiptFinalParentSync == Advance("ReceiptFinalParentSync", ReceiptFinalParentSyncIndex)
AppendReceiptSettled == Advance("AppendReceiptSettled", AppendReceiptSettledIndex)
SyncReceiptSettled == Advance("SyncReceiptSettled", SyncReceiptSettledIndex)
ReceiptPostSettlementOwnedRead == Advance("ReceiptPostSettlementOwnedRead", ReceiptPostSettlementOwnedReadIndex)
ReturnSuccess == IF Broken = "receipt" /\ SelectorKind = "policy" THEN
 /\ pc = AppendReceiptIntentIndex /\ ~crashed /\ gate /\ success' = TRUE /\ pc' = ReturnSuccessIndex + 1
 /\ UNCHANGED <<gate, scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent, barriers,
     moveObserved, nativeSettlement, receipt, retainedAttempts, attempt, crashCount,
     crashed, savedPc, expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
     ELSE Advance("ReturnSuccess", ReturnSuccessIndex)
Crash == /\ ~crashed /\ ~success /\ ~refused /\ pc > 1 /\ pc <= ReturnSuccessIndex /\ crashCount < 2
 /\ crashed' = TRUE /\ gate' = FALSE /\ savedPc' = pc /\ crashCount' = crashCount + 1
 /\ UNCHANGED <<pc, scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent,
     barriers, moveObserved, nativeSettlement, receipt, retainedAttempts, success, attempt,
     expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
ReadonlyCompletedLookup == /\ crashed /\ readonlyResult = "none"
 /\ readonlyResult' = (IF physicalLocation.old \in {"swapped-temporary", "archive"}
     /\ (moveObserved = 0 \/ archiveObserved = 2) THEN physicalLocation.old ELSE "refused")
 /\ readonlyBasis' = [move |-> moveIntent, archive |-> archiveIntent, newHead |-> physicalLocation.new, oldLocation |-> physicalLocation.old, observed |-> moveObserved, archiveObserved |-> archiveObserved, exact |-> scope = "exact-request-intent-bridge" /\ expectedOld = "old-object-and-bytes" /\ "selector" \in claims]
 /\ UNCHANGED <<pc, gate, scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent,
     barriers, moveObserved, nativeSettlement, receipt, retainedAttempts, success, attempt,
     crashCount, crashed, savedPc, expectedOld, archiveObserved, generationSettled, refused>>
Restart == /\ crashed /\ savedPc # AppendFullPhysicalClaimIndex
 /\ crashed' = FALSE /\ gate' = TRUE /\ pc' = savedPc
 /\ UNCHANGED <<scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent,
     barriers, moveObserved, nativeSettlement, receipt, retainedAttempts, success, attempt,
     crashCount, savedPc, expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
RetainUnclaimedAttempt == /\ crashed /\ savedPc = AppendFullPhysicalClaimIndex
 /\ retainedAttempts' = retainedAttempts \cup {attempt}
 /\ crashed' = FALSE /\ gate' = TRUE /\ pc' = 100
 /\ UNCHANGED <<scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent,
     barriers, moveObserved, nativeSettlement, receipt, success, attempt, crashCount, savedPc,
     expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
SyncRetainedAttempt == /\ pc = 100 /\ ~crashed /\ gate
 /\ attempt' = (IF attempt = 3 THEN attempt ELSE attempt + 1)
 /\ refused' = (attempt = 3) /\ pc' = 0 /\ crashed' = (attempt < 3) /\ gate' = FALSE
 /\ savedPc' = ReserveAttemptAppendIndex /\ claims' = {} /\ generationSettled' = FALSE
 /\ UNCHANGED <<scope, physicalLocation, recordedLocation, moveIntent, archiveIntent,
     barriers, moveObserved, nativeSettlement, receipt, retainedAttempts, success, crashCount,
     expectedOld, readonlyResult, readonlyBasis, archiveObserved>>
Next == ReserveAttemptAppend \/ ReserveAttemptSync \/ GenerationCreate \/ GenerationClaimAppend \/ GenerationClaimSync \/ GenerationWrite \/ GenerationFileSync \/ GenerationReadback \/ GenerationParentSync \/ GenerationPromotionIntentAppend \/ GenerationPromotionIntentSync \/ GenerationPromotionSyscall \/ GenerationSourceParentSync \/ GenerationDestinationParentSync \/ GenerationDestinationReadback \/ GenerationPromotionObservedAppend \/ GenerationPromotionObservedSync \/ GenerationFinalOwnedRead \/ GenerationFinalFileSync \/ GenerationFinalParentSync \/ GenerationSettleAppend \/ GenerationSettleSync \/ PolicySelectorIntentAppend \/ PolicySelectorIntentSync \/ CreateFile \/ AppendFullPhysicalClaim \/ SyncClaim \/ WriteBytes \/ SyncFile \/ ReadbackBytesAndMetadata \/ SyncTemporaryParent \/ AppendMoveIntent \/ SyncMoveIntent \/ AppendArchiveIntent \/ SyncArchiveIntent \/ GuardFrozenExpectedOld \/ SelectorSwapSyscall \/ GuardOldArchive \/ ArchiveSyscall \/ SyncNamespaceAfterSwapArchive \/ ReadbackOldAtExactTemporaryOrArchive \/ AppendArchiveObserved \/ SyncArchiveObserved \/ ReadbackNewHead \/ SyncNewFile \/ SyncNewParent \/ AppendMoveObserved \/ SyncMoveObserved \/ SelectorPostObservationOwnedRead \/ SettleRegistrationOrSelector \/ SyncNativeSettlement \/ AppendReceiptIntent \/ SyncReceiptIntent \/ ReceiptCreate \/ ReceiptClaimAppend \/ ReceiptClaimSync \/ ReceiptWrite \/ ReceiptFileSync \/ ReceiptReadbackTemporary \/ ReceiptParentSync \/ ReceiptPromotionIntentAppend \/ ReceiptPromotionIntentSync \/ ReceiptPromotionSyscall \/ ReceiptSourceParentSync \/ ReceiptDestinationParentSync \/ ReceiptDestinationReadback \/ ReceiptPromotionObservedAppend \/ ReceiptPromotionObservedSync \/ ReceiptFinalOwnedRead \/ ReceiptFinalFileSync \/ ReceiptFinalParentSync \/ AppendReceiptSettled \/ SyncReceiptSettled \/ ReceiptPostSettlementOwnedRead \/ ReturnSuccess \/ SyncRetainedAttempt \/ Crash \/ Restart \/ RetainUnclaimedAttempt \/ ReadonlyCompletedLookup
FrozenExpectedOld == physicalLocation.new = "fixed" => expectedOld = "old-object-and-bytes"
IntentBeforeSwap == physicalLocation.new = "fixed" => moveIntent = 2 /\ archiveIntent = 2 /\ "SyncTemporaryParent" \in barriers /\ "selector" \in claims
RecordedLocationReachable == nativeSettlement => recordedLocation = "temporary" /\ moveObserved = 2
ArchiveBeforeMoveObserved == moveObserved # 0 => archiveObserved = 2
SuccessRequiresSettledReceiptGraph == success =>
 /\ nativeSettlement /\ generationSettled /\ moveObserved = 2
 /\ GenerationBarrierSteps \subseteq barriers
 /\ {"ReadbackNewHead", "SyncNewFile", "SyncNewParent", "SelectorPostObservationOwnedRead"} \subseteq barriers
 /\ (SelectorKind # "policy" \/ ReceiptSteps \subseteq receipt)
RetainedAttemptsStay == retainedAttempts \subseteq 1..3 /\ attempt <= 3 /\ (1..(attempt-1)) \subseteq retainedAttempts
ReadonlyRequiresOwnedPendingPath == readonlyResult \in {"swapped-temporary", "archive"} =>
 /\ readonlyBasis.move = 2 /\ readonlyBasis.archive = 2 /\ readonlyBasis.newHead = "fixed"
 /\ readonlyBasis.oldLocation = readonlyResult /\ readonlyBasis.exact
 /\ (readonlyBasis.observed = 0 \/ readonlyBasis.archiveObserved = 2)
ReadonlyDoesNotMutate == [][ReadonlyCompletedLookup => UNCHANGED <<pc, gate, scope, claims,
     physicalLocation, recordedLocation, moveIntent, archiveIntent, barriers, moveObserved,
     nativeSettlement, receipt, retainedAttempts, success, attempt, crashCount, crashed,
     savedPc, expectedOld, archiveObserved, generationSettled, refused>>]_vars
Spec == Init /\ [][Next]_vars
=============================================================================
