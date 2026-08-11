import type { InventoryDiagnostic } from "../conformance/index.js";
import type {
  DriveFile,
  DriveFilePage,
  DriveFilesClient,
  DriveInventoryOptions,
} from "./types.js";

export async function listDriveFolder(
  parentId: string,
  client: DriveFilesClient,
  options: DriveInventoryOptions,
  diagnostics: InventoryDiagnostic[],
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  let completedPages = 0;
  const seenPageTokens = new Set<string>();
  do {
    const page = await listPageWithRetries(
      parentId,
      pageToken,
      completedPages,
      client,
      options,
      diagnostics,
    );
    if (page === undefined) return files;
    files.push(...(page.files ?? []));
    completedPages += 1;
    if (page.incompleteSearch === true) {
      diagnostics.push({
        kind: "pagination-failure",
        severity: "error",
        evidence: `Drive marked the listing for parent ${parentId} incomplete after page ${completedPages}.`,
      });
      return files;
    }
    pageToken = page.nextPageToken;
    if (pageToken !== undefined && seenPageTokens.has(pageToken)) {
      diagnostics.push({
        kind: "pagination-failure",
        severity: "error",
        evidence: `Drive repeated pagination token ${pageToken} for parent ${parentId} after page ${completedPages}.`,
      });
      return files;
    }
    if (pageToken !== undefined) seenPageTokens.add(pageToken);
  } while (pageToken !== undefined);
  return files;
}

async function listPageWithRetries(
  parentId: string,
  pageToken: string | undefined,
  completedPages: number,
  client: DriveFilesClient,
  options: DriveInventoryOptions,
  diagnostics: InventoryDiagnostic[],
): Promise<DriveFilePage | undefined> {
  const maximumAttempts = Math.max(1, options.maximumAttempts ?? 3);
  const wait = options.wait ?? defaultWait;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await client.listFiles({
        parentId,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
    } catch (error) {
      const apiError = readApiError(error);
      const retryable =
        isRateLimit(apiError) ||
        (apiError.status !== undefined && apiError.status >= 500);
      if (retryable && attempt < maximumAttempts) {
        await wait(2 ** (attempt - 1) * 100);
        continue;
      }
      diagnostics.push({
        kind: isRateLimit(apiError) ? "rate-limit" : "pagination-failure",
        severity: "error",
        evidence: `Drive listing stopped at parent ${parentId} after page ${completedPages}; status ${apiError.status ?? "unavailable"}, reason ${apiError.reason ?? "unavailable"}, ${attempt} attempts.`,
      });
      return undefined;
    }
  }
  return undefined;
}

function isRateLimit(error: { status?: number; reason?: string }): boolean {
  return (
    error.status === 429 ||
    (error.status === 403 &&
      ["rateLimitExceeded", "userRateLimitExceeded"].includes(
        error.reason ?? "",
      ))
  );
}

function readApiError(error: unknown): { status?: number; reason?: string } {
  if (typeof error !== "object" || error === null) return {};
  const status = "status" in error ? error.status : undefined;
  const reason = "reason" in error ? error.reason : undefined;
  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
