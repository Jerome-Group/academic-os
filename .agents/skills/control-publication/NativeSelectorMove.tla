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
GenerationSettleAppendIndex == 16
GenerationSettleSyncIndex == 17
CreateFileIndex == 20
AppendFullPhysicalClaimIndex == 21
SyncClaimIndex == 22
WriteBytesIndex == 23
SyncFileIndex == 24
ReadbackBytesAndMetadataIndex == 25
SyncTemporaryParentIndex == 26
AppendMoveIntentIndex == 27
SyncMoveIntentIndex == 28
AppendArchiveIntentIndex == 29
SyncArchiveIntentIndex == 30
GuardFrozenExpectedOldIndex == 31
SelectorSwapSyscallIndex == 32
GuardOldArchiveIndex == 33
ArchiveSyscallIndex == 34
SyncNamespaceAfterSwapArchiveIndex == 35
ReadbackOldAtExactTemporaryOrArchiveIndex == 36
AppendArchiveObservedIndex == 37
SyncArchiveObservedIndex == 38
ReadbackNewHeadIndex == 39
SyncNewFileIndex == 40
SyncNewParentIndex == 41
AppendMoveObservedIndex == 42
SyncMoveObservedIndex == 43
SettleRegistrationOrSelectorIndex == 44
SyncNativeSettlementIndex == 45
AppendReceiptIntentIndex == 46
SyncReceiptIntentIndex == 47
ReceiptCreateIndex == 48
ReceiptClaimAppendIndex == 49
ReceiptClaimSyncIndex == 50
ReceiptWriteIndex == 51
ReceiptFileSyncIndex == 52
ReceiptReadbackTemporaryIndex == 53
ReceiptParentSyncIndex == 54
ReceiptPromotionIntentAppendIndex == 55
ReceiptPromotionIntentSyncIndex == 56
ReceiptPromotionSyscallIndex == 57
ReceiptDestinationParentSyncIndex == 58
ReceiptPromotionObservedAppendIndex == 59
ReceiptPromotionObservedSyncIndex == 60
ReadbackReceiptIndex == 61
AppendReceiptSettledIndex == 62
SyncReceiptSettledIndex == 63
ReturnSuccessIndex == 64
GenerationPromotionIntentAppendIndex == 10
GenerationPromotionIntentSyncIndex == 11
GenerationPromotionSyscallIndex == 12
GenerationDestinationParentSyncIndex == 13
GenerationPromotionObservedAppendIndex == 14
GenerationPromotionObservedSyncIndex == 15
TemporaryReserveAppendIndex == 18
TemporaryReserveSyncIndex == 19
Advance(label, i) == /\ ~crashed /\ ~refused /\ gate /\ pc = i
 /\ (label # "AppendMoveObserved" \/ archiveObserved = 2)
 /\ pc' = (IF label = "GuardFrozenExpectedOld" /\ expectedOld # "old-object-and-bytes"
             THEN 0 ELSE IF label = "SettleRegistrationOrSelector" /\ recordedLocation = "false-name" /\ Broken # "location"
             THEN 0 ELSE IF label = "SyncNativeSettlement" /\ SelectorKind = "registration" THEN ReturnSuccessIndex ELSE i + 1)
 /\ refused' = (refused \/ (label = "GuardFrozenExpectedOld" /\ expectedOld # "old-object-and-bytes")
                    \/ (label = "SettleRegistrationOrSelector" /\ recordedLocation = "false-name" /\ Broken # "location"))
 /\ claims' = (IF label = "GenerationClaimAppend" THEN claims \cup {"generation"}
              ELSE IF label = "AppendFullPhysicalClaim" THEN claims \cup {"selector"} ELSE claims)
 /\ physicalLocation' = (IF label = "SelectorSwapSyscall" THEN [new |-> "fixed", old |-> "swapped-temporary"]
                       ELSE IF label = "ArchiveSyscall" THEN [physicalLocation EXCEPT !.old = "archive"] ELSE physicalLocation)
 /\ moveIntent' = (IF label = "AppendMoveIntent" THEN 1 ELSE IF label = "SyncMoveIntent" THEN 2 ELSE moveIntent)
 /\ archiveIntent' = (IF label = "AppendArchiveIntent" THEN 1 ELSE IF label = "SyncArchiveIntent" THEN 2 ELSE archiveIntent)
 /\ barriers' = (IF label \in {"SyncClaim", "WriteBytes", "SyncFile", "ReadbackBytesAndMetadata", "SyncTemporaryParent", "SyncNamespaceAfterSwapArchive", "ReadbackOldAtExactTemporaryOrArchive", "ReadbackNewHead", "SyncNewFile", "SyncNewParent"}
                THEN barriers \cup {label} ELSE barriers)
 /\ archiveObserved' = (IF label = "AppendArchiveObserved" THEN 1 ELSE IF label = "SyncArchiveObserved" THEN 2 ELSE archiveObserved)
 /\ moveObserved' = (IF label = "AppendMoveObserved" THEN 1 ELSE IF label = "SyncMoveObserved" THEN 2 ELSE moveObserved)
 /\ nativeSettlement' = (nativeSettlement \/ (label = "SettleRegistrationOrSelector" /\ (recordedLocation # "false-name" \/ Broken = "location")))
 /\ receipt' = (IF label \in {"AppendReceiptIntent", "SyncReceiptIntent", "ReceiptCreate", "ReceiptClaimAppend", "ReceiptClaimSync", "ReceiptWrite", "ReceiptFileSync", "ReceiptReadbackTemporary", "ReceiptParentSync", "ReceiptPromotionIntentAppend", "ReceiptPromotionIntentSync", "ReceiptPromotionSyscall", "ReceiptDestinationParentSync", "ReceiptPromotionObservedAppend", "ReceiptPromotionObservedSync", "ReadbackReceipt", "AppendReceiptSettled", "SyncReceiptSettled"} THEN receipt \cup {label} ELSE receipt)
 /\ generationSettled' = (generationSettled \/ label = "GenerationSettleSync")
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
GenerationSettleAppend == Advance("GenerationSettleAppend", GenerationSettleAppendIndex)
GenerationSettleSync == Advance("GenerationSettleSync", GenerationSettleSyncIndex)
CreateFile == Advance("CreateFile", CreateFileIndex)
AppendFullPhysicalClaim == Advance("AppendFullPhysicalClaim", AppendFullPhysicalClaimIndex)
SyncClaim == Advance("SyncClaim", SyncClaimIndex)
WriteBytes == Advance("WriteBytes", WriteBytesIndex)
SyncFile == Advance("SyncFile", SyncFileIndex)
ReadbackBytesAndMetadata == Advance("ReadbackBytesAndMetadata", ReadbackBytesAndMetadataIndex)
SyncTemporaryParent == Advance("SyncTemporaryParent", SyncTemporaryParentIndex)
AppendMoveIntent == Advance("AppendMoveIntent", AppendMoveIntentIndex)
SyncMoveIntent == Advance("SyncMoveIntent", SyncMoveIntentIndex)
AppendArchiveIntent == Advance("AppendArchiveIntent", AppendArchiveIntentIndex)
SyncArchiveIntent == Advance("SyncArchiveIntent", SyncArchiveIntentIndex)
GuardFrozenExpectedOld == Advance("GuardFrozenExpectedOld", GuardFrozenExpectedOldIndex)
SelectorSwapSyscall == IF Broken = "intent" THEN
 /\ pc = AppendMoveIntentIndex /\ ~crashed /\ gate /\ physicalLocation' = [new |-> "fixed", old |-> "swapped-temporary"]
 /\ pc' = AppendMoveIntentIndex + 1
 /\ UNCHANGED <<gate, scope, claims, recordedLocation, moveIntent, archiveIntent, barriers,
     moveObserved, nativeSettlement, receipt, retainedAttempts, success, attempt, crashCount,
     crashed, savedPc, expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
     ELSE Advance("SelectorSwapSyscall", SelectorSwapSyscallIndex)
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
ReceiptDestinationParentSync == Advance("ReceiptDestinationParentSync", ReceiptDestinationParentSyncIndex)
ReceiptPromotionObservedAppend == Advance("ReceiptPromotionObservedAppend", ReceiptPromotionObservedAppendIndex)
ReceiptPromotionObservedSync == Advance("ReceiptPromotionObservedSync", ReceiptPromotionObservedSyncIndex)
ReadbackReceipt == Advance("ReadbackReceipt", ReadbackReceiptIndex)
AppendReceiptSettled == Advance("AppendReceiptSettled", AppendReceiptSettledIndex)
SyncReceiptSettled == Advance("SyncReceiptSettled", SyncReceiptSettledIndex)
ReturnSuccess == IF Broken = "receipt" /\ SelectorKind = "policy" THEN
 /\ pc = AppendReceiptIntentIndex /\ ~crashed /\ gate /\ success' = TRUE /\ pc' = ReturnSuccessIndex + 1
 /\ UNCHANGED <<gate, scope, claims, physicalLocation, recordedLocation, moveIntent, archiveIntent, barriers,
     moveObserved, nativeSettlement, receipt, retainedAttempts, attempt, crashCount,
     crashed, savedPc, expectedOld, readonlyResult, readonlyBasis, archiveObserved, generationSettled, refused>>
     ELSE Advance("ReturnSuccess", ReturnSuccessIndex)
