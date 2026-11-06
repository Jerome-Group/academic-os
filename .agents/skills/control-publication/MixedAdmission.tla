---------------------------- MODULE MixedAdmission ----------------------------
EXTENDS Naturals, FiniteSets, Sequences, TLC
CONSTANT Broken
Writers == {1, 2}
Families == {"candidate-reserved", "publication-plan", "native-host-deployment-intent", "native-source-policy-install-intent"}
Tokens == {"completed", "collision", "bridge", "fresh1", "fresh2"}
VARIABLES pc, gate, owner, historyState, runtimeVerified, completed, pending,
          result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects,
          validated, drained
vars == <<pc, gate, owner, historyState, runtimeVerified, completed, pending,
          result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects,
          validated, drained>>
Token(w) == IF w = 2 THEN "fresh2" ELSE CASE scenario = "completed" -> "completed"
  [] scenario = "collision" -> "collision" [] scenario = "bridge" -> "bridge" [] OTHER -> "fresh1"
Exact(w) == Token(w) = "completed"
Conflict(w) == owner[Token(w)] # {} /\ ~Exact(w)
VisibleConflict(w) == Conflict(w) /\ ~(Broken = "namespace" /\ Token(w) = "collision")
Init == /\ pc = [w \in Writers |-> "frozen"] /\ gate = 0
 /\ owner = [t \in Tokens |-> IF t = "completed" THEN {"completed-binding"}
       ELSE IF t = "collision" THEN {"native-host-deployment-intent"}
       ELSE IF t = "bridge" THEN {"internal-bridge"} ELSE {}]
 /\ historyState \in {"valid", "invalid-chain", "invalid-location", "unsupported-acquisition"}
 /\ runtimeVerified = {} /\ completed = {"completed"}
 /\ pending \in {"none", "unrelated"} /\ result = [w \in Writers |-> "none"]
 /\ starterRows = {} /\ resourceClass \in {"complete", "starter-only", "exhausted"}
 /\ family \in Families /\ scenario \in {"completed", "collision", "bridge", "fresh"}
 /\ callerExpectedOld \in {"matches", "stale"} /\ (family = "candidate-reserved" => callerExpectedOld = "matches") /\ runtimeOK \in BOOLEAN /\ effects = {} /\ validated = {} /\ drained = {}
Step(w, before, after) == /\ pc[w] = before /\ pc' = [pc EXCEPT ![w] = after]
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
RuntimeArtifactValidation(w) == /\ pc[w] = "frozen"
 /\ pc' = [pc EXCEPT ![w] = IF runtimeOK THEN "runtime" ELSE "done"]
 /\ runtimeVerified' = (IF runtimeOK THEN runtimeVerified \cup {w} ELSE runtimeVerified)
 /\ UNCHANGED <<gate, owner, historyState, completed, pending, result, starterRows,
 resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
ResolveAccount(w) == Step(w, "runtime", "account")
AcquirePermanentGate(w) == /\ pc[w] = "account" /\ gate = 0
 /\ gate' = w /\ pc' = [pc EXCEPT ![w] = "gate"]
 /\ UNCHANGED <<owner, historyState, runtimeVerified, completed, pending, result,
 starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
