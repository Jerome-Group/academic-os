import {
  importReceiptStatuses,
  type ImportCounts,
  type ImportStatusReceipt,
  type ImportStatusReceiptValidation,
} from "./types.js";

const receiptFields = [
  "schemaVersion",
  "producer",
  "status",
  "startedAt",
  "finishedAt",
  "lastSuccessfulAt",
  "counts",
  "unread",
] as const;
const countFields = [
  "downloaded",
  "skipped",
  "markdown",
  "uncopied",
  "failures",
] as const;
const unreadCategories = ["announcements", "conversations"] as const;

export function validateImportStatusReceipt(
  value: unknown,
  observedAt: string,
): ImportStatusReceiptValidation {
  const problems: string[] = [];
  const observationTime = canonicalTimestamp(observedAt);
  if (observationTime === undefined) {
    return {
      valid: false,
      problems: ["observedAt must be a canonical UTC timestamp."],
    };
  }
  if (!isRecord(value)) {
    return { valid: false, problems: ["Receipt must be a JSON object."] };
  }
  problems.push(...exactFields(value, receiptFields, "Receipt"));
  if (value.schemaVersion !== 1) {
    problems.push("schemaVersion must be 1.");
  }
  if (value.producer !== "ntulearn") {
    problems.push("producer must be ntulearn.");
  }
  const status = importReceiptStatuses.find((item) => item === value.status);
  if (status === undefined) {
    problems.push("status is unsupported.");
  }

  const startedAt = timestampField(value.startedAt, "startedAt", problems);
  const finishedAt = nullableTimestampField(
    value.finishedAt,
    "finishedAt",
    problems,
  );
  const lastSuccessfulAt = nullableTimestampField(
    value.lastSuccessfulAt,
    "lastSuccessfulAt",
    problems,
  );
  for (const [field, time] of [
    ["startedAt", startedAt],
    ["finishedAt", finishedAt],
    ["lastSuccessfulAt", lastSuccessfulAt],
  ] as const) {
    if (time !== undefined && time !== null && time > observationTime) {
      problems.push(`${field} must not be after the observation time.`);
    }
  }
  if (
    startedAt !== undefined &&
    finishedAt !== undefined &&
    finishedAt !== null &&
    finishedAt < startedAt
  ) {
    problems.push("finishedAt must be at or after startedAt.");
  }
  if (
    status !== "complete" &&
    startedAt !== undefined &&
    lastSuccessfulAt !== undefined &&
    lastSuccessfulAt !== null &&
    lastSuccessfulAt > startedAt
  ) {
    problems.push("lastSuccessfulAt must be at or before startedAt.");
  }

  const counts = validateCounts(value.counts, problems);
  const unread = validateUnread(value.unread, problems);
  if (status !== undefined && counts !== undefined && unread !== undefined) {
    validateLifecycle(
      status,
      finishedAt,
      lastSuccessfulAt,
      counts,
      unread,
      problems,
    );
  }

  return problems.length === 0
    ? { valid: true, receipt: value as unknown as ImportStatusReceipt }
    : { valid: false, problems };
}

function validateCounts(
  value: unknown,
  problems: string[],
): ImportCounts | undefined {
  if (!isRecord(value)) {
    problems.push("counts must be an object.");
    return undefined;
  }
  problems.push(...exactFields(value, countFields, "counts"));
  for (const field of countFields) {
    if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0) {
      problems.push(`counts.${field} must be a nonnegative safe integer.`);
    }
  }
  return countFields.every(
    (field) =>
      Number.isSafeInteger(value[field]) && (value[field] as number) >= 0,
  )
    ? (value as unknown as ImportCounts)
    : undefined;
}

function validateUnread(
  value: unknown,
  problems: string[],
): ImportStatusReceipt["unread"] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) =>
      unreadCategories.includes(item as (typeof unreadCategories)[number]),
    )
  ) {
    problems.push("unread must contain only announcements and conversations.");
    return undefined;
  }
  if (new Set(value).size !== value.length) {
    problems.push("unread must not contain duplicates.");
  }
  if ([...value].sort().some((item, index) => item !== value[index])) {
    problems.push("unread must be sorted.");
  }
  return value as ImportStatusReceipt["unread"];
}

function validateLifecycle(
  status: ImportStatusReceipt["status"],
  finishedAt: number | null | undefined,
  lastSuccessfulAt: number | null | undefined,
  counts: ImportCounts,
  unread: ImportStatusReceipt["unread"],
  problems: string[],
): void {
  if (status === "running") {
    if (finishedAt !== null) problems.push("running requires finishedAt null.");
    if (Object.values(counts).some((count) => count !== 0)) {
      problems.push("running requires zero counts.");
    }
    if (unread.length > 0) problems.push("running requires unread empty.");
    return;
  }
  if (finishedAt === null) {
    problems.push(`${status} requires a finishedAt timestamp.`);
  }
  if (status === "complete") {
    if (counts.failures !== 0 || unread.length > 0) {
      problems.push("complete requires zero failures and unread empty.");
    }
    if (
      finishedAt !== undefined &&
      finishedAt !== null &&
      lastSuccessfulAt !== finishedAt
    ) {
      problems.push("complete requires lastSuccessfulAt equal to finishedAt.");
    }
  }
  if (status === "partial" && counts.failures === 0 && unread.length === 0) {
    problems.push("partial requires a failure or unread category.");
  }
}

function timestampField(
  value: unknown,
  field: string,
  problems: string[],
): number | undefined {
  const timestamp = canonicalTimestamp(value);
  if (timestamp === undefined) {
    problems.push(`${field} must be a canonical UTC timestamp.`);
  }
  return timestamp;
}

function nullableTimestampField(
  value: unknown,
  field: string,
  problems: string[],
): number | null | undefined {
  return value === null ? null : timestampField(value, field, problems);
}

function canonicalTimestamp(value: unknown): number | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : undefined;
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string,
): string[] {
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  return [
    ...allowed
      .filter((field) => !Object.hasOwn(value, field))
      .map((field) => `${location} is missing field ${field}.`),
    ...keys
      .filter((field) => !allowedSet.has(field))
      .sort()
      .map((field) => `${location} has undeclared field ${field}.`),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
