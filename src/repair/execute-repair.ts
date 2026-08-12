import { createHash } from "node:crypto";

import { repairInventoryPaths } from "./repair-inventory-paths.js";
import { RepairPlanError } from "./repair-plan-error.js";
import { repairInventoryDigest, verifyRepairPlan } from "./plan-repair.js";
import type { RepairRecovery } from "./recover-repair.js";
import type {
  CompleteRepairInventory,
  LocalRepairArtifact,
  RepairOperation,
  RepairParentReference,
  RepairPlan,
} from "./types.js";

export type RepairExecutionMode = "preview" | "apply";
export type RepairExecutionOutcome =
  | "preview"
  | "blocked"
  | "safely-resumable"
  | "partially-completed"
  | "completed";

export interface RepairOperationResult {
  itemId: string;
  parentId: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
}

export interface RepairDriveOperationInput {
  operationId: string;
  parentId: string;
  name: string;
  changeSetId: string;
  sourceId?: string;
}

export interface RepairRelocateInput extends RepairDriveOperationInput {
  sourceId: string;
  expectedParentIds: string[];
  expectedModifiedTime: string;
  expectedVersion: string;
}

export interface RepairExecutionDrive {
  inventory(rootId: string): Promise<CompleteRepairInventory>;
  createFolder(
    input: RepairDriveOperationInput,
  ): Promise<RepairOperationResult>;
  createFile(
    input: RepairDriveOperationInput & { mimeType: string; contents: string },
  ): Promise<RepairOperationResult>;
  relocateItem(input: RepairRelocateInput): Promise<RepairOperationResult>;
  verifyContinuation(
    plan: RepairPlan,
    events: RepairJournalEvent[],
    inventory: CompleteRepairInventory,
  ): Promise<{
    blockers: string[];
    recovered: Array<{ operationId: string; result: RepairOperationResult }>;
  }>;
  verifyPostcondition(
    plan: RepairPlan,
    events: RepairJournalEvent[],
  ): Promise<string[]>;
}

export interface RepairExecutionRecovery {
  recover(plan: RepairPlan): Promise<RepairRecovery>;
  verify(recovery: RepairRecovery): Promise<void>;
}

export interface RepairExecutionLocal {
  retireArtifact(
    artifact: LocalRepairArtifact,
    recovery: RepairRecovery,
  ): Promise<RepairOperationResult>;
  verifyRetired(artifact: LocalRepairArtifact): Promise<boolean>;
}

interface RepairJournalBase {
  schemaVersion: 1;
  sequence: number;
  recordedAt: string;
  changeSetId: string;
  planDigest: string;
}

export type RepairJournalEvent =
  | (RepairJournalBase & { type: "started"; plan: RepairPlan })
  | (RepairJournalBase & {
      type: "recovery-completed";
      recovery: RepairRecovery;
    })
  | (RepairJournalBase & {
      type: "operation-started";
      operation: RepairOperation;
    })
  | (RepairJournalBase & {
      type: "operation-completed";
      operationId: string;
      result: RepairOperationResult;
    })
  | (RepairJournalBase & {
      type: "verification-completed";
      evidence: string[];
    })
  | (RepairJournalBase & {
      type: "failure";
      phase: "recovery" | "operation" | "verification";
      evidence: string;
      operationId?: string;
    })
  | (RepairJournalBase & {
      type: "outcome";
      outcome: "blocked" | "partially-completed" | "completed";
    });

export interface RepairExecutionJournalStore {
  read(changeSetId: string): Promise<RepairJournalEvent[]>;
  append(event: RepairJournalEvent): Promise<void>;
}

export interface RepairExecutionReport {
  schemaVersion: 1;
  module: { code: string; semester: string };
  changeSetId: string;
  outcome: RepairExecutionOutcome;
  completedOperations: string[];
  remainingOperations: string[];
  evidence: string[];
}

