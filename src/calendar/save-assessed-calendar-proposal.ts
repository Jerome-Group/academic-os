import { assessCalendarProposal } from "./calendar-occupancy.js";
import type {
  CalendarProposalCandidate,
  CalendarProposalReader,
  CalendarProposalStore,
  CalendarProposeReport,
  OwnedCalendarMirror,
  OwnedCalendarWorkspace,
} from "./types.js";

export async function saveAssessedCalendarProposal(input: {
  proposal: CalendarProposalCandidate;
  workspace: OwnedCalendarWorkspace;
  reader: CalendarProposalReader;
  mirrors: OwnedCalendarMirror[];
  proposalStore: CalendarProposalStore;
}): Promise<CalendarProposeReport> {
  const assessment = await assessCalendarProposal(input);
  if (assessment.outcome !== "ready") {
    const proposal = { ...input.proposal };
    delete proposal.status;
    return {
      schemaVersion: 1,
      command: "calendar propose",
      outcome: "blocked",
      proposal,
      conflicts: assessment.conflicts,
      warnings: assessment.warnings,
      workspace: "not-written",
    };
  }
  const intervals = assessment.review.coverage.occurrences.map(
    ({ interval }) => interval,
  );
  const interval =
    intervals.length === 0 || assessment.review.coverage.reason === "milestone"
      ? null
      : {
          start: new Date(
            Math.min(...intervals.map(({ start }) => Date.parse(start))),
          ).toISOString(),
          end: new Date(
            Math.max(...intervals.map(({ end }) => Date.parse(end))),
          ).toISOString(),
        };
  const proposal = {
    ...input.proposal,
    status: "ready" as const,
    review: assessment.review,
  };
  proposal.relevantAvailabilityVersion.digest = assessment.review.binding;
  if (
    proposal.operation !== "cancel" &&
    proposal.operation !== "routine-migration"
  )
    proposal.relevantAvailabilityVersion.checkedCalendarCount =
      assessment.checkedCalendarCount;
  if (proposal.operation === "bulk-create")
    proposal.relevantAvailabilityVersion.intervals = intervals;
  else if (
    proposal.operation !== "cancel" &&
    proposal.operation !== "routine-migration"
  )
    proposal.relevantAvailabilityVersion.interval = interval;
  if (
    proposal.operation !== "cancel" &&
    proposal.operation !== "routine-migration"
  )
    proposal.conflictSummary = {
      blockers: assessment.conflicts.length,
      warnings: assessment.warnings.length,
    };
  await input.proposalStore.writeCurrent(proposal);
  return {
    schemaVersion: 1,
    command: "calendar propose",
    outcome: "ready",
    proposal,
    conflicts: assessment.conflicts,
    warnings: assessment.warnings,
    workspace: "written",
  };
}
