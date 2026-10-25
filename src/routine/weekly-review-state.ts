import { createHash } from "node:crypto";
import { isCalendarDay } from "./offering-calendar-day.js";
import { offeringWeekStart } from "./offering-week-start.js";
import type { WeeklyRepositorySummary, WeeklyScopeSummary } from "./types.js";

export interface WeeklyObservation {
  scope: string;
  date: string;
  parents: string[];
  repositoryParents: string[];
  summary: WeeklyScopeSummary;
  needsOwner: boolean;
  repository?: WeeklyRepositorySummary;
}
export interface PublishedObservation {
  id: string;
  observation: WeeklyObservation;
  issueNumber: number;
  commentId: number;
  url: string;
}
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid weekly record.");
  return value as Record<string, unknown>;
}
export function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid weekly count.");
  return value;
}
export function positive(value: unknown): number {
  const n = count(value);
  if (n === 0) throw new Error("Invalid weekly identity.");
  return n;
}
export function day(value: unknown): string {
  if (typeof value !== "string" || !isCalendarDay(value))
    throw new Error("Invalid weekly observation date.");
  return value;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Invalid weekly digest.");
  return value;
}
export function hashes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("Invalid weekly parents.");
  const result = value.map(hash);
  if (new Set(result).size !== result.length)
    throw new Error("Duplicate weekly parent.");
  return result.sort();
}
export function issueNumbers(value: unknown = []): number[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("Invalid weekly issue references.");
  return [...new Set(value.map(positive))].sort((a, b) => a - b);
}
function status(value: unknown): "verified" | "failed" | "awaiting" {
  if (value !== "verified" && value !== "failed" && value !== "awaiting")
    throw new Error("Invalid verification status.");
  return value;
}
export function repositorySummary(value: unknown): WeeklyRepositorySummary {
  const input = record(value);
  if (!Array.isArray(input.merged) || input.merged.length > 500)
    throw new Error("Invalid weekly merge evidence.");
  return {
    pendingIssueNumbers: issueNumbers(input.pendingIssueNumbers),
    pendingPullRequestNumbers: issueNumbers(input.pendingPullRequestNumbers),
    merged: input.merged
      .map((value) => {
        const fix = record(value);
        if (
          typeof fix.commit !== "string" ||
          !/^[a-f0-9]{40}$/u.test(fix.commit)
        )
          throw new Error("Invalid merge commit.");
        return {
          pullRequest: positive(fix.pullRequest),
          ...(fix.originIssue === undefined
            ? {}
            : { originIssue: positive(fix.originIssue) }),
          commit: fix.commit,
          verification: status(fix.verification),
          rollout: status(fix.rollout),
        };
      })
      .sort(
        (a, b) =>
          a.pullRequest - b.pullRequest || a.commit.localeCompare(b.commit),
      ),
    unresolved: count(input.unresolved),
    awaiting: count(input.awaiting),
  };
}
export function parseObservation(value: unknown): WeeklyObservation {
  const input = record(value),
    summary = record(input.summary);
  if (typeof input.needsOwner !== "boolean")
    throw new Error("Invalid weekly attention.");
  return {
    scope: hash(input.scope),
    date: day(input.date),
    parents: hashes(input.parents),
    repositoryParents: hashes(input.repositoryParents),
    summary: {
      targets: count(summary.targets),
      preludePending: count(summary.preludePending),
      parked: count(summary.parked),
      failures: count(summary.failures),
      verifiedMaintenance: count(summary.verifiedMaintenance),
      checkedMaintenance: count(summary.checkedMaintenance),
      verifiedControlWrites: count(summary.verifiedControlWrites),
      awaitingMaintenance: count(summary.awaitingMaintenance),
    },
    needsOwner: input.needsOwner,
    ...(input.repository === undefined
      ? {}
      : { repository: repositorySummary(input.repository) }),
  };
}
export const observationPrefix = "<!-- academic-os-weekly-observation:v2 ";
export function observationMarker(observation: WeeklyObservation): string {
  return `${observationPrefix}${encodeURIComponent(JSON.stringify(observation))} -->`;
}
export function parsePublication(body: string): WeeklyObservation | undefined {
  if (!body.startsWith(observationPrefix)) return undefined;
  const end = body.indexOf(" -->\n");
  if (end < 0) throw new Error("Malformed weekly publication.");
  const raw = JSON.parse(
    decodeURIComponent(body.slice(observationPrefix.length, end)),
  );
  const observation = parseObservation(raw);
  if (JSON.stringify(raw) !== JSON.stringify(observation))
    throw new Error("Noncanonical weekly publication.");
  return observation;
}
export function validateHistory(
  records: PublishedObservation[],
  date: string,
): void {
  if (records.length > 500)
    throw new Error("Weekly history exceeds 500 observations.");
  const byId = new Map(records.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Cyclic weekly basis.");
    visiting.add(id);
    const item = byId.get(id)?.observation;
    for (const ancestor of [
      ...(item?.parents ?? []),
      ...(item?.repositoryParents ?? []),
    ])
      visit(ancestor);
    visiting.delete(id);
    visited.add(id);
  }
  for (const { observation, id } of records) {
    if (observation.date > date || digest(observation) !== id)
      throw new Error("Future or invalid weekly observation.");
    for (const parent of observation.parents) {
      const known = byId.get(parent);
      if (
        known === undefined ||
        known.observation.scope !== observation.scope ||
        known.observation.date > observation.date
      )
        throw new Error("Unknown or inconsistent scope basis.");
    }
    for (const parent of observation.repositoryParents) {
      const known = byId.get(parent);
      if (
        known?.observation.repository === undefined ||
        known.observation.date > observation.date
      )
        throw new Error("Unknown or inconsistent repository basis.");
    }
    visit(id);
  }
}
export function scopeHeads(
  records: PublishedObservation[],
  scope: string,
): string[] {
  const scopes = records.filter((r) => r.observation.scope === scope);
  const parents = new Set(scopes.flatMap((r) => r.observation.parents));
  return scopes
    .map((r) => r.id)
    .filter((id) => !parents.has(id))
    .sort();
}
export function repositoryHeads(records: PublishedObservation[]): string[] {
  const repos = records.filter((r) => r.observation.repository !== undefined);
  const parents = new Set(
    repos.flatMap((r) => r.observation.repositoryParents),
  );
  return repos
    .map((r) => r.id)
    .filter((id) => !parents.has(id))
    .sort();
}
function scopeStatus(observation: WeeklyObservation): string {
  const {
    verifiedMaintenance: _m,
    verifiedControlWrites: _w,
    ...summary
  } = observation.summary;
  return JSON.stringify([summary, observation.needsOwner]);
}
export interface WeeklyView {
  scopes: number;
  pending: number;
  stale: number;
  conflicts: string[];
  checked: number;
  parked: number;
  failures: number;
  awaitingMaintenance: number;
  maintained: number;
  controlWrites: number;
  repository: WeeklyRepositorySummary;
  unknown: number[];
  actionable: boolean;
}
export function reduceWeekly(
  records: PublishedObservation[],
  week: string,
  unknown: number[],
): WeeklyView {
  const view: WeeklyView = {
    scopes: 0,
    pending: 0,
    stale: 0,
    conflicts: [],
    checked: 0,
    parked: 0,
    failures: 0,
    awaitingMaintenance: 0,
    maintained: 0,
    controlWrites: 0,
    repository: {
      merged: [],
      unresolved: 0,
      awaiting: 0,
      pendingIssueNumbers: [],
      pendingPullRequestNumbers: [],
    },
    unknown: [...new Set(unknown)].sort((a, b) => a - b),
    actionable: false,
  };
  for (const scope of new Set(records.map((r) => r.observation.scope))) {
    const ids = scopeHeads(records, scope),
      heads = records.filter((r) => ids.includes(r.id));
    const observations = heads.map((r) => r.observation);
    view.scopes += 1;
    if (new Set(observations.map(scopeStatus)).size > 1)
      view.conflicts.push(...ids);
    if (observations.some((o) => o.needsOwner)) view.pending += 1;
    if (observations.every((o) => o.date < week)) view.stale += 1;
    view.checked += Math.max(
      0,
      ...observations.map((o) => o.summary.checkedMaintenance),
    );
    view.parked += Math.max(0, ...observations.map((o) => o.summary.parked));
    view.failures += Math.max(
      0,
      ...observations.map((o) => o.summary.failures),
    );
    view.awaitingMaintenance += Math.max(
      0,
      ...observations.map((o) => o.summary.awaitingMaintenance),
    );
    const dates = new Set(
      records
        .filter(
          (r) =>
            r.observation.scope === scope &&
            offeringWeekStart(r.observation.date) === week,
        )
        .map((r) => r.observation.date),
    );
    for (const date of dates) {
      const entries = records.filter(
        (r) => r.observation.scope === scope && r.observation.date === date,
      );
      view.maintained += Math.max(
        0,
        ...entries.map((r) => r.observation.summary.verifiedMaintenance),
      );
      view.controlWrites += Math.max(
        0,
        ...entries.map((r) => r.observation.summary.verifiedControlWrites),
      );
    }
  }
  const repoIds = repositoryHeads(records),
    repoHeads = records.filter((r) => repoIds.includes(r.id));
  const repoStatus = (r: PublishedObservation) =>
    JSON.stringify([
      r.observation.repository?.unresolved,
      r.observation.repository?.awaiting,
    ]);
  if (new Set(repoHeads.map(repoStatus)).size > 1)
    view.conflicts.push(...repoIds);
  view.repository.unresolved = Math.max(
    0,
    ...repoHeads.map((r) => r.observation.repository?.unresolved ?? 0),
  );
  view.repository.awaiting = Math.max(
    0,
    ...repoHeads.map((r) => r.observation.repository?.awaiting ?? 0),
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  const ancestry = new Map<string, Set<string>>();
  function repositoryAncestors(child: PublishedObservation): Set<string> {
    const known = ancestry.get(child.id);
    if (known !== undefined) return known;
    const result = new Set(child.observation.repositoryParents);
    for (const id of child.observation.repositoryParents) {
      const parent = byId.get(id);
      if (parent !== undefined)
        for (const ancestor of repositoryAncestors(parent))
          result.add(ancestor);
    }
    ancestry.set(child.id, result);
    return result;
  }
  const fixes = records.flatMap((r) =>
    (r.observation.repository?.merged ?? []).map((fix) => ({ r, fix })),
  );
  const reducedFixes: WeeklyRepositorySummary["merged"] = [];
  for (const key of new Set(
    fixes.map(({ fix }) => `${fix.pullRequest}:${fix.commit}`),
  )) {
    const matching = fixes.filter(
        ({ fix }) => `${fix.pullRequest}:${fix.commit}` === key,
      ),
      first = matching[0];
    if (first === undefined) continue;
    function verification(
      check: "verification" | "rollout",
    ): "verified" | "failed" | "awaiting" {
      const actual = matching.filter(({ fix }) => fix[check] !== "awaiting");
      const heads = actual.filter(
        ({ r }) =>
          !actual.some(
            (next) =>
              next.r.id !== r.id && repositoryAncestors(next.r).has(r.id),
          ),
      );
      const results = new Set(heads.map(({ fix }) => fix[check]));
      if (results.size > 1) {
        view.conflicts.push(...heads.map(({ r }) => r.id));
        return "awaiting";
      }
      return heads[0]?.fix[check] ?? "awaiting";
    }
    const fix = {
      ...first.fix,
      verification: verification("verification"),
      rollout: verification("rollout"),
    };
    reducedFixes.push(fix);
    const originIssues = [
      ...new Set(
        matching.flatMap(({ fix }) =>
          fix.originIssue === undefined ? [] : [fix.originIssue],
        ),
      ),
    ];
    const verified =
      fix.verification === "verified" && fix.rollout === "verified";
    if (
      !verified ||
      matching.some(({ r }) => offeringWeekStart(r.observation.date) === week)
    )
      view.repository.merged.push(fix);
    for (const origin of originIssues)
      if (!verified) view.repository.pendingIssueNumbers?.push(origin);
  }
  const verifiedFixes = fixes.filter(({ fix }) => {
    const reduced = reducedFixes.find(
      (f) => f.pullRequest === fix.pullRequest && f.commit === fix.commit,
    );
    return (
      reduced?.verification === "verified" && reduced.rollout === "verified"
    );
  });
  const unverifiedFixes = fixes.filter((fix) => !verifiedFixes.includes(fix));
  view.repository.pendingIssueNumbers = issueNumbers([
    ...records.flatMap(
      (r) => r.observation.repository?.pendingIssueNumbers ?? [],
    ),
    ...(view.repository.pendingIssueNumbers ?? []),
  ]).filter(
    (n) =>
      !verifiedFixes.some(({ fix }) => fix.originIssue === n) ||
      unverifiedFixes.some(({ fix }) => fix.originIssue === n),
  );
  view.repository.pendingPullRequestNumbers = issueNumbers(
    records.flatMap(
      (r) => r.observation.repository?.pendingPullRequestNumbers ?? [],
    ),
  ).filter(
    (n) =>
      !verifiedFixes.some(({ fix }) => fix.pullRequest === n) ||
      unverifiedFixes.some(({ fix }) => fix.pullRequest === n),
  );
  view.repository.merged.sort(
    (a, b) => a.pullRequest - b.pullRequest || a.commit.localeCompare(b.commit),
  );
  view.conflicts = [...new Set(view.conflicts)].sort();
  view.actionable =
    view.pending +
      view.stale +
      view.conflicts.length +
      view.unknown.length +
      view.parked +
      view.failures +
      view.awaitingMaintenance +
      view.repository.unresolved +
      view.repository.awaiting +
      (view.repository.pendingIssueNumbers?.length ?? 0) +
      (view.repository.pendingPullRequestNumbers?.length ?? 0) >
      0 ||
    view.repository.merged.some(
      (fix) => fix.verification !== "verified" || fix.rollout !== "verified",
    );
  if (
    Object.values(view).some(
      (value) => typeof value === "number" && !Number.isSafeInteger(value),
    )
  )
    throw new Error("Weekly totals exceed safe integer bounds.");
  return view;
}
export function renderPublication(
  observation: WeeklyObservation,
  records: PublishedObservation[],
  view: WeeklyView,
  predecessors: number[],
): string {
  const body = [
    observationMarker(observation),
    `As of ${observation.date}. Includes current observation ${digest(observation)} and the publications linked below.`,
    "",
    "## Overview/Coverage",
    "",
    `${view.scopes} exact maintenance scopes observed; ${view.pending} require review; ${view.stale} await this week's observation.`,
    "",
    "## Merged repository fixes",
    "",
    ...(view.repository.merged.length === 0
      ? ["None recorded."]
      : view.repository.merged.map(
          (fix) =>
            `- PR #${fix.pullRequest} merged as ${fix.commit}; combined-main verification ${fix.verification}; rollout ${fix.rollout}.`,
        )),
    "",
    "## Verified maintenance",
    "",
    `Verified maintenance entries: ${view.maintained}. Checked entries: ${view.checked}; verified control writes: ${view.controlWrites}. Detailed work remains in private daily evidence.`,
    "",
    "## Unresolved work",
    "",
    `Pending scopes: ${view.pending}; repository work: ${view.repository.unresolved}; parked items: ${view.parked}; failures: ${view.failures}.`,
    ...(view.repository.pendingIssueNumbers ?? []).map(
      (n) => `- Repository issue awaiting reconciliation: #${n}.`,
    ),
    ...(view.repository.pendingPullRequestNumbers ?? []).map(
      (n) => `- Repository pull request awaiting reconciliation: #${n}.`,
    ),
    ...view.unknown.map(
      (n) =>
        `- Evidence-unknown predecessor or publication: #${n}. Closure does not resolve it.`,
    ),
    "",
    "## Awaiting verification",
    "",
    `Prior-week scopes: ${view.stale}; maintenance entries: ${view.awaitingMaintenance}; repository work: ${view.repository.awaiting}.`,
    ...view.conflicts.map(
      (id) =>
        `- Incomparable observations require fresh work that observes both heads: ${id}. Counters are conservative bounds.`,
    ),
    "",
    "## Verification limits",
    "",
    "Missing evidence remains unknown. A merge is distinct from combined-main and rollout verification. Same account privileged edits cannot be attributed independently. Enumeration is bounded and does not provide provider snapshot isolation.",
    "",
    "## Prior Owner notes",
    "",
    ...[...new Set(predecessors)]
      .sort((a, b) => a - b)
      .map((n) => `- Owner notes and discussion remain in #${n}.`),
    "",
    "## Included publications",
    "",
    ...records.map((r) => `- [${r.id}](${r.url})`),
  ].join("\n");
  if (Buffer.byteLength(body) > 60_000)
    throw new Error("Weekly review exceeds bounded publication size.");
  return body;
}
