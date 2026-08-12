import { createHash } from "node:crypto";

import { supportedContractVersion } from "../conformance/index.js";

import type {
  CompleteRepairInventory,
  RepairDecision,
  RepairCurationEvent,
  RepairDestination,
  RepairOperation,
  RepairParentReference,
  RepairPlan,
  RepairPlanDraft,
} from "./types.js";

const folderMimeType = "application/vnd.google-apps.folder";

export class RepairPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairPlanError";
  }
}

export function createRepairPlan(draft: RepairPlanDraft): RepairPlan {
  validateDraft(draft);
  const inventoryDigest = repairInventoryDigest(draft.inventory);
  const decisionDigest = repairDecisionDigest(draft.decisions);
  if (draft.approval.decisionDigest !== decisionDigest) {
    throw new RepairPlanError(
      "Repair approval does not match the current decisions.",
    );
  }
  if (draft.approval.approvedPlanDigest !== repairApprovalDigest(draft)) {
    throw new RepairPlanError(
      "Repair approval does not match the complete ordered plan payload.",
    );
  }
  const curationEvents = createCurationEvents(draft);
  const operations: RepairOperation[] = [
    ...draft.operations,
    {
      operationId: "record-curation-decisions",
      kind: "create-file",
      parent: draft.curationRegisterParent,
      name: "20 Curation Register.jsonl",
      mimeType: "application/jsonl",
      contents: `${curationEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    },
  ];
  validateOperations(
    operations,
    new Map(draft.inventory.items.map((item) => [item.id, item])),
    draft.inventory.localArtifacts,
  );
  const withoutPlanDigest = {
    ...draft,
    operations,
    curationEvents,
    inventoryDigest,
    decisionDigest,
  };
  return {
    ...withoutPlanDigest,
    planDigest: digest(withoutPlanDigest),
  };
}

export function repairInventoryDigest(
  inventory: CompleteRepairInventory,
): string {
  return digest({
    complete: inventory.complete,
    rootId: inventory.rootId,
    items: [...inventory.items]
      .sort(({ id: left }, { id: right }) => left.localeCompare(right))
      .map((item) => ({
        ...item,
        parentIds: [...item.parentIds].sort(),
      })),
    localArtifacts: [...inventory.localArtifacts].sort((left, right) =>
      `${left.device}:${left.inode}`.localeCompare(
        `${right.device}:${right.inode}`,
      ),
    ),
  });
}

export function repairDecisionDigest(decisions: RepairDecision[]): string {
  return digest(decisions);
}

export function repairApprovalDigest(
  draft: Omit<RepairPlanDraft, "approval"> | RepairPlanDraft,
): string {
  const { approval: _approval, ...payload } = draft as RepairPlanDraft;
  return digest(payload);
}

export function verifyRepairPlan(plan: RepairPlan): void {
  const {
    inventoryDigest: _inventoryDigest,
    decisionDigest: _decisionDigest,
    planDigest: _planDigest,
    curationEvents: _curationEvents,
    ...approvedPlan
  } = plan;
  const draft: RepairPlanDraft = {
    ...approvedPlan,
    operations: approvedPlan.operations.filter(
      ({ operationId }) => operationId !== "record-curation-decisions",
    ),
  };
  const recreated = createRepairPlan(draft);
  if (recreated.planDigest !== plan.planDigest) {
    throw new RepairPlanError(
      "Repair plan digest does not match its contents.",
    );
  }
}

function createCurationEvents(draft: RepairPlanDraft): RepairCurationEvent[] {
  const paths = inventoryRelativePaths(draft.inventory);
  return draft.decisions
    .filter(({ decision }) => decision !== "retained")
    .map((decision) => {
      const source = draft.inventory.items.find(
        ({ id }) => id === decision.sourceId,
      );
      const local = draft.inventory.localArtifacts.find(
        (artifact) => localArtifactId(artifact) === decision.sourceId,
      );
      if (source === undefined && local === undefined) {
        throw new RepairPlanError(
          `Curation source is unavailable: ${decision.sourceId}.`,
        );
      }
      return {
        schema_version: 1,
        source_id: decision.sourceId,
        integration: "historical-migration",
        role: "historical-source",
        source_path:
          local?.relativePath ?? requiredRelativePath(paths, decision.sourceId),
        ...(local !== undefined
          ? { checksum: `sha256:${local.sha256}` }
          : source?.md5Checksum === undefined
            ? {}
            : { checksum: `md5:${source.md5Checksum}` }),
        decision: decision.decision === "curated" ? "curated" : "source-only",
        ...(decision.destination === undefined
          ? {}
          : {
              destination: destinationPath(draft, decision.destination, paths),
            }),
        evidence: decision.evidence.join(" "),
        timestamp: draft.approval.approvedAt,
        ...(decision.supersedes === undefined
          ? {}
          : { supersedes: decision.supersedes }),
      };
    });
}

function inventoryRelativePaths(
  inventory: CompleteRepairInventory,
): Map<string, string> {
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  const paths = new Map<string, string>([[inventory.rootId, ""]]);
  const visiting = new Set<string>();
  const resolve = (id: string): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const item = items.get(id);
    if (item === undefined || visiting.has(id)) {
      throw new RepairPlanError("Repair inventory is disconnected or cyclic.");
    }
    visiting.add(id);
    const parents = item.parentIds.filter((parentId) => items.has(parentId));
    if (parents.length !== 1) {
      throw new RepairPlanError(
        "Inventory item lacks one unambiguous in-tree parent.",
      );
    }
    const parent = parents[0] as string;
    const parentPath = resolve(parent);
    const path = parentPath === "" ? item.name : `${parentPath}/${item.name}`;
    visiting.delete(id);
    paths.set(id, path);
    return path;
  };
  for (const item of items.values()) resolve(item.id);
  return paths;
}

function destinationPath(
  draft: RepairPlanDraft,
  destination: RepairDestination,
  inventoryPaths: Map<string, string>,
): string {
  const plannedPaths = new Map<string, string>();
  const resolveParentPath = (parent: RepairParentReference): string => {
    if (parent.kind === "existing")
      return availableRelativePath(inventoryPaths, parent.id);
    const cached = plannedPaths.get(parent.operationId);
    if (cached !== undefined) return cached;
    const operation = draft.operations.find(
      ({ operationId }) => operationId === parent.operationId,
    );
    if (operation?.kind !== "create-folder") {
      throw new RepairPlanError(
        "Curation destination parent is not a planned folder.",
      );
    }
    const parentPath = resolveParentPath(operation.parent);
    const path =
      parentPath === "" ? operation.name : `${parentPath}/${operation.name}`;
    plannedPaths.set(operation.operationId, path);
    return path;
  };
  const parentPath = resolveParentPath(destination.parent);
  return parentPath === ""
    ? destination.name
    : `${parentPath}/${destination.name}`;
}

function requiredRelativePath(paths: Map<string, string>, id: string): string {
  const path = availableRelativePath(paths, id);
  if (path === undefined || path === "") {
    throw new RepairPlanError(`Module-relative path is unavailable for ${id}.`);
  }
  return path;
}

function availableRelativePath(paths: Map<string, string>, id: string): string {
  const path = paths.get(id);
  if (path === undefined) {
    throw new RepairPlanError(`Module-relative path is unavailable for ${id}.`);
  }
  return path;
}

function validateDraft(draft: RepairPlanDraft): void {
  if (draft.schemaVersion !== 1) {
    throw new RepairPlanError("Unsupported repair plan schema version.");
  }
  if (draft.contractVersion !== supportedContractVersion) {
    throw new RepairPlanError(
      `Repair contract version must be ${supportedContractVersion}.`,
    );
  }
  if (!isUuid(draft.changeSetId)) {
    throw new RepairPlanError("Repair change-set ID must be a UUID.");
  }
  if (!/^[A-Z]{2,4}\d{4}$/u.test(draft.module.code)) {
    throw new RepairPlanError("Repair module code is invalid.");
  }
  if (draft.module.rootId !== draft.inventory.rootId) {
    throw new RepairPlanError(
      "Repair inventory root does not match the module.",
    );
  }
  validateTimestamp(draft.inventory.observedAt, "inventory observation");
  validateTimestamp(draft.approval.approvedAt, "approval");
  if (draft.approval.approvedBy.trim() === "") {
    throw new RepairPlanError("Repair approval must name its approver.");
  }
  const items = validateInventory(draft.inventory);
  inventoryRelativePaths(draft.inventory);
  validateOperations(draft.operations, items, draft.inventory.localArtifacts);
  validateDecisions(
    draft.decisions,
    draft.operations,
    items,
    draft.inventory.localArtifacts,
  );
}

function validateInventory(
  inventory: CompleteRepairInventory,
): Map<string, CompleteRepairInventory["items"][number]> {
  if (inventory.complete !== true) {
    throw new RepairPlanError("Repair inventory must be explicitly complete.");
  }
  const items = new Map<string, CompleteRepairInventory["items"][number]>();
  for (const item of inventory.items) {
    if (item.id.trim() === "" || items.has(item.id)) {
      throw new RepairPlanError(
        "Repair inventory contains a missing or duplicate ID.",
      );
    }
    if (
      !isSafeItemName(item.name) ||
      item.mimeType.trim() === "" ||
      item.parentIds.length === 0 ||
      item.version.trim() === ""
    ) {
      throw new RepairPlanError(
        `Repair inventory item ${item.id} lacks stable metadata.`,
      );
    }
    validateTimestamp(item.modifiedTime, `inventory item ${item.id}`);
    if (item.mimeType === folderMimeType) {
      requireCapability(
        item.id,
        item.capabilities.canListChildren,
        "list children",
      );
    } else {
      requireCapability(item.id, item.capabilities.canCopy, "copy");
      requireCapability(
        item.id,
        item.capabilities.canDownload,
        "download or export",
      );
    }
    items.set(item.id, item);
  }
  if (!items.has(inventory.rootId)) {
    throw new RepairPlanError("Repair inventory omits the module root ID.");
  }
  const localPaths = new Set<string>();
  const localIdentities = new Set<string>();
  for (const artifact of inventory.localArtifacts) {
    const identity = `${artifact.device}:${artifact.inode}`;
    if (
      artifact.relativePath.startsWith("/") ||
      artifact.relativePath.split("/").includes("..") ||
      artifact.relativePath.trim() === "" ||
      !/^\d+$/u.test(artifact.device) ||
      !/^\d+$/u.test(artifact.inode) ||
      !/^\d+$/u.test(artifact.size) ||
      !/^\d+$/u.test(artifact.modifiedTime) ||
      !/^[0-9a-f]{64}$/u.test(artifact.sha256) ||
      localPaths.has(artifact.relativePath) ||
      localIdentities.has(identity)
    ) {
      throw new RepairPlanError(
        "Repair inventory contains an unsafe or ambiguous local-only artifact.",
      );
    }
    localPaths.add(artifact.relativePath);
    localIdentities.add(identity);
  }
  return items;
}

function validateOperations(
  operations: RepairOperation[],
  items: Map<string, CompleteRepairInventory["items"][number]>,
  localArtifacts: CompleteRepairInventory["localArtifacts"],
): void {
  const operationIds = new Set<string>();
  const createdOperations = new Set<string>();
  const destinationKeys = new Set(
    [...items.values()].flatMap((item) =>
      item.parentIds.map(
        (parentId) => `existing:${parentId}:${canonicalName(item.name)}`,
      ),
    ),
  );
  const mutatedSources = new Set<string>();
  const operationIndex = new Map(
    operations.map(({ operationId }, index) => [operationId, index]),
  );
  for (const operation of operations) {
    if (
      operation.operationId.trim() === "" ||
      operationIds.has(operation.operationId)
    ) {
      throw new RepairPlanError(
        "Repair operations require unique non-empty IDs.",
      );
    }
    operationIds.add(operation.operationId);
    if (operation.kind === "retire-local-artifact") {
      const artifact = localArtifacts.find(
        (candidate) => localArtifactId(candidate) === operation.sourceId,
      );
      if (
        artifact === undefined ||
        artifact.relativePath !== operation.relativePath ||
        mutatedSources.has(operation.sourceId)
      ) {
        throw new RepairPlanError(
          "Local retirement requires one exact local artifact identity.",
        );
      }
      mutatedSources.add(operation.sourceId);
      continue;
    }
    if (
      operation.kind === "create-folder" ||
      operation.kind === "create-file"
    ) {
      validateParent(operation.parent, items, createdOperations);
      validateDestinationName(operation.name);
      rejectDestinationCollision(
        destinationKeys,
        destinationKey(operation.parent, operation.name),
      );
      createdOperations.add(operation.operationId);
      continue;
    }
    const source = items.get(operation.sourceId);
    if (source === undefined || mutatedSources.has(operation.sourceId)) {
      throw new RepairPlanError(
        "Each repair mutation must reference one unique inventory item ID.",
      );
    }
    mutatedSources.add(operation.sourceId);
    requireCapability(
      source.id,
      source.capabilities.canMoveItemWithinDrive,
      "move within Drive",
    );
    requireCapability(source.id, source.capabilities.canEdit, "edit");
    if (source.mimeType === folderMimeType) {
      requireDescendantsHandledBeforeFolder(
        source.id,
        operation.operationId,
        operations,
        operationIndex,
        items,
      );
    }
    if (operation.kind === "relocate-item") {
      validateDestination(operation.destination, items, createdOperations);
      rejectDestinationCollision(
        destinationKeys,
        destinationKey(
          operation.destination.parent,
          operation.destination.name,
        ),
      );
    }
  }
}

function requireDescendantsHandledBeforeFolder(
  folderId: string,
  folderOperationId: string,
  operations: RepairOperation[],
  operationIndex: Map<string, number>,
  items: Map<string, CompleteRepairInventory["items"][number]>,
): void {
  const folderIndex = operationIndex.get(folderOperationId) as number;
  for (const item of items.values()) {
    if (
      item.mimeType === folderMimeType ||
      !isDescendantOf(item, folderId, items)
    ) {
      continue;
    }
    const operation = operations.find(
      (candidate) =>
        (candidate.kind === "relocate-item" ||
          candidate.kind === "retire-item") &&
        candidate.sourceId === item.id,
    );
    if (
      operation === undefined ||
      (operationIndex.get(operation.operationId) ?? Number.POSITIVE_INFINITY) >=
        folderIndex
    ) {
      throw new RepairPlanError(
        `Folder repair ${folderOperationId} would implicitly migrate a file without an earlier file operation.`,
      );
    }
  }
}

function isDescendantOf(
  item: CompleteRepairInventory["items"][number],
  ancestorId: string,
  items: Map<string, CompleteRepairInventory["items"][number]>,
): boolean {
  let current = item;
  const visited = new Set<string>();
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const parent = current.parentIds.find((id) => items.has(id));
    if (parent === ancestorId) return true;
    const parentItem = parent === undefined ? undefined : items.get(parent);
    if (parentItem === undefined) return false;
    current = parentItem;
  }
  return false;
}

function validateDecisions(
  decisions: RepairDecision[],
  operations: RepairOperation[],
  items: Map<string, CompleteRepairInventory["items"][number]>,
  localArtifacts: CompleteRepairInventory["localArtifacts"],
): void {
  const bySource = new Map(
    operations.flatMap((operation) =>
      operation.kind === "relocate-item" ||
      operation.kind === "retire-item" ||
      operation.kind === "retire-local-artifact"
        ? [[operation.sourceId, operation] as const]
        : [],
    ),
  );
  const seen = new Set<string>();
  for (const decision of decisions) {
    const isDriveItem = items.has(decision.sourceId);
    const isLocalArtifact = localArtifacts.some(
      (artifact) => localArtifactId(artifact) === decision.sourceId,
    );
    if ((!isDriveItem && !isLocalArtifact) || seen.has(decision.sourceId)) {
      throw new RepairPlanError(
        "Repair decisions require one unique inventory item ID.",
      );
    }
    seen.add(decision.sourceId);
    if (
      decision.evidence.length === 0 ||
      decision.evidence.some(isBlank) ||
      (decision.supersedes !== undefined && isBlank(decision.supersedes))
    ) {
      throw new RepairPlanError("Every repair decision requires evidence.");
    }
    const operation = bySource.get(decision.sourceId);
    if (decision.decision === "curated") {
      if (
        operation?.kind !== "relocate-item" ||
        decision.destination === undefined ||
        !sameDestination(decision.destination, operation.destination)
      ) {
        throw new RepairPlanError(
          "A curated decision must match one relocate operation.",
        );
      }
    } else if (decision.decision === "recovery-only") {
      if (
        operation?.kind !== "retire-item" &&
        operation?.kind !== "retire-local-artifact"
      ) {
        throw new RepairPlanError(
          "A recovery-only decision must match one retire operation.",
        );
      }
    } else if (operation !== undefined) {
      throw new RepairPlanError(
        "A retained decision cannot mutate its source.",
      );
    }
  }
  for (const sourceId of bySource.keys()) {
    if (!seen.has(sourceId)) {
      throw new RepairPlanError(
        `Repair mutation ${sourceId} lacks an approved decision.`,
      );
    }
  }
}

function validateDestination(
  destination: RepairDestination,
  items: Map<string, CompleteRepairInventory["items"][number]>,
  createdOperations: Set<string>,
): void {
  validateParent(destination.parent, items, createdOperations);
  validateDestinationName(destination.name);
}

function validateParent(
  parent: RepairParentReference,
  items: Map<string, CompleteRepairInventory["items"][number]>,
  createdOperations: Set<string>,
): void {
  if (parent.kind === "planned") {
    if (!createdOperations.has(parent.operationId)) {
      throw new RepairPlanError(
        "A planned parent must be created before it is referenced.",
      );
    }
    return;
  }
  const item = items.get(parent.id);
  if (item?.mimeType !== folderMimeType) {
    throw new RepairPlanError("An existing repair parent must be a folder ID.");
  }
  requireCapability(
    parent.id,
    item.capabilities.canAddChildren,
    "add children",
  );
}

function validateDestinationName(name: string): void {
  if (!isSafeItemName(name)) {
    throw new RepairPlanError("Repair destination name is invalid.");
  }
}

function isSafeItemName(name: string): boolean {
  return (
    name.trim() !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\0")
  );
}

function destinationKey(parent: RepairParentReference, name: string): string {
  return `${parent.kind}:${parent.kind === "existing" ? parent.id : parent.operationId}:${canonicalName(name)}`;
}

function canonicalName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("en-US");
}

export function localArtifactId(
  artifact: CompleteRepairInventory["localArtifacts"][number],
): string {
  return `local:${artifact.device}:${artifact.inode}`;
}

function rejectDestinationCollision(keys: Set<string>, key: string): void {
  if (keys.has(key)) {
    throw new RepairPlanError(
      "Repair operations contain a destination collision.",
    );
  }
  keys.add(key);
}

function sameDestination(
  left: RepairDestination,
  right: RepairDestination,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function requireCapability(
  id: string,
  available: boolean | undefined,
  action: string,
): void {
  if (available !== true) {
    throw new RepairPlanError(
      `Repair inventory item ${id} cannot ${action} or has unavailable capability evidence.`,
    );
  }
}

function validateTimestamp(value: string, subject: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new RepairPlanError(`${subject} timestamp must be UTC ISO-8601.`);
  }
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
