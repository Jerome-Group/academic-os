import type { WeeklyBasis } from "./weekly-publication-journal.js";
import {
  digest,
  hash,
  hashes,
  issueNumbers,
  record,
  repositoryHeads,
  scopeHeads,
  type PublishedObservation,
  type WeeklyObservation,
  type WeeklyView,
} from "./weekly-review-state.js";

export interface WeeklyResolutionProof {
  basisTicket: string;
  observationIds: string[];
  unknown: number[];
  viewDigest: string;
}

export function parseResolutionProof(value: unknown): WeeklyResolutionProof {
  const proof = record(value);
  return {
    basisTicket: hash(proof.basisTicket),
    observationIds: hashes(proof.observationIds),
    unknown: issueNumbers(proof.unknown),
    viewDigest: hash(proof.viewDigest),
  };
}

export function planWeeklyResolution(input: {
  basis: WeeklyBasis;
  observation: WeeklyObservation;
  before: PublishedObservation[];
  records: PublishedObservation[];
  view: WeeklyView;
}): WeeklyResolutionProof | undefined {
  const { basis, observation, before, records, view } = input;
  if (
    basis.coverage !== "monitoring-cohort" ||
    observation.repository === undefined ||
    view.actionable ||
    JSON.stringify(basis.parents) !==
      JSON.stringify(scopeHeads(before, basis.scope)) ||
    JSON.stringify(basis.repositoryParents) !==
      JSON.stringify(repositoryHeads(before))
  )
    return undefined;
  return {
    basisTicket: basis.ticket,
    observationIds: records.map((record) => record.id),
    unknown: view.unknown,
    viewDigest: digest(view),
  };
}

export function renderResolution(proof: WeeklyResolutionProof): string {
  return `\n\n<!-- academic-os-weekly-resolution:v1 ${encodeURIComponent(JSON.stringify(proof))} -->\nResolution applies only to the machine evidence observed in this review. The complete monitoring cohort and explicit repository evidence report no actionable work. Owner notes remain untouched and are not resolved implicitly. Enumeration is an as-of observation without provider snapshot isolation. Later actionable evidence reopens this anchor.`;
}
