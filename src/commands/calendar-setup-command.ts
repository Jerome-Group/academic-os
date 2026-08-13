import {
  createFileOwnedCalendarWorkspaceStore,
  createGoogleCalendarSetupReader,
  createGoogleCalendarSetupWriter,
  setupOwnedCalendars,
  type CalendarSetupReport,
} from "../calendar/index.js";
import { loadLocalConfig, resolveCalendarConfig } from "../config/index.js";
import { OperationalError } from "../mounted/index.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os calendar setup --config <path> [--apply] [--json]";

export async function runCalendarSetupCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseCalendarSetupArguments(arguments_);
  const config = await loadLocalConfig(parsed.configPath);
  const calendar = await resolveCalendarConfig(config);
  const report = await setupOwnedCalendars({
    managementHorizon: calendar.managementHorizon,
    reader: createGoogleCalendarSetupReader(
      calendar.credentials?.scheduledRead,
    ),
    writer: createGoogleCalendarSetupWriter(
      calendar.credentials?.interactiveWrite,
    ),
    workspaceStore: createFileOwnedCalendarWorkspaceStore(calendar.stateRoot),
    apply: parsed.apply,
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
}

function parseCalendarSetupArguments(arguments_: string[]): {
  configPath: string;
  apply: boolean;
} {
  const { values, flags } = parseArgumentTokens({
    arguments: arguments_,
    command: "setup",
    valueFlags: ["--config"],
    booleanFlags: ["--apply", "--json"],
    usage,
  });
  const configPath = values.get("--config");
  if (configPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, apply: flags.has("--apply") };
}

function renderHuman(report: CalendarSetupReport): string {
  const calendars = report.calendars.map(
    ({ role, action, source }) =>
      `${role}: ${action.replace("-", " ")} (${source})`,
  );
  return [
    `Calendar setup: ${report.outcome}`,
    `Default timezone: ${report.defaultTimezone}`,
    `Management horizon: ${report.managementHorizon}`,
    ...calendars,
    `Workspace: ${report.workspace.replace("-", " ")}`,
  ].join("\n");
}
