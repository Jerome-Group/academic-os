import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { SeedMode, SeedOperation, SeedOutcome } from "../seed/index.js";
import {
  publishSeedPlan,
  seedCheckpoint,
  type SeedExecutionFailure,
  stageSeedPlan,
} from "./execute-seed-operations.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { OperationalError } from "../operational-error.js";
import {
  appendSeedJournalEvent,
  readSeedJournal,
  seedJournalPath,
  seedPlanDigest,
  seedTargetLabel,
  seedTargetParentRoot,
  seedTargetRoot,
  startSeedJournal,
  type SeedablePlan,
  type SeedJournal,
  type SeedTargetIdentity,
} from "./seed-operation-journal.js";
import {
  inspectSeedOperationState,
  optionalLstat,
  publicSeedOperation,
  type OperationState,
} from "./seed-target-state.js";
import type { SeedExecutionOptions } from "./types.js";

export interface MountedSeedResult {
  outcome: SeedOutcome;
  operations: Array<Pick<SeedOperation, "kind" | "path">>;
  evidence: string[];
}

export interface MountedSeedAdapter {
  parentRoot: string;
  stateRoot: string;
  target: SeedTargetIdentity;
  plan: SeedablePlan;
  contractVersion: number | "unavailable";
  stagingPrefix: string;
  planningBlockers?: string[];
  inspectTarget(): Promise<string[]>;
  auditProjectedTarget(): Promise<string[]>;
  auditRoot(root: string): Promise<string[]>;
  auditTarget(): Promise<string[]>;
  sameTarget(left: SeedTargetIdentity, right: SeedTargetIdentity): boolean;
  completedEvidence: string;
}

