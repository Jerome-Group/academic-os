import { readFile } from "node:fs/promises";

import {
  createCalendarProposal,
  createFileCalendarProposalStore,
  createFileOwnedCalendarMirrorStore,
  createFileOwnedCalendarWorkspaceReader,
  createGoogleCalendarProposalReader,
  type CalendarProposeReport,
} from "../calendar/index.js";
import { loadLocalConfig, resolveCalendarConfig } from "../config/index.js";
import { OperationalError } from "../operational-error.js";
import { parseArgumentTokens } from "./argument-tokens.js";

const usage =
  "Usage: academic-os calendar propose --config <path> --input <path> [--json]";

export async function runCalendarProposeCommand(
  arguments_: string[],
  json: boolean,
): Promise<void> {
  const parsed = parseCalendarProposeArguments(arguments_);
  const [config, value] = await Promise.all([
    loadLocalConfig(parsed.configPath),
    readProposalInput(parsed.inputPath),
  ]);
  const calendar = await resolveCalendarConfig(config);
  const report = await createCalendarProposal({
    value,
    reader: createGoogleCalendarProposalReader(
      calendar.credentials.scheduledRead,
    ),
    workspaceReader: createFileOwnedCalendarWorkspaceReader(calendar.stateRoot),
    mirrorStore: createFileOwnedCalendarMirrorStore(calendar.stateRoot),
    proposalStore: createFileCalendarProposalStore(calendar.stateRoot),
  });
  process.stdout.write(
    json ? `${JSON.stringify(report, null, 2)}\n` : `${renderHuman(report)}\n`,
  );
  if (report.outcome === "blocked") process.exitCode = 3;
}

function parseCalendarProposeArguments(arguments_: string[]): {
  configPath: string;
  inputPath: string;
} {
  const { values } = parseArgumentTokens({
    arguments: arguments_,
    command: "propose",
    valueFlags: ["--config", "--input"],
    booleanFlags: ["--json"],
    usage,
  });
  const configPath = values.get("--config");
  const inputPath = values.get("--input");
  if (configPath === undefined || inputPath === undefined) {
    throw new OperationalError("invalid-arguments", usage);
  }
  return { configPath, inputPath };
}

async function readProposalInput(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new OperationalError(
      "invalid-target",
      "Calendar Proposal input must be readable JSON.",
    );
  }
}

function renderHuman(report: CalendarProposeReport): string {
  return [
    `Calendar propose: ${report.outcome}`,
    `Proposal: ${JSON.stringify(report.proposal)}`,
    `Conflicts: ${JSON.stringify(report.conflicts)}`,
    `Warnings: ${JSON.stringify(report.warnings)}`,
    `Workspace: ${report.workspace.replace("-", " ")}`,
  ].join("\n");
}
