import type { Inventory } from "../conformance/index.js";

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  trashed?: boolean;
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

export interface DriveFilePage {
  files?: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface DriveListRequest {
  parentId: string;
  pageToken?: string;
}

export interface DriveFilesClient {
  listFiles(request: DriveListRequest): Promise<DriveFilePage>;
}

export interface DriveInventoryTarget {
  moduleCode: string;
  moduleFolderId: string;
}

export interface DriveInventoryOptions {
  maximumAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export type DriveInventory = Inventory & {
  provenance: NonNullable<Inventory["provenance"]> & {
    source: "drive-api";
  };
};