GenerationPromotionIntentAppend == Advance("GenerationPromotionIntentAppend", GenerationPromotionIntentAppendIndex)
GenerationPromotionIntentSync == Advance("GenerationPromotionIntentSync", GenerationPromotionIntentSyncIndex)
GenerationPromotionSyscall == Advance("GenerationPromotionSyscall", GenerationPromotionSyscallIndex)
GenerationDestinationParentSync == Advance("GenerationDestinationParentSync", GenerationDestinationParentSyncIndex)
GenerationPromotionObservedAppend == Advance("GenerationPromotionObservedAppend", GenerationPromotionObservedAppendIndex)
GenerationPromotionObservedSync == Advance("GenerationPromotionObservedSync", GenerationPromotionObservedSyncIndex)
TemporaryReserveAppend == Advance("TemporaryReserveAppend", TemporaryReserveAppendIndex)
TemporaryReserveSync == Advance("TemporaryReserveSync", TemporaryReserveSyncIndex)
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
Next == GenerationPromotionIntentAppend \/ GenerationPromotionIntentSync \/ GenerationPromotionSyscall \/ GenerationDestinationParentSync \/ GenerationPromotionObservedAppend \/ GenerationPromotionObservedSync \/ TemporaryReserveAppend \/ TemporaryReserveSync \/ SyncRetainedAttempt \/ ReserveAttemptAppend \/ ReserveAttemptSync \/ GenerationCreate \/ GenerationClaimAppend \/ GenerationClaimSync \/ GenerationWrite \/ GenerationFileSync \/ GenerationReadback \/ GenerationParentSync \/ GenerationSettleAppend \/ GenerationSettleSync \/ CreateFile \/ AppendFullPhysicalClaim \/ SyncClaim \/ WriteBytes \/ SyncFile \/ ReadbackBytesAndMetadata \/ SyncTemporaryParent \/ AppendMoveIntent \/ SyncMoveIntent \/ AppendArchiveIntent \/ SyncArchiveIntent \/ GuardFrozenExpectedOld \/ SelectorSwapSyscall \/ GuardOldArchive \/ ArchiveSyscall \/ SyncNamespaceAfterSwapArchive \/ ReadbackOldAtExactTemporaryOrArchive \/ AppendArchiveObserved \/ SyncArchiveObserved \/ ReadbackNewHead \/ SyncNewFile \/ SyncNewParent \/ AppendMoveObserved \/ SyncMoveObserved \/ SettleRegistrationOrSelector \/ SyncNativeSettlement \/ AppendReceiptIntent \/ SyncReceiptIntent \/ ReceiptCreate \/ ReceiptClaimAppend \/ ReceiptClaimSync \/ ReceiptWrite \/ ReceiptFileSync \/ ReceiptReadbackTemporary \/ ReceiptParentSync \/ ReceiptPromotionIntentAppend \/ ReceiptPromotionIntentSync \/ ReceiptPromotionSyscall \/ ReceiptDestinationParentSync \/ ReceiptPromotionObservedAppend \/ ReceiptPromotionObservedSync \/ ReadbackReceipt \/ AppendReceiptSettled \/ SyncReceiptSettled \/ ReturnSuccess \/ Crash \/ Restart \/ RetainUnclaimedAttempt \/ ReadonlyCompletedLookup
FrozenExpectedOld == physicalLocation.new = "fixed" => expectedOld = "old-object-and-bytes"
IntentBeforeSwap == physicalLocation.new = "fixed" => moveIntent = 2 /\ archiveIntent = 2 /\ "SyncTemporaryParent" \in barriers /\ "selector" \in claims
RecordedLocationReachable == nativeSettlement => recordedLocation = "temporary" /\ moveObserved = 2
ArchiveBeforeMoveObserved == moveObserved # 0 => archiveObserved = 2
SuccessRequiresSettledReceiptGraph == success => nativeSettlement /\ generationSettled /\ moveObserved = 2
 /\ "ReadbackNewHead" \in barriers /\ "SyncNewFile" \in barriers /\ "SyncNewParent" \in barriers
 /\ (SelectorKind # "policy" \/ {"AppendReceiptIntent", "SyncReceiptIntent", "ReceiptClaimSync", "ReceiptWrite", "ReceiptFileSync", "ReceiptPromotionIntentSync", "ReceiptPromotionSyscall", "ReceiptDestinationParentSync", "ReceiptPromotionObservedSync", "ReadbackReceipt", "SyncReceiptSettled"} \subseteq receipt)
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
