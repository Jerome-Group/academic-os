import {
  createFileOwnedCalendarMirrorStore,
  createFileCalendarProposalStore,
  createFileOwnedCalendarWorkspaceReader,
  createGoogleCalendarRefreshReader,
  refreshOwnedCalendars,
  type CalendarRefreshReport,
} from "../calendar/index.js";
import { loadLocalConfig, resolveCalendarConfig } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage = "Usage: academic-os calendar refresh --config <path> [--json]";

export async function runCalendarRefreshCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const configPath = parseCalendarRefreshArguments(arguments_);
  const config = await loadLocalConfig(configPath);
  const calendar = await resolveCalendarConfig(config);
  const report = await refreshOwnedCalendars({
    managementHorizon: calendar.managementHorizon,
    reader: createGoogleCalendarRefreshReader(
      calendar.credentials.scheduledRead,
    ),
    workspaceReader: createFileOwnedCalendarWorkspaceReader(calendar.stateRoot),
    mirrorStore: createFileOwnedCalendarMirrorStore(calendar.stateRoot),
    proposalStore: createFileCalendarProposalStore(calendar.stateRoot),
    refreshedAt: new Date().toISOString(),
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome !== "refreshed") process.exitCode = 2;
}

function parseCalendarRefreshArguments(arguments_: string[]): string {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "refresh",
    valueFlags: ["--config"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return configPath;
}

function renderHuman(report: CalendarRefreshReport): string {
  return [
    `Calendar refresh: ${report.outcome}`,
    `Management horizon: ${report.managementHorizon}`,
    ...report.calendars.map(
      ({ role, counts, lastSuccessfulRefresh, freshness }) =>
        [
          `${role}: ${quantity(counts.items, "item")}`,
          quantity(counts.recurringMasters, "recurring master"),
          quantity(counts.exceptions, "exception"),
          `${counts.invited} invited; ${freshness}; last successful Refresh ${lastSuccessfulRefresh ?? "never"}`,
        ].join(", "),
    ),
    `Placement suggestions: ${report.placementSuggestions.length}`,
    ...report.placementSuggestions.map(
      ({ eventId, summary, actualRole, suggestedRole, reason }) =>
        `${eventId} ${JSON.stringify(summary)}: ${actualRole} -> ${suggestedRole} (${reason.replace("-", " ")})`,
    ),
  ].join("\n");
}

function quantity(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
