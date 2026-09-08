import { validateImportStatusReceipt } from "./import-status-receipt.js";
import type {
  ImportStatus,
  ImportStatusReceipt,
  ImportStatusReceiptValidation,
} from "./types.js";

export interface EvaluatedImportStatus {
  status: Exclude<ImportStatus, "missing">;
  validation: ImportStatusReceiptValidation;
  receipt?: ImportStatusReceipt;
}

export function evaluateImportStatusReceipt(
  value: unknown,
  observedAt: string,
  maxAgeHours: number,
): EvaluatedImportStatus {
  const validation = validateImportStatusReceipt(value, observedAt);
  if (!validation.valid) return { status: "invalid", validation };
  const { receipt } = validation;
  if (receipt.status !== "complete") {
    return { status: receipt.status, validation, receipt };
  }
  const ageMilliseconds =
    Date.parse(observedAt) - Date.parse(receipt.finishedAt as string);
  return {
    status:
      ageMilliseconds <= maxAgeHours * 60 * 60 * 1000 ? "current" : "stale",
    validation,
    receipt,
  };
}
