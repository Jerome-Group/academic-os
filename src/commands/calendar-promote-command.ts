import {
  createFileCalendarProposalStore,
  createFileCalendarPromotionJournal,
  createFileOwnedCalendarMirrorStore,
  createFileOwnedCalendarWorkspaceReader,
  createGoogleCalendarPromotionWriter,
  createGoogleCalendarProposalReader,
  createGoogleCalendarRefreshReader,
  promoteCalendarProposal,
  refreshOwnedCalendars,
  type CalendarPromotionReport,
} from "../calendar/index.js";
import { loadLocalConfig, resolveCalendarConfig } from "../config/index.js";
import { OperationalError } from "../operational-error.js";

const usage =
  "Usage: academic-os calendar promote <proposal-id> --config <path> [--json]";

export async function runCalendarPromoteCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const { configPath, proposalId } = parseArguments(arguments_);
  const config = await loadLocalConfig(configPath);
  const calendar = await resolveCalendarConfig(config);
  const proposalStore = createFileCalendarProposalStore(calendar.stateRoot);
  const workspaceReader = createFileOwnedCalendarWorkspaceReader(
    calendar.stateRoot,
  );
  const mirrorStore = createFileOwnedCalendarMirrorStore(calendar.stateRoot);
  const report = await promoteCalendarProposal({
    proposalId,
    proposalStore,
    writer: createGoogleCalendarPromotionWriter(
      calendar.credentials.interactiveWrite,
    ),
    journal: createFileCalendarPromotionJournal(calendar.stateRoot),
    reader: createGoogleCalendarProposalReader(
      calendar.credentials.scheduledRead,
    ),
    workspaceReader,
    mirrorStore,
    refresh: async () => {
      return await refreshOwnedCalendars({
        managementHorizon: calendar.managementHorizon,
        reader: createGoogleCalendarRefreshReader(
          calendar.credentials.scheduledRead,
        ),
        workspaceReader,
        mirrorStore,
        proposalStore,
        refreshedAt: new Date().toISOString(),
      });
    },
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report),
  );
  if (report.outcome === "stale" || report.outcome === "blocked") {
    process.exitCode = 3;
  }
}

function parseArguments(arguments_: string[]): {
  configPath: string;
  proposalId: string;
} {
  const proposalId = arguments_[1];
  const configIndex = arguments_.indexOf("--config");
  const configPath = arguments_[configIndex + 1];
  if (
    typeof proposalId !== "string" ||
    proposalId.startsWith("--") ||
    typeof configPath !== "string"
  ) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, proposalId };
}

function renderHuman(report: CalendarPromotionReport): string {
  const lines = [
    `Calendar promote: ${report.outcome}`,
    `Proposal ID: ${report.proposalId}`,
  ];
  if (report.verifiedEvents !== undefined) {
    lines.push(`Verified events: ${JSON.stringify(report.verifiedEvents)}`);
  } else {
    lines.push(
      `Verified event: ${JSON.stringify(report.verifiedEvent ?? null)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
