import { GoogleAuth } from "google-auth-library";

import type {
  DriveFilePage,
  DriveFilesClient,
  DriveListRequest,
} from "./types.js";

export const DRIVE_METADATA_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";

const filesFields =
  "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,size,md5Checksum,trashed,shortcutDetails(targetId,targetMimeType))";

export interface DriveMetadataHttpRequest {
  url: "https://www.googleapis.com/drive/v3/files";
  method: "GET";
  params: {
    q: string;
    pageToken?: string;
    pageSize: 1000;
    spaces: "drive";
    supportsAllDrives: true;
    includeItemsFromAllDrives: true;
    fields: string;
  };
}

export interface DriveMetadataRequester {
  request(request: DriveMetadataHttpRequest): Promise<{ data: DriveFilePage }>;
}

export function createGoogleDriveFilesClient(
  requester: DriveMetadataRequester = defaultRequester(),
): DriveFilesClient {
  return {
    listFiles: async (request) => {
      try {
        const response = await requester.request(listRequest(request));
        return response.data;
      } catch (error) {
        throw sanitizedDriveRequestError(error);
      }
    },
  };
}

function defaultRequester(): DriveMetadataRequester {
  const auth = new GoogleAuth({ scopes: [DRIVE_METADATA_READONLY_SCOPE] });
  return {
    request: async (request) => {
      const response = await auth.request<DriveFilePage>(request);
      return { data: response.data };
    },
  };
}

function listRequest(request: DriveListRequest): DriveMetadataHttpRequest {
  return {
    url: "https://www.googleapis.com/drive/v3/files",
    method: "GET",
    params: {
      q: `'${escapeDriveQueryLiteral(request.parentId)}' in parents`,
      ...(request.pageToken === undefined
        ? {}
        : { pageToken: request.pageToken }),
      pageSize: 1000,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: filesFields,
    },
  };
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function sanitizedDriveRequestError(error: unknown): Error {
  const status = responseStatus(error);
  const reason = responseReason(error);
  return Object.assign(new Error("Drive metadata request failed."), {
    ...(status === undefined ? {} : { status }),
    ...(reason === undefined ? {} : { reason }),
  });
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }
  return undefined;
}

function responseReason(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("reason" in error && typeof error.reason === "string") {
    return error.reason;
  }
  if (!("response" in error)) return undefined;
  const response = error.response;
  if (
    typeof response !== "object" ||
    response === null ||
    !("data" in response)
  ) {
    return undefined;
  }
  const data = response.data;
  if (typeof data !== "object" || data === null || !("error" in data)) {
    return undefined;
  }
  const apiError = data.error;
  if (
    typeof apiError !== "object" ||
    apiError === null ||
    !("errors" in apiError) ||
    !Array.isArray(apiError.errors)
  ) {
    return undefined;
  }
  const first = apiError.errors[0];
  return typeof first === "object" &&
    first !== null &&
    "reason" in first &&
    typeof first.reason === "string"
    ? first.reason
    : undefined;
}