export interface ExecuteRepairPlanInput {
  plan: RepairPlan;
  mode: RepairExecutionMode;
  resume: boolean;
  drive: RepairExecutionDrive;
  recovery: RepairExecutionRecovery;
  journal: RepairExecutionJournalStore;
  local?: RepairExecutionLocal;
}

export async function executeRepairPlan(
  input: ExecuteRepairPlanInput,
): Promise<RepairExecutionReport> {
  verifyRepairPlan(input.plan);
  if (input.resume && input.mode !== "apply") {
    return report(input.plan, "blocked", new Set(), [
      "Resume requires explicit apply mode.",
    ]);
  }
  const events = await input.journal.read(input.plan.changeSetId);
  validateJournal(events, input.plan);
  const completed = completedOperationIds(events);
  let freshInventory: CompleteRepairInventory;
  try {
    freshInventory = await input.drive.inventory(input.plan.module.rootId);
  } catch (error) {
    return report(input.plan, "blocked", completed, [errorEvidence(error)]);
  }

  if (events.length === 0) {
    if (repairInventoryDigest(freshInventory) !== input.plan.inventoryDigest) {
      return report(input.plan, "blocked", completed, [
        "Fresh complete inventory does not match the approved repair plan.",
      ]);
    }
    if (input.mode === "preview") {
      return report(input.plan, "preview", completed, [
        "Preview only; recovery and mutation were not started.",
      ]);
    }
  } else {
    let continuation: Awaited<
      ReturnType<RepairExecutionDrive["verifyContinuation"]>
    >;
    try {
      continuation = await input.drive.verifyContinuation(
        input.plan,
        events,
        freshInventory,
      );
    } catch (error) {
      return report(input.plan, "blocked", completed, [errorEvidence(error)]);
    }
    if (continuation.blockers.length > 0) {
      return report(input.plan, "blocked", completed, continuation.blockers);
    }
    const recovery = findRecovery(events);
    if (input.local !== undefined) {
      for (const operation of input.plan.operations) {
        if (
          operation.kind !== "retire-local-artifact" ||
          completed.has(operation.operationId) ||
          (!operationWasStarted(events, operation.operationId) &&
            !artifactWasCarriedByCompletedParent(
              input.plan,
              operation.sourceId,
              completed,
              recovery,
            ))
        ) {
          continue;
        }
        const artifact = requiredLocalArtifact(input.plan, operation.sourceId);
        if (await input.local.verifyRetired(artifact)) {
          continuation.recovered.push({
            operationId: operation.operationId,
            result: localRetirementResult(
              artifact,
              recovery?.bytes.path ?? "recovery-unavailable",
            ),
          });
        }
      }
    }
    const inspectedLocalCompletions = new Set([
      ...completed,
      ...continuation.recovered.map(({ operationId }) => operationId),
    ]);
    const localBlockers = inspectLocalArtifactState(
      input.plan,
      inspectedLocalCompletions,
      freshInventory.localArtifacts,
    );
    if (localBlockers.length > 0) {
      return report(input.plan, "blocked", completed, localBlockers);
    }
    const lastEvent = events.at(-1);
    if (lastEvent?.type === "outcome" && lastEvent.outcome === "completed") {
      if (recovery === undefined) {
        return report(input.plan, "blocked", completed, [
          "Completed repair journal has no verified recovery manifest.",
        ]);
      }
      try {
        await input.recovery.verify(recovery);
        await verifyLocalRetirements(input);
        const verification = await input.drive.verifyPostcondition(
          input.plan,
          events,
        );
        if (verification.length > 0) {
          return report(input.plan, "blocked", completed, verification);
        }
      } catch (error) {
        return report(input.plan, "blocked", completed, [errorEvidence(error)]);
      }
      return report(input.plan, "completed", completed, [
        "Completed repair remains verified; no writes were performed.",
      ]);
    }
    const inspectedCompleted = new Set(completed);
    for (const recovered of continuation.recovered) {
      inspectedCompleted.add(recovered.operationId);
    }
    if (!input.resume) {
      return report(input.plan, "safely-resumable", inspectedCompleted, [
        recovery === undefined
          ? "Journal and current target match; recovery is incomplete, so pass apply and resume explicitly."
          : "Journal, recovery and current target match; pass apply and resume explicitly.",
      ]);
    }
    for (const recovered of continuation.recovered) {
      if (!completed.has(recovered.operationId)) {
        await append(input, events, {
          type: "operation-completed",
          operationId: recovered.operationId,
          result: recovered.result,
        });
        completed.add(recovered.operationId);
      }
    }
    if (recovery === undefined) {
      try {
        const resumedRecovery = await input.recovery.recover(input.plan);
        await input.recovery.verify(resumedRecovery);
        await append(input, events, {
          type: "recovery-completed",
          recovery: resumedRecovery,
        });
      } catch (error) {
        return await fail(input, events, "recovery", error);
      }
    } else {
      try {
        await input.recovery.verify(recovery);
      } catch (error) {
        return await fail(input, events, "recovery", error);
      }
    }
  }

  if (events.length === 0) {
    await append(input, events, { type: "started", plan: input.plan });
    try {
      const recovery = await input.recovery.recover(input.plan);
      await input.recovery.verify(recovery);
      await append(input, events, { type: "recovery-completed", recovery });
    } catch (error) {
      return await fail(input, events, "recovery", error);
    }
  }

  const recovery = requiredRecovery(events);
  if (!events.some(({ type }) => type === "operation-started")) {
    try {
      const afterRecovery = await input.drive.inventory(
        input.plan.module.rootId,
      );
      if (repairInventoryDigest(afterRecovery) !== input.plan.inventoryDigest) {
        return await fail(
          input,
          events,
          "verification",
          new RepairPlanError(
            "Target changed during recovery; no live operation was started.",
          ),
        );
      }
    } catch (error) {
      return await fail(input, events, "verification", error);
    }
  }
  for (const operation of input.plan.operations) {
    if (completed.has(operation.operationId)) continue;
    await append(input, events, { type: "operation-started", operation });
    try {
      const result = await executeOperation(
        input.plan,
        operation,
        events,
        recovery,
        input.drive,
        input.local,
      );
      await append(input, events, {
        type: "operation-completed",
        operationId: operation.operationId,
        result,
      });
      completed.add(operation.operationId);
    } catch (error) {
      return await fail(
        input,
        events,
        "operation",
        error,
        operation.operationId,
      );
    }
  }

  try {
    await input.recovery.verify(recovery);
  } catch (error) {
    return await fail(input, events, "recovery", error);
  }
  try {
    await verifyLocalRetirements(input);
    const finalInventory = await input.drive.inventory(
      input.plan.module.rootId,
    );
    const localBlockers = inspectLocalArtifactState(
      input.plan,
      completedOperationIds(events),
      finalInventory.localArtifacts,
    );
    if (localBlockers.length > 0) {
      throw new RepairPlanError(localBlockers.join(" "));
    }
  } catch (error) {
    return await fail(input, events, "verification", error);
  }
  let verification: string[];
  try {
    verification = await input.drive.verifyPostcondition(input.plan, events);
  } catch (error) {
    return await fail(input, events, "verification", error);
  }
  if (verification.length > 0) {
    return await fail(
      input,
      events,
      "verification",
      new RepairPlanError(verification.join(" ")),
    );
  }
  await append(input, events, {
    type: "verification-completed",
    evidence: ["Fresh inventory, journal, recovery and conformance verified."],
  });
  await append(input, events, { type: "outcome", outcome: "completed" });
  return report(input.plan, "completed", completed, [
    "Approved repair completed and postconditions passed.",
  ]);
}

