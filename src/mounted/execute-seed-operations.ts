import { mkdir, rename } from "node:fs/promises";

import type { SeedOperation } from "../seed/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import {
  appendSeedJournalEvent,
  type SeedJournal,
} from "./seed-operation-journal.js";
import {
  createSeedOperation,
  inspectSeedOperation,
  optionalLstat,
  publicSeedOperation,
} from "./seed-target-state.js";
import type { SeedExecutionOptions } from "./types.js";

export interface SeedExecutionFailure {
  outcome: "blocked" | "partially-completed";
  phase: "staging" | "verification" | "publication";
  evidence: string;
}

export async function stageSeedPlan(
  journal: SeedJournal,
  operations: SeedOperation[],
  auditRoot: (root: string) => Promise<string[]>,
  options: SeedExecutionOptions,
): Promise<SeedExecutionFailure | undefined> {
  const stagingRoot = journal.started.stagingRoot;
  await mkdir(stagingRoot, { recursive: true });
  const failure = await applyOperations({
    root: stagingRoot,
    operations,
    journal,
    phase: "staging",
    checkpoint: "during-staging",
    options,
  });
  if (failure !== undefined) return failure;
  await ensureMaterialized(stagingRoot);
  const findings = await auditRoot(stagingRoot);
  return findings.length === 0
    ? undefined
    : {
        outcome: "partially-completed",
        phase: "verification",
        evidence: findings.join(" "),
      };
}

export async function publishSeedPlan(
  journal: SeedJournal,
  targetRoot: string,
  targetLabel: string,
  operations: SeedOperation[],
  options: SeedExecutionOptions,
): Promise<SeedExecutionFailure | undefined> {
  const targetMetadata = await optionalLstat(targetRoot);
  if (journal.started.preconditions.targetState === "absent") {
    if (targetMetadata !== undefined) {
      return {
        outcome: "blocked",
        phase: "publication",
        evidence: `Publication target ${targetLabel} appeared after approval.`,
      };
    }
    await options.checkpoint?.({ checkpoint: "during-publication" });
    try {
      await rename(journal.started.stagingRoot, targetRoot);
      return undefined;
    } catch (error) {
      return {
        outcome: "partially-completed",
        phase: "publication",
        evidence: errorMessage(
          error,
          `Could not publish the complete staged target ${targetLabel}.`,
        ),
      };
    }
  }
  if (
    targetMetadata !== undefined &&
    (targetMetadata.isSymbolicLink() || !targetMetadata.isDirectory())
  ) {
    return {
      outcome: "blocked",
      phase: "publication",
      evidence: `Publication target ${targetLabel} is not an ordinary directory.`,
    };
  }
  if (targetMetadata === undefined) {
    return {
      outcome: "blocked",
      phase: "publication",
      evidence: `Approved partial target ${targetLabel} disappeared before publication.`,
    };
  }
  return await applyOperations({
    root: targetRoot,
    operations,
    journal,
    phase: "publication",
    checkpoint: "during-publication",
    options,
  });
}

export async function seedCheckpoint(
  options: SeedExecutionOptions,
  checkpoint: "before-staging" | "before-publication" | "after-publication",
): Promise<void> {
  await options.checkpoint?.({ checkpoint });
}

async function applyOperations(input: {
  root: string;
  operations: SeedOperation[];
  journal: SeedJournal;
  phase: "staging" | "publication";
  checkpoint: "during-staging" | "during-publication";
  options: SeedExecutionOptions;
}): Promise<SeedExecutionFailure | undefined> {
  for (const operation of input.operations) {
    const state = await inspectSeedOperation(input.root, operation);
    if (state === "conflict") {
      return {
        outcome:
          input.phase === "publication" ? "blocked" : "partially-completed",
        phase: input.phase,
        evidence: `${input.phase === "publication" ? "New" : "Staging"} conflict for ${operation.path}.`,
      };
    }
    if (state === "absent") {
      try {
        await createSeedOperation(input.root, operation);
      } catch (error) {
        return {
          outcome: "partially-completed",
          phase: input.phase,
          evidence: errorMessage(
            error,
            `Could not ${input.phase === "staging" ? "stage" : "publish"} ${operation.path}.`,
          ),
        };
      }
    }
    if (!journalHasOperation(input.journal, input.phase, operation.path)) {
      await input.options.checkpoint?.({
        checkpoint: input.checkpoint,
        operation: publicSeedOperation(operation),
      });
      await appendSeedJournalEvent(input.journal, {
        type: "operation-completed",
        phase: input.phase,
        operation: publicSeedOperation(operation),
      });
    }
  }
  return undefined;
}

function journalHasOperation(
  journal: SeedJournal,
  phase: "staging" | "publication",
  path: string,
): boolean {
  return journal.events.some(
    (event) =>
      event.type === "operation-completed" &&
      event.phase === phase &&
      event.operation.path === path,
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
