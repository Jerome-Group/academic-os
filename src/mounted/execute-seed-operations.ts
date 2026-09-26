import { mkdir, realpath } from "node:fs/promises";

import type { SeedOperation } from "../seed/index.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import {
  appendSeedJournalEvent,
  type SeedJournal,
  type SeedRootClaim,
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
  let targetMetadata = await optionalLstat(targetRoot);
  let identity: Pick<SeedRootClaim, "device" | "inode">;
  if (journal.started.preconditions.targetState === "absent") {
    const claim = seedRootClaim(journal);
    if (claim === undefined) {
      if (targetMetadata !== undefined) return publicationBlocked(targetLabel);
      await options.checkpoint?.({ checkpoint: "during-publication" });
      try {
        // mkdir claims the name exclusively; rename would replace an empty target.
        await mkdir(targetRoot);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
          return publicationBlocked(targetLabel);
        return {
          outcome: "partially-completed",
          phase: "publication",
          evidence: errorMessage(
            error,
            `Could not claim target ${targetLabel}.`,
          ),
        };
      }
      targetMetadata = await optionalLstat(targetRoot);
      if (targetMetadata === undefined || !targetMetadata.isDirectory())
        return publicationBlocked(targetLabel);
      identity = {
        device: String(targetMetadata.dev),
        inode: String(targetMetadata.ino),
      };
      await appendSeedJournalEvent(journal, {
        type: "root-claimed",
        ...identity,
      });
    } else {
      identity = claim;
    }
  } else {
    if (
      targetMetadata === undefined ||
      !targetMetadata.isDirectory() ||
      targetMetadata.isSymbolicLink()
    )
      return publicationBlocked(targetLabel);
    identity = {
      device: String(targetMetadata.dev),
      inode: String(targetMetadata.ino),
    };
  }
  return await applyOperations({
    root: targetRoot,
    operations,
    journal,
    phase: "publication",
    checkpoint: "during-publication",
    options,
    verifyRoot: () => rootMatches(targetRoot, identity),
  });
}

export function seedRootClaim(journal: SeedJournal): SeedRootClaim | undefined {
  return journal.events.find((event) => event.type === "root-claimed");
}

export async function claimedSeedRootMatches(
  journal: SeedJournal,
  root: string,
): Promise<boolean> {
  const claim = seedRootClaim(journal);
  return claim !== undefined && (await rootMatches(root, claim));
}

async function rootMatches(
  root: string,
  identity: Pick<SeedRootClaim, "device" | "inode">,
): Promise<boolean> {
  const metadata = await optionalLstat(root);
  return (
    metadata?.isDirectory() === true &&
    (await realpath(root)) === root &&
    !metadata.isSymbolicLink() &&
    String(metadata.dev) === identity.device &&
    String(metadata.ino) === identity.inode
  );
}

function publicationBlocked(targetLabel: string): SeedExecutionFailure {
  return {
    outcome: "blocked",
    phase: "publication",
    evidence: `Publication target ${targetLabel} appeared or changed after approval; its root claim no longer verifies.`,
  };
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
  verifyRoot?: () => Promise<boolean>;
}): Promise<SeedExecutionFailure | undefined> {
  for (const operation of input.operations) {
    if (input.verifyRoot !== undefined && !(await input.verifyRoot())) {
      return publicationBlocked(input.root);
    }
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
        if (input.verifyRoot !== undefined && !(await input.verifyRoot()))
          return publicationBlocked(input.root);
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
