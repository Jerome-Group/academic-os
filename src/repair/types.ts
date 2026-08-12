export interface RepairItemCapabilities {
  canAddChildren?: boolean;
  canCopy?: boolean;
  canDownload?: boolean;
  canEdit?: boolean;
  canListChildren?: boolean;
  canMoveItemWithinDrive?: boolean;
}

export interface RepairInventoryItem {
  id: string;
  name: string;
  mimeType: string;
  parentIds: string[];
  modifiedTime: string;
  version: string;
  size?: string;
  md5Checksum?: string;
  capabilities: RepairItemCapabilities;
  appProperties?: Record<string, string>;
}

export interface CompleteRepairInventory {
  complete: true;
  observedAt: string;
  rootId: string;
  items: RepairInventoryItem[];
  localArtifacts: LocalRepairArtifact[];
}

export interface LocalRepairArtifact {
  relativePath: string;
  device: string;
  inode: string;
  size: string;
  modifiedTime: string;
  sha256: string;
}

export type RepairParentReference =
  | { kind: "existing"; id: string }
  | { kind: "planned"; operationId: string };

export interface RepairDestination {
  parent: RepairParentReference;
  name: string;
}

export interface RepairDecision {
  sourceId: string;
  decision: "curated" | "recovery-only" | "retained";
  destination?: RepairDestination;
  evidence: string[];
  supersedes?: string;
}

interface RepairOperationBase {
  operationId: string;
}

export interface CreateRepairFolderOperation extends RepairOperationBase {
  kind: "create-folder";
  parent: RepairParentReference;
  name: string;
}

export interface CreateRepairFileOperation extends RepairOperationBase {
  kind: "create-file";
  parent: RepairParentReference;
  name: string;
  mimeType: string;
  contents: string;
}

export interface RelocateRepairItemOperation extends RepairOperationBase {
  kind: "relocate-item";
  sourceId: string;
  destination: RepairDestination;
}

export interface RetireRepairItemOperation extends RepairOperationBase {
  kind: "retire-item";
  sourceId: string;
}

export interface RetireLocalRepairArtifactOperation
  extends RepairOperationBase {
  kind: "retire-local-artifact";
  sourceId: string;
  relativePath: string;
}

export type RepairOperation =
  | CreateRepairFolderOperation
  | CreateRepairFileOperation
  | RelocateRepairItemOperation
  | RetireRepairItemOperation
  | RetireLocalRepairArtifactOperation;

export interface RepairApproval {
  approvedBy: string;
  approvedAt: string;
  decisionDigest: string;
  approvedPlanDigest: string;
}

export interface RepairPlanDraft {
  schemaVersion: 1;
  changeSetId: string;
  module: { code: string; semester: string; rootId: string };
  contractVersion: number;
  inventory: CompleteRepairInventory;
  decisions: RepairDecision[];
  operations: RepairOperation[];
  curationRegisterParent: RepairParentReference;
  curationRegisterPrior?: {
    sourceId: string;
    contents: string;
  };
  approval: RepairApproval;
}

export interface RepairCurationEvent {
  schema_version: 1;
  source_id: string;
  integration: "historical-migration";
  role: "historical-source";
  source_path: string;
  checksum?: string;
  decision: "curated" | "source-only";
  destination?: string;
  evidence: string;
  timestamp: string;
  supersedes?: string;
}

export interface RepairPlan extends Omit<RepairPlanDraft, "operations"> {
  operations: RepairOperation[];
  curationEvents: RepairCurationEvent[];
  inventoryDigest: string;
  decisionDigest: string;
  planDigest: string;
}