export async function seedMountedTarget(
  adapter: MountedSeedAdapter,
  mode: SeedMode,
  options: SeedExecutionOptions = {},
): Promise<MountedSeedResult> {
  try {
    await ensureMaterialized(adapter.parentRoot);
  } catch (error) {
    if (
      error instanceof OperationalError &&
      error.code === "unresolved-placeholder"
    ) {
      return blockedResult(emptyProgress(adapter.plan.operations), [
        error.message,
      ]);
    }
    throw error;
  }
  const planningBlockers = [
    ...adapter.plan.blockers,
    ...(adapter.planningBlockers ?? []),
    ...unresolvedPlaceholders(adapter.plan.operations),
  ];
  if (planningBlockers.length > 0) {
    return blockedResult(
      emptyProgress(adapter.plan.operations),
      planningBlockers,
    );
  }

  const targetBlockers = await adapter.inspectTarget();
  if (targetBlockers.length > 0) {
    return blockedResult(
      emptyProgress(adapter.plan.operations),
      targetBlockers,
    );
  }
  const targetRoot = seedTargetRoot(adapter.target);
  const current = await inspectSeedOperationState(
    targetRoot,
    adapter.plan.operations,
  );

  const journalPath = seedJournalPath(adapter.stateRoot, adapter.target);
  const journalRead = await readSeedJournal(journalPath);
  if (journalRead.diagnostic !== undefined) {
    return blockedResult(current, [journalRead.diagnostic]);
  }
  const stageBlocker = await reconcileStagingArtifacts(
    adapter,
    journalRead.journal,
  );
  if (stageBlocker !== undefined) {
    return {
      outcome: "abandoned-staging",
      operations: current.remaining.map(publicSeedOperation),
      evidence: [stageBlocker, progressEvidence(current)],
    };
  }

  const journal = journalRead.journal;
  if (journal !== undefined) {
    const journalBlockers = validateJournal(journal, adapter);
    if (journalBlockers.length > 0) {
      return blockedResult(current, journalBlockers);
    }
    const finalEvent = journal.events.at(-1);
    if (finalEvent?.type === "outcome" && finalEvent.outcome === "completed") {
      return await reportCompletedTarget(adapter);
    }
  }
  if (current.conflicts.length > 0) {
    return blockedResult(current, current.conflicts);
  }
  const projectedBlockers = await adapter.auditProjectedTarget();
  if (projectedBlockers.length > 0) {
    return blockedResult(current, projectedBlockers);
  }

  if (mode === "preview") {
    return {
      outcome: "preview",
      operations: current.remaining.map(publicSeedOperation),
      evidence: ["Preview only; no filesystem changes were made."],
    };
  }
  if (journal !== undefined && options.resume !== true) {
    const priorOutcome = journal.events.at(-1);
    return progressResult("safely-resumable", current, [
      ...(priorOutcome?.type === "outcome"
        ? [
            `The prior ${priorOutcome.outcome} outcome was rechecked: ${lastFailure(journal)}`,
          ]
        : []),
      "Target preconditions and the approved plan match; pass resume explicitly to continue additively.",
    ]);
  }
  if (
    journal !== undefined &&
    journal.started.preconditions.targetState === "absent" &&
    current.remaining.length === 0
  ) {
    const recovered = await reportCompletedTarget(adapter);
    if (recovered.outcome !== "completed") return recovered;
    await removeValidatedStagingRoot(journal, adapter.stagingPrefix);
    await appendSeedJournalEvent(journal, {
      type: "outcome",
      outcome: "completed",
    });
    return recovered;
  }
  if (journal === undefined && current.remaining.length === 0) {
    return await reportCompletedTarget(adapter);
  }

  const targetMetadata = await optionalLstat(targetRoot);
  const activeJournal =
    journal ??
    (await startSeedJournal({
      path: journalPath,
      target: adapter.target,
      plan: adapter.plan,
      preconditions: {
        contractVersion: adapter.contractVersion,
        targetState: targetMetadata === undefined ? "absent" : "partial",
        completedOperations: current.matching.map(({ path }) => path),
        remainingOperations: current.remaining.map(({ path }) => path),
      },
      stagingRoot: join(
        adapter.parentRoot,
        `${adapter.stagingPrefix}${randomUUID()}`,
      ),
    }));

  await seedCheckpoint(options, "before-staging");
  const stagingFailure = await stageSeedPlan(
    activeJournal,
    adapter.plan.operations,
    adapter.auditRoot,
    options,
  );
  if (stagingFailure !== undefined) {
    return await finalizeFailure(activeJournal, adapter, stagingFailure);
  }
  await seedCheckpoint(options, "before-publication");
  const publicationFailure = await publishSeedPlan(
    activeJournal,
    targetRoot,
    seedTargetLabel(adapter.target),
    adapter.plan.operations,
    options,
  );
  if (publicationFailure !== undefined) {
    return await finalizeFailure(activeJournal, adapter, publicationFailure);
  }
  await seedCheckpoint(options, "after-publication");

  const finalAudit = await adapter.auditTarget();
  if (finalAudit.length > 0) {
    return await finalizeFailure(activeJournal, adapter, {
      outcome: "blocked",
      phase: "verification",
      evidence: finalAudit.join(" "),
    });
  }
  await removeValidatedStagingRoot(activeJournal, adapter.stagingPrefix);
  await appendSeedJournalEvent(activeJournal, {
    type: "outcome",
    outcome: "completed",
  });
  return {
    outcome: "completed",
    operations: [],
    evidence: [
      "Approved additive seed is complete; staging artifacts were removed.",
    ],
  };
}

async function finalizeFailure(
  journal: SeedJournal,
  adapter: MountedSeedAdapter,
  failure: SeedExecutionFailure,
): Promise<MountedSeedResult> {
  await appendSeedJournalEvent(journal, {
    type: "failure",
    phase: failure.phase,
    evidence: failure.evidence,
  });
  await removeValidatedStagingRoot(journal, adapter.stagingPrefix);
  await appendSeedJournalEvent(journal, {
    type: "outcome",
    outcome: failure.outcome,
  });
  const current = await inspectSeedOperationState(
    seedTargetRoot(adapter.target),
    adapter.plan.operations,
  );
  return progressResult(failure.outcome, current, [
    failure.evidence,
    "The safely handled failure removed temporary staging; the private journal was retained.",
  ]);
}

