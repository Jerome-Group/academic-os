import type { DriveFile } from "./types.js";

export const folderMimeType = "application/vnd.google-apps.folder";
export const shortcutMimeType = "application/vnd.google-apps.shortcut";

export interface ListedDriveItem {
  file: DriveFile;
  path: string;
  ancestorIds: string[];
}
