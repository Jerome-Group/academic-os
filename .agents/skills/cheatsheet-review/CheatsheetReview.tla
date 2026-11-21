---- MODULE CheatsheetReview ----
EXTENDS Naturals

CONSTANTS SkipGrayscale, AcceptStaleReview

VARIABLES pdf, checked, phase, reviewed
vars == <<pdf, checked, phase, reviewed>>
Checks == {"sources", "color", "grayscale"}

Init == /\ pdf = 1
        /\ checked = {}
        /\ phase = "Draft"
        /\ reviewed = 0

Inspect(check) == /\ phase = "Draft"
                  /\ check \notin checked
                  /\ checked' = checked \cup {check}
                  /\ UNCHANGED <<pdf, phase, reviewed>>

CheckSources == Inspect("sources")
InspectColor == Inspect("color")
InspectGrayscale == Inspect("grayscale")

Revise == /\ pdf = 1
          /\ phase \in {"Draft", "Frozen"}
          /\ pdf' = 2
          /\ phase' = "Draft"
          /\ checked' = {}
          /\ UNCHANGED reviewed

Freeze == /\ phase = "Draft"
          /\ (IF SkipGrayscale THEN {"sources", "color"} ELSE Checks) \subseteq checked
          /\ phase' = "Frozen"
          /\ UNCHANGED <<pdf, checked, reviewed>>

Accept == /\ phase = "Frozen"
          /\ \E submitted \in 1..pdf:
               /\ AcceptStaleReview \/ submitted = pdf
               /\ reviewed' = submitted
          /\ phase' = "Passed"
          /\ UNCHANGED <<pdf, checked>>

Done == /\ phase = "Passed"
        /\ UNCHANGED vars

Next == CheckSources \/ InspectColor \/ InspectGrayscale \/ Revise \/ Freeze \/ Accept \/ Done

CurrentChecks == phase \in {"Frozen", "Passed"} => checked = Checks
ExactReviewedPdf == phase = "Passed" => reviewed = pdf
====
