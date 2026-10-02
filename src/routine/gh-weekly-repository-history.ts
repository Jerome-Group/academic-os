import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { OperationalError } from "../mounted/index.js";
import { isCalendarDay } from "./offering-calendar-day.js";
import type { GhMorningIssueRunner } from "./gh-morning-issue.js";
import type { WeeklyRepositorySummary } from "./types.js";

// Independent discovery recovers facts even when the daily process stopped between merge and
// weekly publication. Provider merge facts alone establish neither rollout nor semantic review.
export function createGhWeeklyRepositoryHistory(
  ghPath: string,
  runner: GhMorningIssueRunner = runHistoryQuery,
): (weekStart: string) => Promise<WeeklyRepositorySummary> {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return async (weekStart) => {
    if (!isCalendarDay(weekStart)) throw unavailable();
    const start = Date.parse(`${weekStart}T00:00:00+08:00`);
    const end = start + 7 * 86_400_000;
    const from = new Date(start).toISOString().slice(0, 10);
    const to = new Date(end).toISOString().slice(0, 10);
    const records: unknown = JSON.parse(
      runner({
        ghPath,
        repositoryRoot,
        arguments: [
          "pr",
          "list",
          "--state",
          "merged",
          "--search",
          `merged:${from}..${to}`,
          "--limit",
          "1000",
          "--json",
          "number,mergeCommit,mergedAt",
        ],
      }),
    );
    if (!Array.isArray(records) || records.length >= 1000) throw unavailable();
    const merged: WeeklyRepositorySummary["merged"] = [];
    const seen = new Set<number>();
    for (const record of records) {
      if (
        typeof record !== "object" ||
        record === null ||
        !Number.isSafeInteger(record.number) ||
        record.number <= 0 ||
        typeof record.mergedAt !== "string" ||
        typeof record.mergeCommit?.oid !== "string" ||
        !/^[a-f0-9]{40}$/u.test(record.mergeCommit.oid) ||
        seen.has(record.number)
      )
        throw unavailable();
      seen.add(record.number);
      const time = Date.parse(record.mergedAt);
      if (!Number.isFinite(time)) throw unavailable();
      if (time >= start && time < end)
        merged.push({
          pullRequest: record.number,
          commit: record.mergeCommit.oid,
          verification: "awaiting",
          rollout: "awaiting",
        });
    }
    return {
      merged: merged.sort((a, b) => a.pullRequest - b.pullRequest),
      unresolved: 0,
      awaiting: 0,
    };
  };
}

function unavailable(): OperationalError {
  return new OperationalError(
    "operational-failure",
    "Weekly merged repository evidence is unavailable or incomplete.",
  );
}

function runHistoryQuery(input: Parameters<GhMorningIssueRunner>[0]): string {
  const result = spawnSync(input.ghPath, input.arguments, {
    cwd: input.repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw unavailable();
  return result.stdout;
}