function inspectLocalArtifactState(
  plan: RepairPlan,
  completed: Set<string>,
  current: LocalRepairArtifact[],
): string[] {
  const expected = new Map(
    plan.inventory.localArtifacts.map((artifact) => [
      `local:${artifact.device}:${artifact.inode}`,
      artifact,
    ]),
  );
  const retiredIds = new Set(
    plan.operations.flatMap((operation) =>
      operation.kind === "retire-local-artifact" &&
      completed.has(operation.operationId)
        ? [operation.sourceId]
        : [],
    ),
  );
  const currentById = new Map(
    current.map((artifact) => [
      `local:${artifact.device}:${artifact.inode}`,
      artifact,
    ]),
  );
  const blockers: string[] = [];
  for (const [id, artifact] of currentById) {
    const approved = expected.get(id);
    if (approved === undefined) {
      if (!isGeneratedFinderIcon(plan, completed, artifact)) {
        blockers.push(
          `Unapproved local-only artifact appeared: ${artifact.relativePath}.`,
        );
      }
    } else if (JSON.stringify(approved) !== JSON.stringify(artifact)) {
      blockers.push(`Local-only artifact changed: ${artifact.relativePath}.`);
    } else if (retiredIds.has(id)) {
      blockers.push(
        `Retired local-only artifact reappeared: ${artifact.relativePath}.`,
      );
    }
  }
  for (const [id, artifact] of expected) {
    if (!retiredIds.has(id) && !currentById.has(id)) {
      blockers.push(
        `Approved local-only artifact disappeared: ${artifact.relativePath}.`,
      );
    }
  }
  return blockers;
}

