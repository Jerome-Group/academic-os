import type {
  RepairJournalEvent,
  RepairOperationResult,
} from "./execute-repair.js";
import type {
  CompleteRepairInventory,
  RepairInventoryItem,
  RepairOperation,
  RepairParentReference,
  RepairPlan,
} from "./types.js";
import { retirementName } from "./execute-repair.js";

export async function inspectRepairContinuation(
  plan: RepairPlan,
  events: RepairJournalEvent[],
  inventory: CompleteRepairInventory,
  getItem: (id: string) => Promise<RepairInventoryItem>,
): Promise<{
  blockers: string[];
  recovered: Array<{ operationId: string; result: RepairOperationResult }>;
}> {
  const blockers: string[] = [];
  const recovered: Array<{
    operationId: string;
    result: RepairOperationResult;
  }> = [];
  const current = new Map(inventory.items.map((item) => [item.id, item]));
  const results = completedResults(events);
  const started = new Set(
    events.flatMap((event) =>
      event.type === "operation-started" ? [event.operation.operationId] : [],
    ),
  );
  const recovery = events.find((event) => event.type === "recovery-completed");
  const retirementRootId =
    recovery?.type === "recovery-completed"
      ? recovery.recovery.drive.retirementRootId
      : undefined;

  for (const operation of plan.operations) {
    if (operation.kind === "retire-local-artifact") continue;
    const result = results.get(operation.operationId);
    if (result !== undefined) {
      const evidence = await verifyCompletedOperation(
        plan,
        operation,
        result,
        current,
        getItem,
      );
      if (evidence !== undefined) blockers.push(evidence);
      continue;
    }
    if (!started.has(operation.operationId)) continue;
    const found = await recoverStartedOperation(
      plan,
      operation,
      current,
      results,
      retirementRootId,
      getItem,
    );
    if (typeof found === "string") blockers.push(found);
    else if (found !== undefined) {
      recovered.push({ operationId: operation.operationId, result: found });
      results.set(operation.operationId, found);
    }
  }

  for (const source of plan.inventory.items) {
    const operation = plan.operations.find(
      (candidate) =>
        (candidate.kind === "relocate-item" ||
          candidate.kind === "retire-item") &&
        candidate.sourceId === source.id,
    );
    if (
      operation !== undefined &&
      (results.has(operation.operationId) || started.has(operation.operationId))
    ) {
      continue;
    }
    const item = current.get(source.id);
    if (item === undefined || !samePreconditionState(source, item)) {
      blockers.push(
        `Uncompleted source item ${source.id} changed after approval.`,
      );
    }
  }

  const expectedIds = new Set([
    ...plan.inventory.items.map(({ id }) => id),
    ...[...results.values()].map(({ itemId }) => itemId),
  ]);
  for (const item of current.values()) {
    if (!expectedIds.has(item.id)) {
      blockers.push(`Unexpected item ${item.id} appeared after approval.`);
    }
  }
  return { blockers: [...new Set(blockers)], recovered };
}

export async function verifyRepairProjection(
  plan: RepairPlan,
  events: RepairJournalEvent[],
  inventory: CompleteRepairInventory,
  getItem: (id: string) => Promise<RepairInventoryItem>,
): Promise<string[]> {
  const inspection = await inspectRepairContinuation(
    plan,
    events,
    inventory,
    getItem,
  );
  const completed = completedResults(events);
  const missing = plan.operations
    .filter(({ operationId }) => !completed.has(operationId))
    .map(
      ({ operationId }) =>
        `Repair operation ${operationId} is not journalled complete.`,
    );
  return [...inspection.blockers, ...missing];
}

async function verifyCompletedOperation(
  plan: RepairPlan,
  operation: RepairOperation,
  result: RepairOperationResult,
  current: Map<string, RepairInventoryItem>,
  getItem: (id: string) => Promise<RepairInventoryItem>,
): Promise<string | undefined> {
  const item =
    current.get(result.itemId) ?? (await safeGet(getItem, result.itemId));
  return item !== undefined &&
    completedItemMatches(plan, operation, result, item)
    ? undefined
    : `Completed repair operation ${operation.operationId} no longer matches Drive.`;
}

