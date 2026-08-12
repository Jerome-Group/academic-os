import { GoogleAuth } from "google-auth-library";

interface RequestOptions {
  url?: string;
  params?: Record<string, unknown>;
}

const prototype = GoogleAuth.prototype as unknown as {
  request(options: RequestOptions): Promise<{ data: unknown }>;
};

prototype.request = async ({ url, params }) => {
  if (url?.endsWith("/module-id")) {
    return {
      data: {
        id: "module-id",
        name: "ZZ9999",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["semester-id"],
        modifiedTime: "2026-08-12T11:00:00.000Z",
        version: "1",
        capabilities: {
          canAddChildren: true,
          canListChildren: true,
          canMoveItemWithinDrive: true,
        },
      },
    };
  }
  const query = String(params?.q ?? "");
  if (query.includes("'module-id' in parents")) {
    return {
      data: {
        files: [
          {
            id: "legacy-materials-id",
            name: "001 Source Material",
            mimeType: "application/vnd.google-apps.folder",
            parents: ["module-id"],
            modifiedTime: "2026-08-12T11:00:00.000Z",
            version: "2",
            capabilities: {
              canAddChildren: true,
              canListChildren: true,
              canMoveItemWithinDrive: true,
            },
          },
        ],
      },
    };
  }
  if (query.includes("'legacy-materials-id' in parents")) {
    return {
      data: {
        files: [
          {
            id: "source-id",
            name: "ZZ9999 Source A.pdf",
            mimeType: "application/pdf",
            parents: ["legacy-materials-id"],
            modifiedTime: "2025-08-14T08:00:00.000Z",
            version: "7",
            size: "42",
            md5Checksum: "0123456789abcdef0123456789abcdef",
            capabilities: {
              canCopy: true,
              canDownload: true,
              canEdit: true,
              canMoveItemWithinDrive: true,
            },
          },
        ],
      },
    };
  }
  throw new Error(`Unexpected synthetic Drive request: ${url}.`);
};