function operationWasStarted(
  events: RepairJournalEvent[],
  operationId: string,
): boolean {
  return events.some(
    (event) =>
      event.type === "operation-started" &&
      event.operation.operationId === operationId,
  );
}

function artifactWasCarriedByCompletedParent(
  plan: RepairPlan,
  sourceId: string,
  completed: Set<string>,
  recovery: RepairRecovery | undefined,
): boolean {
  const artifact = plan.inventory.localArtifacts.find(
    (candidate) => `local:${candidate.device}:${candidate.inode}` === sourceId,
  );
  if (
    artifact === undefined ||
    recovery === undefined ||
    !recovery.bytes.localArtifacts.some(
      (recovered) =>
        recovered.device === artifact.device &&
        recovered.inode === artifact.inode,
    )
  ) {
    return false;
  }
  const inventoryPaths = repairInventoryPaths(plan.inventory);
  return plan.operations.some((operation) => {
    if (
      operation.kind !== "retire-item" ||
      !completed.has(operation.operationId)
    ) {
      return false;
    }
    const item = plan.inventory.items.find(
      (candidate) => candidate.id === operation.sourceId,
    );
    const parentPath = inventoryPaths.get(operation.sourceId);
    return (
      item?.mimeType === "application/vnd.google-apps.folder" &&
      parentPath !== undefined &&
      artifact.relativePath.startsWith(`${parentPath}/`)
    );
  });
}

function isGeneratedFinderIcon(
  plan: RepairPlan,
  completed: Set<string>,
  artifact: LocalRepairArtifact,
): boolean {
  if (
    artifact.size !== "0" ||
    artifact.sha256 !==
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
    !artifact.relativePath.endsWith("/Icon\r")
  ) {
    return false;
  }
  const expectedPath = artifact.relativePath.slice(0, -"/Icon\r".length);
  return plannedFolderPaths(plan, completed).has(expectedPath);
}

