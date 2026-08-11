import { mkdir } from "node:fs/promises";

import type { SeedOperation, SeedPlan } from "../seed/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import {
  appendSeedJournalEvent,
  type SeedJournal,
  type SeedTargetIdentity,
} from "./seed-operation-journal.js";
import {
  auditSeedRoot,
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
  plan: SeedPlan,
  options: SeedExecutionOptions,
): Promise<SeedExecutionFailure | undefined> {
  const stagingRoot = journal.started.stagingRoot;
  await mkdir(stagingRoot, { recursive: true });
  const failure = await applyOperations({
    root: stagingRoot,
    operations: plan.operations,
    journal,
    phase: "staging",
    checkpoint: "during-staging",
    options,
  });
  if (failure !== undefined) return failure;
  await ensureMaterialized(stagingRoot);
  const findings = await auditSeedRoot(stagingRoot, plan);
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
  target: SeedTargetIdentity,
  plan: SeedPlan,
  options: SeedExecutionOptions,
): Promise<SeedExecutionFailure | undefined> {
  const targetMetadata = await optionalLstat(target.moduleRoot);
  if (
    targetMetadata !== undefined &&
    (targetMetadata.isSymbolicLink() || !targetMetadata.isDirectory())
  ) {
    return {
      outcome: "blocked",
      phase: "publication",
      evidence: `Publication target ${plan.module} is not an ordinary directory.`,
    };
  }
  if (targetMetadata === undefined) await mkdir(target.moduleRoot);
  return await applyOperations({
    root: target.moduleRoot,
    operations: plan.operations,
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