LoadCompleteHistory(w) == Step(w, "gate", "loaded")
ValidateMixedHistory(w) == /\ pc[w] = "loaded"
 /\ pc' = [pc EXCEPT ![w] = IF historyState = "valid" \/ Broken = "history" THEN "history" ELSE "drain"]
 /\ validated' = (IF historyState = "valid" THEN validated \cup {w} ELSE validated)
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, drained>>
ValidateRequestAndBridgeOwner(w) == /\ pc[w] = "history"
 /\ pc' = [pc EXCEPT ![w] = IF VisibleConflict(w) THEN "drain" ELSE "namespace"]
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
LookupAndPhysicallyVerifyCompleted(w) == /\ pc[w] = "namespace"
 /\ pc' = [pc EXCEPT ![w] = IF Broken = "pending" /\ pending # "none" THEN "drain"
      ELSE IF Exact(w) THEN "completed-verified" ELSE "pending"]
 /\ result' = (IF Broken = "pending" /\ pending # "none" THEN [result EXCEPT ![w] = "pending-refusal"] ELSE result)
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
ReturnCompletedReadonly(w) == /\ pc[w] = "completed-verified"
 /\ pc' = [pc EXCEPT ![w] = "drain"] /\ result' = [result EXCEPT ![w] = "completed-original"]
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
RefuseUnrelatedPending(w) == Step(w, "pending", IF pending = "none" THEN "feasibility" ELSE "drain")
ValidateDeterminableFeasibility(w) == Step(w, "feasibility", IF callerExpectedOld = "stale" /\ Broken # "expected" THEN "drain" ELSE "reserve")
ReserveCompleteSuffix(w) == Step(w, "reserve", IF resourceClass = "complete" \/ (Broken = "suffix" /\ resourceClass = "starter-only") THEN "reserved" ELSE "drain")
AppendStarter(w) == /\ pc[w] = "reserved"
 /\ pc' = [pc EXCEPT ![w] = "starter"] /\ starterRows' = starterRows \cup {w}
 /\ owner' = [owner EXCEPT ![Token(w)] = @ \cup {family}]
 /\ UNCHANGED <<gate, historyState, runtimeVerified, completed, pending, result,
 resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
SyncStarter(w) == Step(w, "starter", "synced")
AdmitEffect(w) == /\ pc[w] = "synced" /\ gate = w
 /\ pc' = [pc EXCEPT ![w] = "drain"] /\ effects' = effects \cup {w}
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, validated, drained>>
ExpireAndDrain(w) == /\ pc[w] = "drain" /\ drained' = drained \cup {w}
 /\ pc' = [pc EXCEPT ![w] = "release"]
 /\ UNCHANGED <<gate, owner, historyState, runtimeVerified, completed, pending,
 result, starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated>>
ReleaseGate(w) == /\ pc[w] = "release" /\ gate = w
 /\ gate' = 0 /\ pc' = [pc EXCEPT ![w] = "done"]
 /\ UNCHANGED <<owner, historyState, runtimeVerified, completed, pending, result,
 starterRows, resourceClass, family, scenario, runtimeOK, callerExpectedOld, effects, validated, drained>>
Next == \E w \in Writers: RuntimeArtifactValidation(w) \/ ResolveAccount(w) \/ AcquirePermanentGate(w)
 \/ LoadCompleteHistory(w) \/ ValidateMixedHistory(w) \/ ValidateRequestAndBridgeOwner(w)
 \/ LookupAndPhysicallyVerifyCompleted(w) \/ ReturnCompletedReadonly(w)
 \/ RefuseUnrelatedPending(w) \/ ValidateDeterminableFeasibility(w) \/ ReserveCompleteSuffix(w)
 \/ AppendStarter(w) \/ SyncStarter(w) \/ AdmitEffect(w) \/ ExpireAndDrain(w) \/ ReleaseGate(w)
OnePermanentOwner == Cardinality({w \in Writers: pc[w] \in {"gate", "loaded", "history", "namespace", "completed-verified", "pending", "feasibility", "reserve", "reserved", "starter", "synced", "drain", "release"}}) <= 1
RequestOwnerUnique == \A t \in Tokens: Cardinality(owner[t]) <= 1
ValidateCompleteHistoryBeforeEffects == effects \subseteq validated /\ (\A w \in Writers: result[w] = "completed-original" => w \in validated)
CompletedLookupPrecedesPending == \A w \in Writers: Exact(w) /\ historyState = "valid" => result[w] # "pending-refusal"
FreshInfeasibleHasNoStarter == resourceClass # "complete" => starterRows = {}
RuntimeVerifiedBeforeAccount == \A w \in Writers: pc[w] \notin {"frozen", "done"} => w \in runtimeVerified
CompletedReadonly == \A w \in Writers: result[w] = "completed-original" => w \notin starterRows
FrozenCallerExpectationBeforeStarter == callerExpectedOld = "stale" => starterRows = {}
UnrelatedPendingHasNoFreshStarter == pending = "unrelated" => starterRows = {}
Spec == Init /\ [][Next]_vars
=============================================================================
