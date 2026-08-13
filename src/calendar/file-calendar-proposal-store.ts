import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { OperationalError } from "../operational-error.js";
import {
  isJsonObject,
  isMissingFile,
  replacePrivateCalendarJson,
} from "./private-calendar-json.js";
import type { CalendarProposalStore, OwnedCalendarRole } from "./types.js";

export function createFileCalendarProposalStore(
  stateRoot: string,
): CalendarProposalStore {
  const transition = async (
    proposalId: string,
    fields: Record<string, unknown>,
  ): Promise<void> => {
    const value = await readProposalState(stateRoot);
    await replacePrivateCalendarJson(
      join(stateRoot, "calendar", "pending-proposals.json"),
      "pending-proposals",
      {
        schemaVersion: 1,
        proposals: value.proposals.map((proposal) =>
          isJsonObject(proposal) && proposal.id === proposalId
            ? { ...proposal, ...fields }
            : proposal,
        ),
      },
    );
  };
  return {
    markPromoted: async (proposalId) =>
      await transition(proposalId, { status: "promoted" }),
    markStale: async (proposalId, reason) =>
      await transition(proposalId, { status: "stale", staleReason: reason }),
    read: async (proposalId) => {
      const value = await readProposalState(stateRoot);
      const proposal = value.proposals.find(
        (candidate) => isJsonObject(candidate) && candidate.id === proposalId,
      );
      return proposal as Awaited<ReturnType<CalendarProposalStore["read"]>>;
    },
    writeCurrent: async (proposal) => {
      await replacePrivateCalendarJson(
        join(stateRoot, "calendar", "pending-proposals.json"),
        "pending-proposals",
        { schemaVersion: 1, proposals: [proposal] },
      );
    },
    markStaleForDeletedItems: async (deletedItems) => {
      if (deletedItems.length === 0) return;
      const target = join(stateRoot, "calendar", "pending-proposals.json");
      let value: unknown;
      try {
        value = JSON.parse(await readFile(target, "utf8"));
      } catch (error) {
        if (isMissingFile(error)) return;
        throw invalidProposalState();
      }
      if (!isJsonObject(value) || !Array.isArray(value.proposals)) {
        throw invalidProposalState();
      }
      const deletedKeys = new Set(
        deletedItems.map(
          ({ calendarRole, eventId }) => `${calendarRole}\0${eventId}`,
        ),
      );
      let changed = false;
      const proposals = value.proposals.map((proposal) => {
        if (
          !isJsonObject(proposal) ||
          proposal.status !== "ready" ||
          !Array.isArray(proposal.liveVersions) ||
          !proposal.liveVersions.some((version) =>
            isDeletedDependency(version, deletedKeys),
          )
        ) {
          return proposal;
        }
        changed = true;
        return {
          ...proposal,
          status: "stale",
          staleReason: "live-item-deleted",
        };
      });
      if (!changed) return;
      await replacePrivateCalendarJson(target, "pending-proposals", {
        ...value,
        proposals,
      });
    },
  };
}

async function readProposalState(
  stateRoot: string,
): Promise<{ proposals: unknown[] }> {
  try {
    const value: unknown = JSON.parse(
      await readFile(
        join(stateRoot, "calendar", "pending-proposals.json"),
        "utf8",
      ),
    );
    if (!isJsonObject(value) || !Array.isArray(value.proposals)) {
      throw invalidProposalState();
    }
    return { proposals: value.proposals };
  } catch (error) {
    if (error instanceof OperationalError) throw error;
    throw invalidProposalState();
  }
}

function isDeletedDependency(
  value: unknown,
  deletedKeys: ReadonlySet<string>,
): boolean {
  if (!isJsonObject(value)) return false;
  const calendarRole = value.calendarRole;
  const eventId = value.eventId;
  return (
    isOwnedCalendarRole(calendarRole) &&
    typeof eventId === "string" &&
    deletedKeys.has(`${calendarRole}\0${eventId}`)
  );
}

function isOwnedCalendarRole(value: unknown): value is OwnedCalendarRole {
  return value === "Academic" || value === "Commitments" || value === "Routine";
}

function invalidProposalState(): OperationalError {
  return new OperationalError(
    "operational-failure",
    "The private pending Calendar Proposal state is invalid.",
  );
}
