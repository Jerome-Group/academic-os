import type { Inventory } from "../conformance/index.js";

export interface LocalConfig {
  driveMount: string;
  stateRoot: string;
  semester: string;
  module: string;
  semesterRoots: Record<string, string>;
}

export interface ResolvedTarget {
  driveMount: string;
  stateRoot: string;
  semesterRoot: string;
  moduleRoot: string;
  semester: string;
  module: string;
}

export interface MountedInventoryResult {
  target: ResolvedTarget;
  inventory: Inventory;
}