function plannedFolderPaths(
  plan: RepairPlan,
  completed: Set<string>,
): Set<string> {
  const inventoryPaths = repairInventoryPaths(plan.inventory);
  const paths = new Map<string, string>();
  const resolveParent = (parent: RepairParentReference): string | undefined =>
    parent.kind === "existing"
      ? inventoryPaths.get(parent.id)
      : paths.get(parent.operationId);
  for (const operation of plan.operations) {
    if (
      operation.kind !== "create-folder" ||
      !completed.has(operation.operationId)
    ) {
      continue;
    }
    const parentPath = resolveParent(operation.parent);
    if (parentPath === undefined) continue;
    paths.set(
      operation.operationId,
      parentPath === "" ? operation.name : `${parentPath}/${operation.name}`,
    );
  }
  return new Set(paths.values());
}

async function executeOperation(
  plan: RepairPlan,
  operation: RepairOperation,
  events: RepairJournalEvent[],
  recovery: RepairRecovery,
  drive: RepairExecutionDrive,
  local: RepairExecutionLocal | undefined,
): Promise<RepairOperationResult> {
  if (operation.kind === "retire-local-artifact") {
    if (local === undefined) {
      throw new RepairPlanError("Local artifact retirement is unavailable.");
    }
    return await local.retireArtifact(
      requiredLocalArtifact(plan, operation.sourceId),
      recovery,
    );
  }
  if (operation.kind === "create-folder") {
    return await drive.createFolder({
      operationId: operation.operationId,
      parentId: resolveParent(operation.parent, events),
      name: operation.name,
      changeSetId: plan.changeSetId,
    });
  }
  if (operation.kind === "create-file") {
    return await drive.createFile({
      operationId: operation.operationId,
      parentId: resolveParent(operation.parent, events),
      name: operation.name,
      mimeType: operation.mimeType,
      contents: operation.contents,
      changeSetId: plan.changeSetId,
    });
  }
  const source = plan.inventory.items.find(
    ({ id }) => id === operation.sourceId,
  );
  if (source === undefined) {
    throw new RepairPlanError(
      `Repair source ID is unavailable: ${operation.sourceId}.`,
    );
  }
  return await drive.relocateItem({
    operationId: operation.operationId,
    sourceId: operation.sourceId,
    parentId:
      operation.kind === "retire-item"
        ? recovery.drive.retirementRootId
        : resolveParent(operation.destination.parent, events),
    name:
      operation.kind === "retire-item"
        ? retirementName(source.id, source.name)
        : operation.destination.name,
    changeSetId: plan.changeSetId,
    expectedParentIds: source.parentIds,
    expectedModifiedTime: source.modifiedTime,
    expectedVersion: source.version,
  });
}

function requiredLocalArtifact(
  plan: RepairPlan,
  sourceId: string,
): LocalRepairArtifact {
  const artifact = plan.inventory.localArtifacts.find(
    (candidate) => `local:${candidate.device}:${candidate.inode}` === sourceId,
  );
  if (artifact === undefined) {
    throw new RepairPlanError(
      `Local repair artifact is unavailable: ${sourceId}.`,
    );
  }
  return artifact;
}

function localRetirementResult(
  artifact: LocalRepairArtifact,
  recoveryPath: string,
): RepairOperationResult {
  return {
    itemId: `local:${artifact.device}:${artifact.inode}`,
    parentId: recoveryPath,
    name: artifact.relativePath,
    mimeType: "application/vnd.academic-os.retired-local-artifact",
  };
}

async function verifyLocalRetirements(
  input: ExecuteRepairPlanInput,
): Promise<void> {
  for (const operation of input.plan.operations) {
    if (operation.kind !== "retire-local-artifact") continue;
    const artifact = requiredLocalArtifact(input.plan, operation.sourceId);
    if (
      input.local === undefined ||
      !(await input.local.verifyRetired(artifact))
    ) {
      throw new RepairPlanError(
        `Local artifact retirement did not verify: ${artifact.relativePath}.`,
      );
    }
  }
}

export function retirementName(sourceId: string, name: string): string {
  return `${createHash("sha256").update(sourceId).digest("hex").slice(0, 16)}--${name}`;
}

