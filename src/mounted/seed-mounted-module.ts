import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { SeedMode, SeedPlan, SeedReport } from "../seed/index.js";
import {
  publishSeedPlan,
  seedCheckpoint,
  type SeedExecutionFailure,
  stageSeedPlan,
} from "./execute-seed-operations.js";
import { ensureMaterialized } from "./ensure-materialized.js";
import { OperationalError } from "./operational-error.js";
import { resolveConfiguredRoots } from "./resolve-configured-roots.js";
import {
  appendSeedJournalEvent,
  readSeedJournal,
  seedJournalPath,
  seedPlanDigest,
  startSeedJournal,
  type SeedJournal,
  type SeedTargetIdentity,
} from "./seed-operation-journal.js";
import {
  auditProjectedSeedTarget,
  auditSeedTarget,
  inspectSeedOperationState,
  inspectSeedTarget,
  type OperationState,
  publicSeedOperation,
  seedContractVersion,
  seedTargetIdentity,
} from "./seed-target-state.js";
import type { LocalConfig, SeedExecutionOptions } from "./types.js";

export async function seedMountedModule(
  config: LocalConfig,
  plan: SeedPlan,
  mode: SeedMode,
  options: SeedExecutionOptions = {},
): Promise<SeedReport> {
  const roots = await resolveConfiguredRoots(config);
  try {
    await ensureMaterialized(roots.semesterRoot);
  } catch (error) {
    if (
      error instanceof OperationalError &&
      error.code === "unresolved-placeholder"
    ) {
      return blockedReport(plan, emptyProgress(plan), [error.message]);
    }
    throw error;
  }
  const planningBlockers = [...plan.blockers, ...unresolvedPlaceholders(plan)];
  if (planningBlockers.length > 0) {
    return blockedReport(plan, emptyProgress(plan), planningBlockers);
  }

  const target = seedTargetIdentity(roots.semesterRoot, plan);
  const targetBlockers = await inspectSeedTarget(target, plan);
  if (targetBlockers.length > 0) {
    return blockedReport(plan, emptyProgress(plan), targetBlockers);
  }
  const current = await inspectSeedOperationState(
    target.moduleRoot,
    plan.operations,
  );

  const path = seedJournalPath(roots.stateRoot, target);
  const journalRead = await readSeedJournal(path);
  if (journalRead.diagnostic !== undefined) {
    return blockedReport(plan, current, [journalRead.diagnostic]);
  }
  const stageBlocker = await reconcileStagingArtifacts(
    roots.semesterRoot,
    plan,
    journalRead.journal,
  );
  if (stageBlocker !== undefined) {
    return {
      ...report(plan, "abandoned-staging", [
        stageBlocker,
        progressEvidence(current),
      ]),
      operations: current.remaining.map(publicSeedOperation),
    };
  }

  const journal = journalRead.journal;
  if (journal !== undefined) {
    const journalBlockers = validateJournal(journal, target, plan);
    if (journalBlockers.length > 0) {
      return blockedReport(plan, current, journalBlockers);
    }
    const finalEvent = journal.events.at(-1);
    if (finalEvent?.type === "outcome") {
      if (finalEvent.outcome === "completed") {
        return await reportCompletedTarget(target, plan);
      }
    }
  }
  if (current.conflicts.length > 0) {
    return blockedReport(plan, current, current.conflicts);
  }
  const projectedBlockers = await auditProjectedSeedTarget(target, plan);
  if (projectedBlockers.length > 0) {
    return blockedReport(plan, current, projectedBlockers);
  }

  if (mode === "preview") {
    return {
      ...report(plan, "preview", [
        "Preview only; no filesystem changes were made.",
      ]),
      operations: current.remaining.map(publicSeedOperation),
    };
  }
  if (journal !== undefined && options.resume !== true) {
    const priorOutcome = journal.events.at(-1);
    return progressReport(plan, "safely-resumable", current, [
      ...(priorOutcome?.type === "outcome"
        ? [
            `The prior ${priorOutcome.outcome} outcome was rechecked: ${lastFailure(journal)}`,
          ]
        : []),
      "Target preconditions and the approved plan match; pass resume explicitly to continue additively.",
    ]);
  }
  if (journal === undefined && current.remaining.length === 0) {
    return await reportCompletedTarget(target, plan);
  }

  const activeJournal =
    journal ??
    (await startSeedJournal({
      path,
      target,
      plan,
      preconditions: {
        contractVersion: seedContractVersion(plan),
        targetState: current.matching.length === 0 ? "absent" : "partial",
        completedOperations: current.matching.map(({ path }) => path),
        remainingOperations: current.remaining.map(({ path }) => path),
      },
      stagingRoot: join(
        roots.semesterRoot,
        `.academic-os-stage-${plan.module}-${randomUUID()}`,
      ),
    }));

  await seedCheckpoint(options, "before-staging");
  const stagingFailure = await stageSeedPlan(activeJournal, plan, options);
  if (stagingFailure !== undefined) {
    return await finalizeFailure(activeJournal, plan, stagingFailure);
  }
  await seedCheckpoint(options, "before-publication");
  const publicationFailure = await publishSeedPlan(
    activeJournal,
    target,
    plan,
    options,
  );
  if (publicationFailure !== undefined) {
    return await finalizeFailure(activeJournal, plan, publicationFailure);
  }
  await seedCheckpoint(options, "after-publication");

  const finalAudit = await auditSeedTarget(target, plan);
  if (finalAudit.length > 0) {
    return await finalizeFailure(activeJournal, plan, {
      outcome: "blocked",
      phase: "verification",
      evidence: finalAudit.join(" "),
    });
  }
  await removeValidatedStagingRoot(activeJournal);
  await appendSeedJournalEvent(activeJournal, {
    type: "outcome",
    outcome: "completed",
  });
  return report(plan, "completed", [
    "Approved additive seed is complete; staging artifacts were removed.",
  ]);
}