function completedItemMatches(
  plan: RepairPlan,
  operation: RepairOperation,
  result: RepairOperationResult,
  item: RepairInventoryItem,
): boolean {
  const source =
    operation.kind === "relocate-item" || operation.kind === "retire-item"
      ? plan.inventory.items.find(({ id }) => id === operation.sourceId)
      : undefined;
  const expectedMimeType =
    operation.kind === "create-folder"
      ? "application/vnd.google-apps.folder"
      : operation.kind === "create-file"
        ? operation.mimeType
        : source?.mimeType;
  const expectedChecksum =
    operation.kind === "create-file"
      ? createHash("md5").update(operation.contents).digest("hex")
      : source?.md5Checksum;
  return (
    item.id === result.itemId &&
    (source === undefined || item.id === source.id) &&
    item.name === result.name &&
    item.mimeType === expectedMimeType &&
    item.parentIds.length === 1 &&
    item.parentIds[0] === result.parentId &&
    item.appProperties?.academicOsChangeSet === plan.changeSetId &&
    item.appProperties.academicOsOperation === operation.operationId &&
    (expectedChecksum === undefined || item.md5Checksum === expectedChecksum)
  );
}

async function recoverStartedOperation(
  plan: RepairPlan,
  operation: RepairOperation,
  current: Map<string, RepairInventoryItem>,
  results: Map<string, RepairOperationResult>,
  retirementRootId: string | undefined,
  getItem: (id: string) => Promise<RepairInventoryItem>,
): Promise<RepairOperationResult | string | undefined> {
  if (operation.kind === "retire-local-artifact") return undefined;
  if (operation.kind === "create-folder" || operation.kind === "create-file") {
    const parentId = resolveParent(operation.parent, results);
    const matches = [...current.values()].filter(
      (item) =>
        item.parentIds.includes(parentId) &&
        item.name === operation.name &&
        item.appProperties?.academicOsChangeSet === plan.changeSetId &&
        item.appProperties.academicOsOperation === operation.operationId,
    );
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      return `Started repair operation ${operation.operationId} is ambiguous on Drive.`;
    }
    return operationResult(matches[0] as RepairInventoryItem, parentId);
  }
  const item =
    current.get(operation.sourceId) ??
    (await safeGet(getItem, operation.sourceId));
  if (item === undefined) return undefined;
  const parentId =
    operation.kind === "retire-item"
      ? retirementRootId
      : resolveParent(operation.destination.parent, results);
  if (parentId === undefined) {
    return `Started repair operation ${operation.operationId} lacks its destination ID.`;
  }
  const name =
    operation.kind === "retire-item"
      ? retirementName(
          operation.sourceId,
          plan.inventory.items.find(({ id }) => id === operation.sourceId)
            ?.name ?? "missing-source",
        )
      : operation.destination.name;
  if (
    item.parentIds.length === 1 &&
    item.parentIds[0] === parentId &&
    item.name === name &&
    item.appProperties?.academicOsChangeSet === plan.changeSetId &&
    item.appProperties.academicOsOperation === operation.operationId
  ) {
    return operationResult(item, parentId);
  }
  return undefined;
}

function completedResults(
  events: RepairJournalEvent[],
): Map<string, RepairOperationResult> {
  return new Map(
    events.flatMap((event) =>
      event.type === "operation-completed"
        ? [[event.operationId, event.result] as const]
        : [],
    ),
  );
}

function resolveParent(
  parent: RepairParentReference,
  results: Map<string, RepairOperationResult>,
): string {
  return parent.kind === "existing"
    ? parent.id
    : (results.get(parent.operationId)?.itemId ?? "unresolved-planned-parent");
}

function operationResult(
  item: RepairInventoryItem,
  parentId: string,
): RepairOperationResult {
  return {
    itemId: item.id,
    parentId,
    name: item.name,
    mimeType: item.mimeType,
    ...(item.md5Checksum === undefined
      ? {}
      : { md5Checksum: item.md5Checksum }),
  };
}

function samePreconditionState(
  expected: RepairInventoryItem,
  actual: RepairInventoryItem,
): boolean {
  return (
    expected.name === actual.name &&
    expected.modifiedTime === actual.modifiedTime &&
    expected.version === actual.version &&
    [...expected.parentIds].sort().join("\0") ===
      [...actual.parentIds].sort().join("\0")
  );
}

async function safeGet(
  getItem: (id: string) => Promise<RepairInventoryItem>,
  id: string,
): Promise<RepairInventoryItem | undefined> {
  try {
    return await getItem(id);
  } catch {
    return undefined;
  }
}
import { createHash } from "node:crypto";