function resolveParent(
  parent: RepairParentReference,
  events: RepairJournalEvent[],
): string {
  if (parent.kind === "existing") return parent.id;
  const completed = events.find(
    (event) =>
      event.type === "operation-completed" &&
      event.operationId === parent.operationId,
  );
  if (completed?.type !== "operation-completed") {
    throw new RepairPlanError(
      `Planned repair parent is not complete: ${parent.operationId}.`,
    );
  }
  return completed.result.itemId;
}

async function fail(
  input: ExecuteRepairPlanInput,
  events: RepairJournalEvent[],
  phase: "recovery" | "operation" | "verification",
  error: unknown,
  operationId?: string,
): Promise<RepairExecutionReport> {
  const evidence = errorEvidence(error);
  await append(input, events, {
    type: "failure",
    phase,
    evidence,
    ...(operationId === undefined ? {} : { operationId }),
  });
  const completed = completedOperationIds(events);
  const outcome = completed.size === 0 ? "blocked" : "partially-completed";
  await append(input, events, { type: "outcome", outcome });
  return report(input.plan, outcome, completed, [evidence]);
}

function errorEvidence(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown repair failure.";
}

type AppendRepairEvent = RepairJournalEvent extends infer Event
  ? Event extends RepairJournalBase
    ? Omit<Event, keyof RepairJournalBase>
    : never
  : never;

async function append(
  input: ExecuteRepairPlanInput,
  events: RepairJournalEvent[],
  event: AppendRepairEvent,
): Promise<void> {
  const complete = {
    schemaVersion: 1,
    sequence: events.length,
    recordedAt: new Date().toISOString(),
    changeSetId: input.plan.changeSetId,
    planDigest: input.plan.planDigest,
    ...event,
  } as RepairJournalEvent;
  await input.journal.append(complete);
  events.push(complete);
}

function completedOperationIds(events: RepairJournalEvent[]): Set<string> {
  return new Set(
    events.flatMap((event) =>
      event.type === "operation-completed" ? [event.operationId] : [],
    ),
  );
}

function requiredRecovery(events: RepairJournalEvent[]): RepairRecovery {
  const recovery = findRecovery(events);
  if (recovery === undefined) {
    throw new RepairPlanError(
      "Repair journal has no verified recovery manifest.",
    );
  }
  return recovery;
}

function findRecovery(
  events: RepairJournalEvent[],
): RepairRecovery | undefined {
  const event = events.find(({ type }) => type === "recovery-completed");
  return event?.type === "recovery-completed" ? event.recovery : undefined;
}

function validateJournal(events: RepairJournalEvent[], plan: RepairPlan): void {
  if (
    events.some(
      (event, index) =>
        event.sequence !== index ||
        event.changeSetId !== plan.changeSetId ||
        event.planDigest !== plan.planDigest,
    )
  ) {
    throw new RepairPlanError(
      "Repair journal identity or sequence is ambiguous.",
    );
  }
  if (events.length > 0 && events[0]?.type !== "started") {
    throw new RepairPlanError("Repair journal start is ambiguous.");
  }
  const completedOutcome = events.find(
    (event) => event.type === "outcome" && event.outcome === "completed",
  );
  if (completedOutcome !== undefined && events.at(-1) !== completedOutcome) {
    throw new RepairPlanError("Repair journal lifecycle is ambiguous.");
  }
}

function report(
  plan: RepairPlan,
  outcome: RepairExecutionOutcome,
  completed: Set<string>,
  evidence: string[],
): RepairExecutionReport {
  return {
    schemaVersion: 1,
    module: { code: plan.module.code, semester: plan.module.semester },
    changeSetId: plan.changeSetId,
    outcome,
    completedOperations: plan.operations
      .filter(({ operationId }) => completed.has(operationId))
      .map(({ operationId }) => operationId),
    remainingOperations: plan.operations
      .filter(({ operationId }) => !completed.has(operationId))
      .map(({ operationId }) => operationId),
    evidence,
  };
}
