import { isCalendarDay } from "./offering-calendar-day.js";
import { offeringWeekStart } from "./offering-week-start.js";
import type {
  MorningIssue,
  WeeklyRepositorySummary,
  WeeklyScopeSummary,
} from "./types.js";

const BEGIN = "<!-- academic-os-weekly-managed:begin -->";
const END = "<!-- academic-os-weekly-managed:end -->";
const STATE = "<!-- academic-os-weekly-state:v1 ";
interface MaintenanceReceipt {
  verifiedMaintenance: number;
  verifiedControlWrites: number;
}
interface ScopeState {
  receipts: Record<string, MaintenanceReceipt>;
  date: string;
  needsOwner: boolean;
  summary: WeeklyScopeSummary;
}
export interface QueueState {
  scopes: Record<string, ScopeState>;
  unknown: number[];
  repository: WeeklyRepositorySummary;
}
export const counts = [
  "targets",
  "preludePending",
  "parked",
  "failures",
  "verifiedMaintenance",
  "checkedMaintenance",
  "verifiedControlWrites",
  "awaitingMaintenance",
] as const;
const statuses = ["verified", "awaiting", "failed"];

export function ownerText(issue: MorningIssue): string {
  const start = issue.body.indexOf(BEGIN),
    end = issue.body.indexOf(END);
  if (
    start < 0 ||
    end < start ||
    issue.body.indexOf(BEGIN, start + BEGIN.length) >= 0 ||
    issue.body.indexOf(END, end + END.length) >= 0
  )
    throw new Error("Weekly managed section requires reconciliation.");
  return (
    issue.body
      .slice(0, start)
      .replace(/^<!-- academic-os-weekly-issue:[^\n]+ -->\n*/u, "") +
    issue.body
      .slice(end + END.length)
      .replace(
        /\n\n<!-- academic-os-weekly-transfer:v1 successor=(\d+) -->\nTransferred to weekly review #\1; closure records transfer, not resolution\./gu,
        "",
      )
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function issueNumbers(value: unknown): number[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    !value.every((n) => count(n) && n > 0)
  )
    throw new Error("Invalid weekly issue references.");
  return [...new Set(value)].sort((a, b) => a - b);
}
export function retainMergeEvidence(
  previous: WeeklyRepositorySummary["merged"][number] | undefined,
  next: WeeklyRepositorySummary["merged"][number],
): WeeklyRepositorySummary["merged"][number] {
  return {
    ...next,
    ...(next.originIssue === undefined && previous?.originIssue !== undefined
      ? { originIssue: previous.originIssue }
      : {}),
    verification:
      next.verification === "awaiting" && previous !== undefined
        ? previous.verification
        : next.verification,
    rollout:
      next.rollout === "awaiting" && previous !== undefined
        ? previous.rollout
        : next.rollout,
  };
}
function readReceipts(
  value: unknown,
  fallbackDate: string,
  summary: Record<string, unknown>,
): Record<string, MaintenanceReceipt> {
  const receipts: Record<string, MaintenanceReceipt> = {};
  const entries =
    value === undefined
      ? {
          [fallbackDate]: {
            verifiedMaintenance: summary.verifiedMaintenance,
            verifiedControlWrites: summary.verifiedControlWrites,
          },
        }
      : value;
  if (!record(entries) || Object.keys(entries).length > 366)
    throw new Error("Invalid maintenance receipts.");
  for (const [date, receipt] of Object.entries(entries)) {
    if (
      !isCalendarDay(date) ||
      !record(receipt) ||
      !count(receipt.verifiedMaintenance) ||
      !count(receipt.verifiedControlWrites)
    )
      throw new Error("Invalid maintenance receipt.");
    receipts[date] = {
      verifiedMaintenance: receipt.verifiedMaintenance,
      verifiedControlWrites: receipt.verifiedControlWrites,
    };
  }
  return receipts;
}
export function mergeReceipts(
  previous: Record<string, MaintenanceReceipt>,
  incoming: Record<string, MaintenanceReceipt>,
): Record<string, MaintenanceReceipt> {
  const receipts = { ...previous };
  for (const [date, receipt] of Object.entries(incoming))
    receipts[date] = {
      verifiedMaintenance: Math.max(
        receipts[date]?.verifiedMaintenance ?? 0,
        receipt.verifiedMaintenance,
      ),
      verifiedControlWrites: Math.max(
        receipts[date]?.verifiedControlWrites ?? 0,
        receipt.verifiedControlWrites,
      ),
    };
  return receipts;
}
export function repositorySummary(value: unknown): WeeklyRepositorySummary {
  if (
    !record(value) ||
    !Array.isArray(value.merged) ||
    !count(value.unresolved) ||
    !count(value.awaiting)
  )
    throw new Error("Invalid weekly repository counts.");
  return {
    pendingIssueNumbers: issueNumbers(value.pendingIssueNumbers),
    pendingPullRequestNumbers: issueNumbers(value.pendingPullRequestNumbers),
    unresolved: value.unresolved,
    awaiting: value.awaiting,
    merged: value.merged.map((fix) => {
      if (
        !record(fix) ||
        !count(fix.pullRequest) ||
        (fix.originIssue !== undefined &&
          (!count(fix.originIssue) || fix.originIssue === 0)) ||
        fix.pullRequest === 0 ||
        typeof fix.commit !== "string" ||
        !/^[a-f0-9]{40}$/u.test(fix.commit) ||
        typeof fix.verification !== "string" ||
        !statuses.includes(fix.verification) ||
        typeof fix.rollout !== "string" ||
        !statuses.includes(fix.rollout)
      )
        throw new Error("Invalid weekly merge evidence.");
      return {
        pullRequest: fix.pullRequest,
        ...(fix.originIssue === undefined
          ? {}
          : { originIssue: fix.originIssue as number }),
        commit: fix.commit,
        verification: fix.verification as "verified" | "awaiting" | "failed",
        rollout: fix.rollout as "verified" | "awaiting" | "failed",
      };
    }),
  };
}
export function stateOf(issue: MorningIssue): QueueState {
  const start = issue.body.indexOf(STATE),
    end = issue.body.indexOf(" -->", start);
  if (start < 0 || end < 0)
    throw new Error("Weekly state requires reconciliation.");
  const value: unknown = JSON.parse(
    decodeURIComponent(issue.body.slice(start + STATE.length, end)),
  );
  if (
    !record(value) ||
    !record(value.scopes) ||
    !Array.isArray(value.unknown) ||
    !value.unknown.every((n) => count(n) && n > 0)
  )
    throw new Error("Invalid weekly state.");
  const scopes: Record<string, ScopeState> = {};
  for (const [id, observation] of Object.entries(value.scopes)) {
    if (
      !/^[a-f0-9]{64}$/u.test(id) ||
      !record(observation) ||
      typeof observation.date !== "string" ||
      !isCalendarDay(observation.date) ||
      typeof observation.needsOwner !== "boolean" ||
      !record(observation.summary) ||
      !counts.every((key) =>
        count((observation.summary as Record<string, unknown>)[key]),
      )
    )
      throw new Error("Invalid weekly scope observation.");
    scopes[id] = {
      receipts: readReceipts(
        observation.receipts,
        observation.date,
        observation.summary,
      ),
      date: observation.date,
      needsOwner: observation.needsOwner,
      summary: Object.fromEntries(
        counts.map((key) => [
          key,
          (observation.summary as Record<string, unknown>)[key],
        ]),
      ) as unknown as WeeklyScopeSummary,
    };
  }
  return {
    scopes,
    unknown: [...value.unknown],
    repository: repositorySummary(value.repository),
  };
}
export function render(
  marker: string,
  state: QueueState,
  owner: string,
  week: string,
): string {
  const observations = Object.values(state.scopes);
  const maintenanceReceipts = observations.flatMap((scope) =>
    Object.entries(scope.receipts)
      .filter(([date]) => offeringWeekStart(date) === week)
      .map(([, receipt]) => receipt),
  );
  const pending = observations.filter((s) => s.needsOwner).length;
  const stale = observations.filter((s) => s.date < week).length;
  const text = [
    marker,
    BEGIN,
    `${STATE}${encodeURIComponent(JSON.stringify(state))} -->`,
    "## Overview/Coverage",
    "",
    `${observations.length} exact maintenance scopes observed; ${pending} require review; ${stale} await this week's observation.`,
    "",
    "## Merged repository fixes",
    "",
    ...(state.repository.merged.length === 0
      ? ["None recorded."]
      : state.repository.merged.map(
          (fix) =>
            `- PR #${fix.pullRequest} merged as ${fix.commit}; combined-main verification ${fix.verification}; rollout ${fix.rollout}.`,
        )),
    "",
    "## Verified maintenance",
    "",
    `Verified maintenance entries: ${maintenanceReceipts.reduce((n, receipt) => n + receipt.verifiedMaintenance, 0)}. Checked entries: ${observations.reduce((n, s) => n + s.summary.checkedMaintenance, 0)}; verified control writes: ${maintenanceReceipts.reduce((n, receipt) => n + receipt.verifiedControlWrites, 0)}. Detailed work and source provenance remain in private daily evidence.`,
    "",
    "## Unresolved work",
    "",
    `Pending scopes: ${pending}; repository work: ${state.repository.unresolved}; parked items: ${observations.reduce((n, s) => n + s.summary.parked, 0)}; failures: ${observations.reduce((n, s) => n + s.summary.failures, 0)}.`,
    ...(state.repository.pendingIssueNumbers ?? []).map(
      (n) => `- Repository issue awaiting reconciliation: #${n}.`,
    ),
    ...(state.repository.pendingPullRequestNumbers ?? []).map(
      (n) => `- Repository pull request awaiting reconciliation: #${n}.`,
    ),
    ...state.unknown.map(
      (n) =>
        `- Transferred evidence-unknown work: #${n}; not automatically resolved.`,
    ),
    "",
    "## Awaiting verification",
    "",
    `Prior-week scopes: ${stale}; maintenance entries: ${observations.reduce((n, s) => n + s.summary.awaitingMaintenance, 0)}; repository work: ${state.repository.awaiting}.`,
    "",
    "## Verification limits",
    "",
    "Missing/partial observations remain unknown. A merge is distinct from combined-main and rollout verification. Backend identity, future schedules and live provider health are not inferred from local checks.",
    END,
    owner,
  ].join("\n");
  if (Buffer.byteLength(text) > 60_000)
    throw new Error(
      "Weekly review exceeds bounded publication size; preserved issues require reconciliation.",
    );
  return text;
}
export function mergeState(target: QueueState, incoming: QueueState): void {
  for (const [id, scope] of Object.entries(incoming.scopes)) {
    const existing = target.scopes[id];
    const receipts = mergeReceipts(existing?.receipts ?? {}, scope.receipts);
    if (existing === undefined || existing.date < scope.date)
      target.scopes[id] = { ...scope, receipts };
    else {
      if (
        existing.date === scope.date &&
        JSON.stringify({ ...existing, receipts: {} }) !==
          JSON.stringify({ ...scope, receipts: {} })
      )
        throw new Error(
          "Conflicting same-day scope observations require reconciliation.",
        );
      existing.receipts = receipts;
    }
  }
  target.unknown = [...new Set([...target.unknown, ...incoming.unknown])].sort(
    (a, b) => a - b,
  );
  const fixes = new Map(
    target.repository.merged.map((fix) => [
      `${fix.pullRequest}:${fix.commit}`,
      fix,
    ]),
  );
  for (const fix of incoming.repository.merged)
    if (!fixes.has(`${fix.pullRequest}:${fix.commit}`))
      fixes.set(`${fix.pullRequest}:${fix.commit}`, fix);
  target.repository.merged = [...fixes.values()];
  target.repository.pendingIssueNumbers = issueNumbers([
    ...(target.repository.pendingIssueNumbers ?? []),
    ...(incoming.repository.pendingIssueNumbers ?? []),
  ]);
  target.repository.pendingPullRequestNumbers = issueNumbers([
    ...(target.repository.pendingPullRequestNumbers ?? []),
    ...(incoming.repository.pendingPullRequestNumbers ?? []),
  ]);
  // Missing fresh repository evidence cannot erase unresolved earlier work.
  target.repository.unresolved = Math.max(
    target.repository.unresolved,
    incoming.repository.unresolved,
  );
  target.repository.awaiting = Math.max(
    target.repository.awaiting,
    incoming.repository.awaiting,
  );
}
