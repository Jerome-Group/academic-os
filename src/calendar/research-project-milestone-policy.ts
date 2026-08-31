import { OperationalError } from "../operational-error.js";
import type {
  CalendarProposalItemKind,
  CalendarProposalSource,
  OwnedCalendarRole,
} from "./types.js";

const RESEARCH_PROJECT_SOURCE_KIND = "research-project";
const PROVISIONAL_LABEL = /\bProvisional\b/u;
const CONFIRMED_LABEL = /\bConfirmed\b/u;
const PROVISIONAL_HINT = /\bprovisional\b/iu;
const PROVISIONAL_SOURCE_REFERENCE =
  /(?:standing|month)[_-]?window|old[_-]?year|estimate|provisional/iu;
const STANDING_SOURCE_CITATION =
  /\b(?:Standing source|Standing evidence|Evidence)\s*:\s*\S/iu;
const STANDING_ONLY_CITATION = /\b(?:Standing source|Standing evidence)\s*:/iu;
const CONFIRMED_SOURCE_CITATION = /\bConfirmed source\s*:\s*\S/iu;
const CONFIRMED_SOURCE_REFERENCE =
  /(?:^|\/)(?:authenticated|confirmed)(?:\/|$)/iu;
const VERIFICATION_TASK_POINTER = /\bVerification Task\s*:\s*\S/iu;
const DEADLINE_CLAIM = /\bdeadlines?\b/iu;

export type ResearchProjectEvidenceStatus = "confirmed" | "provisional";

export function parseOptionalResearchProjectEvidenceStatus(
  source: CalendarProposalSource,
  value: unknown,
): ResearchProjectEvidenceStatus | undefined {
  if (source.kind !== RESEARCH_PROJECT_SOURCE_KIND) {
    if (value !== undefined) {
      invalidInput(
        "item.evidenceStatus is supported only for a research-project milestone",
      );
    }
    return undefined;
  }
  if (value === undefined) return undefined;
  if (value !== "confirmed" && value !== "provisional") {
    invalidInput("item.evidenceStatus must be confirmed or provisional");
  }
  return value;
}

export function detectVisibleResearchProjectEvidenceStatus(input: {
  summary?: unknown;
  description?: unknown;
}): ResearchProjectEvidenceStatus | undefined {
  if (
    typeof input.summary === "string" &&
    typeof input.description === "string" &&
    PROVISIONAL_LABEL.test(input.summary) &&
    PROVISIONAL_LABEL.test(input.description) &&
    STANDING_SOURCE_CITATION.test(input.description) &&
    VERIFICATION_TASK_POINTER.test(input.description)
  ) {
    return "provisional";
  }
  if (
    typeof input.summary === "string" &&
    typeof input.description === "string" &&
    CONFIRMED_LABEL.test(input.summary) &&
    CONFIRMED_SOURCE_CITATION.test(input.description)
  ) {
    return "confirmed";
  }
  return undefined;
}

export function validateResearchProjectMilestonePolicy(input: {
  source: CalendarProposalSource;
  evidenceStatus: unknown;
  summary: unknown;
  description: unknown;
  calendarRole: OwnedCalendarRole;
  itemKind: CalendarProposalItemKind;
  visibility: unknown;
  recurring?: boolean | undefined;
  visibleEvidenceStatus?: ResearchProjectEvidenceStatus | undefined;
}): void {
  if (
    input.source.kind !== RESEARCH_PROJECT_SOURCE_KIND &&
    input.visibleEvidenceStatus !== undefined
  ) {
    invalidInput(
      "a visible research milestone requires source.kind research-project",
    );
  }
  if (input.source.kind !== RESEARCH_PROJECT_SOURCE_KIND) {
    if (input.evidenceStatus !== undefined) {
      invalidInput(
        "item.evidenceStatus is supported only for a research-project milestone",
      );
    }
    return;
  }
  if (
    input.calendarRole !== "Academic" ||
    input.visibility !== "private" ||
    (input.itemKind !== "timed-milestone" &&
      input.itemKind !== "all-day-milestone")
  ) {
    invalidInput(
      "a research-project marker must remain an Academic private transparent milestone",
    );
  }
  if (input.recurring === true) {
    invalidInput(
      "research-project milestones must be singular and non-recurring",
    );
  }
  const summary = requireNonEmptyString(input.summary, "item.summary");
  if (
    input.evidenceStatus !== "confirmed" &&
    input.evidenceStatus !== "provisional"
  ) {
    invalidInput(
      "a research-project milestone requires item.evidenceStatus confirmed or provisional",
    );
  }
  const description = optionalString(input.description, "item.description");
  const isProvisional =
    input.evidenceStatus === "provisional" ||
    PROVISIONAL_HINT.test(summary) ||
    (description !== undefined && PROVISIONAL_HINT.test(description)) ||
    (description !== undefined && STANDING_ONLY_CITATION.test(description)) ||
    PROVISIONAL_SOURCE_REFERENCE.test(input.source.reference);
  if (!isProvisional) {
    validateConfirmedMilestone({
      sourceReference: input.source.reference,
      summary,
      description,
    });
    return;
  }
  validateProvisionalMilestone({
    evidenceStatus: input.evidenceStatus,
    summary,
    description,
  });
}

function validateConfirmedMilestone(input: {
  sourceReference: string;
  summary: string;
  description: string | undefined;
}): void {
  if (!CONFIRMED_SOURCE_REFERENCE.test(input.sourceReference)) {
    invalidInput(
      "a confirmed research milestone source.reference must identify authenticated or confirmed evidence",
    );
  }
  if (
    input.description === undefined ||
    !CONFIRMED_SOURCE_CITATION.test(input.description)
  ) {
    invalidInput(
      'a confirmed research milestone description must cite "Confirmed source:"',
    );
  }
  if (!CONFIRMED_LABEL.test(input.summary)) {
    invalidInput('a confirmed research milestone summary must say "Confirmed"');
  }
}

function validateProvisionalMilestone(input: {
  evidenceStatus: ResearchProjectEvidenceStatus;
  summary: string;
  description: string | undefined;
}): void {
  if (input.evidenceStatus === "confirmed") {
    invalidInput(
      "a standing, estimated, old-year, or provisional research milestone cannot be marked confirmed",
    );
  }
  if (!PROVISIONAL_LABEL.test(input.summary)) {
    invalidInput(
      'a provisional research milestone summary must say "Provisional"',
    );
  }
  if (
    input.description === undefined ||
    !PROVISIONAL_LABEL.test(input.description)
  ) {
    invalidInput(
      'a provisional research milestone description must say "Provisional"',
    );
  }
  if (!STANDING_SOURCE_CITATION.test(input.description)) {
    invalidInput(
      'a provisional research milestone description must cite "Standing source:", "Standing evidence:" or "Evidence:"',
    );
  }
  if (CONFIRMED_SOURCE_CITATION.test(input.description)) {
    invalidInput(
      "a provisional research milestone cannot cite itself as confirmed",
    );
  }
  if (!VERIFICATION_TASK_POINTER.test(input.description)) {
    invalidInput(
      'a provisional research milestone description must point to "Verification Task:"',
    );
  }
  if (
    DEADLINE_CLAIM.test(input.summary) ||
    DEADLINE_CLAIM.test(input.description)
  ) {
    invalidInput(
      "a provisional research milestone must be a planning marker and must not be called a deadline",
    );
  }
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireNonEmptyString(value, name);
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidInput(`${name} must be a non-empty string`);
  }
  return value;
}

function invalidInput(message: string): never {
  throw new OperationalError(
    "invalid-target",
    `Invalid Calendar Proposal input: ${message}.`,
  );
}