function validateJournal(
  journal: SeedJournal,
  adapter: MountedSeedAdapter,
): string[] {
  if (
    journal.events.some(
      (event) => !adapter.sameTarget(event.target, adapter.target),
    )
  ) {
    return ["Seed journal contains a mismatched target identity."];
  }
  if (!isExpectedStagingRoot(journal.started, adapter.stagingPrefix)) {
    return ["Seed journal contains an unsafe or ambiguous staging identity."];
  }
  if (
    journal.started.preconditions.contractVersion !== adapter.contractVersion
  ) {
    return ["The contract version changed after the interrupted seed."];
  }
  if (journal.started.planDigest !== seedPlanDigest(adapter.plan)) {
    return ["The approved plan changed after the interrupted seed."];
  }
  return [];
}

async function reportCompletedTarget(
  adapter: MountedSeedAdapter,
): Promise<MountedSeedResult> {
  const current = await inspectSeedOperationState(
    seedTargetRoot(adapter.target),
    adapter.plan.operations,
  );
  if (current.conflicts.length > 0 || current.remaining.length > 0) {
    return blockedResult(current, [
      ...current.conflicts,
      ...(current.remaining.length === 0
        ? []
        : ["Completed seed journal disagrees with the current target."]),
    ]);
  }
  const findings = await adapter.auditTarget();
  return findings.length === 0
    ? {
        outcome: "completed",
        operations: [],
        evidence: [adapter.completedEvidence],
      }
    : blockedResult(current, findings);
}

async function reconcileStagingArtifacts(
  adapter: MountedSeedAdapter,
  journal: SeedJournal | undefined,
): Promise<string | undefined> {
  const stages = (await readdir(adapter.parentRoot)).filter((name) =>
    isStagingName(name, adapter.stagingPrefix),
  );
  if (journal === undefined) {
    return stages.length === 0
      ? undefined
      : `Staging artifact has no matching journal: ${stages.sort().join(", ")}.`;
  }
  const expectedStage = basename(journal.started.stagingRoot);
  const unrelated = stages.filter((name) => name !== expectedStage);
  return unrelated.length === 0
    ? undefined
    : `Staging artifacts do not belong to the resumable journal: ${unrelated.sort().join(", ")}.`;
}

async function removeValidatedStagingRoot(
  journal: SeedJournal,
  stagingPrefix: string,
): Promise<void> {
  if (!isExpectedStagingRoot(journal.started, stagingPrefix)) {
    throw new OperationalError(
      "out-of-root",
      "Refused to remove an unsafe seed staging path.",
    );
  }
  await rm(journal.started.stagingRoot, { recursive: true, force: true });
}

function isExpectedStagingRoot(
  started: SeedJournal["started"],
  stagingPrefix: string,
): boolean {
  const expectedParent = resolve(seedTargetParentRoot(started.target));
  const actual = resolve(started.stagingRoot);
  const name = basename(actual);
  return (
    dirname(actual) === expectedParent && isStagingName(name, stagingPrefix)
  );
}

function isStagingName(name: string, stagingPrefix: string): boolean {
  return (
    name.startsWith(stagingPrefix) && isUuid(name.slice(stagingPrefix.length))
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value,
  );
}

function blockedResult(
  current: OperationState,
  evidence: string[],
): MountedSeedResult {
  return progressResult("blocked", current, evidence);
}

function progressResult(
  outcome: "blocked" | "safely-resumable" | "partially-completed",
  current: OperationState,
  evidence: string[],
): MountedSeedResult {
  return {
    outcome,
    operations: current.remaining.map(publicSeedOperation),
    evidence: [...evidence, progressEvidence(current)],
  };
}

function emptyProgress(operations: SeedOperation[]): OperationState {
  return { matching: [], remaining: operations, conflicts: [] };
}

function progressEvidence(current: OperationState): string {
  return `${current.matching.length} operations completed; ${current.remaining.length} operations remaining.`;
}

function lastFailure(journal: SeedJournal): string {
  return (
    journal.events.findLast((event) => event.type === "failure")?.evidence ??
    "The prior seed outcome has no unambiguous failure evidence."
  );
}

function unresolvedPlaceholders(operations: SeedOperation[]): string[] {
  return operations.flatMap(({ path, contents }) =>
    contents !== undefined &&
    /\{\{[^}]+\}\}|<[^>\n]*(?:TODO|PLACEHOLDER|official URL)[^>\n]*>/iu.test(
      contents,
    )
      ? [`Unresolved placeholder in ${path}.`]
      : [],
  );
}