async function finalizeFailure(
  journal: SeedJournal,
  plan: SeedPlan,
  failure: SeedExecutionFailure,
): Promise<SeedReport> {
  await appendSeedJournalEvent(journal, {
    type: "failure",
    phase: failure.phase,
    evidence: failure.evidence,
  });
  await removeValidatedStagingRoot(journal);
  await appendSeedJournalEvent(journal, {
    type: "outcome",
    outcome: failure.outcome,
  });
  const current = await inspectSeedOperationState(
    journal.started.target.moduleRoot,
    plan.operations,
  );
  return progressReport(plan, failure.outcome, current, [
    failure.evidence,
    "The safely handled failure removed temporary staging; the private journal was retained.",
  ]);
}

function validateJournal(
  journal: SeedJournal,
  target: SeedTargetIdentity,
  plan: SeedPlan,
): string[] {
  if (
    journal.events.some(
      (event) =>
        event.target.module !== target.module ||
        event.target.semester !== target.semester ||
        event.target.semesterRoot !== target.semesterRoot ||
        event.target.moduleRoot !== target.moduleRoot,
    )
  ) {
    return ["Seed journal contains a mismatched target identity."];
  }
  if (!isExpectedStagingRoot(journal.started)) {
    return ["Seed journal contains an unsafe or ambiguous staging identity."];
  }
  if (
    journal.started.preconditions.contractVersion !== seedContractVersion(plan)
  ) {
    return ["The contract version changed after the interrupted seed."];
  }
  if (journal.started.planDigest !== seedPlanDigest(plan)) {
    return ["The approved plan changed after the interrupted seed."];
  }
  return [];
}

async function reportCompletedTarget(
  target: SeedTargetIdentity,
  plan: SeedPlan,
): Promise<SeedReport> {
  const current = await inspectSeedOperationState(
    target.moduleRoot,
    plan.operations,
  );
  if (current.conflicts.length > 0 || current.remaining.length > 0) {
    return blockedReport(plan, current, [
      ...current.conflicts,
      ...(current.remaining.length === 0
        ? []
        : ["Completed seed journal disagrees with the current target."]),
    ]);
  }
  const findings = await auditSeedTarget(target, plan);
  return findings.length === 0
    ? report(plan, "completed", [
        "Existing module matches the approved plan; no changes proposed and repeated resume is a no-op.",
      ])
    : blockedReport(plan, current, findings);
}

async function reconcileStagingArtifacts(
  semesterRoot: string,
  plan: SeedPlan,
  journal: SeedJournal | undefined,
): Promise<string | undefined> {
  const stages = (await readdir(semesterRoot)).filter((name) =>
    name.startsWith(`.academic-os-stage-${plan.module}-`),
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

async function removeValidatedStagingRoot(journal: SeedJournal): Promise<void> {
  if (!isExpectedStagingRoot(journal.started)) {
    throw new OperationalError(
      "out-of-root",
      "Refused to remove an unsafe seed staging path.",
    );
  }
  await rm(journal.started.stagingRoot, { recursive: true, force: true });
}

function isExpectedStagingRoot(started: SeedJournal["started"]): boolean {
  const expectedParent = resolve(started.target.semesterRoot);
  const actual = resolve(started.stagingRoot);
  return (
    dirname(actual) === expectedParent &&
    new RegExp(
      `^\\.academic-os-stage-${started.target.module}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
      "u",
    ).test(basename(actual))
  );
}

function blockedReport(
  plan: SeedPlan,
  current: OperationState,
  evidence: string[],
): SeedReport {
  return progressReport(plan, "blocked", current, evidence);
}

function progressReport(
  plan: SeedPlan,
  outcome: "blocked" | "safely-resumable" | "partially-completed",
  current: OperationState,
  evidence: string[],
): SeedReport {
  return {
    ...report(plan, outcome, [...evidence, progressEvidence(current)]),
    operations: current.remaining.map(publicSeedOperation),
  };
}

function emptyProgress(plan: SeedPlan): OperationState {
  return { matching: [], remaining: plan.operations, conflicts: [] };
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

function unresolvedPlaceholders(plan: SeedPlan): string[] {
  return plan.operations.flatMap(({ path, contents }) =>
    contents !== undefined &&
    /\{\{[^}]+\}\}|<[^>\n]*(?:TODO|PLACEHOLDER|official URL)[^>\n]*>/iu.test(
      contents,
    )
      ? [`Unresolved placeholder in ${path}.`]
      : [],
  );
}

function report(
  plan: SeedPlan,
  outcome: SeedReport["outcome"],
  evidence: string[],
): SeedReport {
  return {
    schemaVersion: 1,
    module: { code: plan.module, semester: plan.semester },
    outcome,
    operations: [],
    evidence,
  };
}
