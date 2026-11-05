import { isDeepStrictEqual } from "node:util";

import { sha256 } from "../checksum.js";
import { OperationalError } from "../operational-error.js";
import type {
  TaskRefreshAttempt,
  TaskRefreshGeneration,
  TaskRefreshReceipt,
  TaskRegister,
} from "./types.js";

export function taskRegisterGeneration(register: TaskRegister): string {
  return sha256(JSON.stringify(canonicalValue(register)));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function taskRefreshReceipt(
  attempt: TaskRefreshAttempt,
  previous?: TaskRefreshReceipt,
): TaskRefreshReceipt {
  if (
    attempt.schemaVersion !== 1 ||
    !["module", "research-project"].includes(attempt.target.kind) ||
    typeof attempt.target.key !== "string" ||
    attempt.target.key.length === 0 ||
    typeof attempt.target.title !== "string" ||
    !validInstant(attempt.observedAt) ||
    (attempt.configBinding !== undefined &&
      typeof attempt.configBinding !== "string") ||
    !["fresh", "stale"].includes(attempt.freshness) ||
    (attempt.listId !== null &&
      (typeof attempt.listId !== "string" || attempt.listId.length === 0))
  )
    throw invalidReceipt();
  if (attempt.freshness === "fresh" && attempt.failure !== undefined)
    throw invalidReceipt();
  const generation =
    attempt.freshness === "fresh" ? successfulGeneration(attempt) : undefined;
  if (
    attempt.freshness === "stale" &&
    (attempt.failure === undefined ||
      typeof attempt.failure.code !== "string" ||
      typeof attempt.failure.message !== "string" ||
      attempt.generation !== undefined ||
      attempt.providerSnapshot !== undefined)
  )
    throw invalidReceipt();
  return {
    ...attempt,
    lastSuccess: generation ?? previous?.lastSuccess ?? null,
  };
}

export function parseTaskRefreshReceipt(contents: string): TaskRefreshReceipt {
  try {
    const value = JSON.parse(contents) as TaskRefreshReceipt;
    assertKeys(value, [
      "schemaVersion",
      "target",
      "listId",
      "observedAt",
      "freshness",
      "generation",
      "providerSnapshot",
      "configBinding",
      "failure",
      "lastSuccess",
    ]);
    assertKeys(value.target, ["kind", "key", "title"]);
    if (value.failure !== undefined)
      assertKeys(value.failure, ["code", "message"]);
    if (value.lastSuccess !== null)
      assertKeys(value.lastSuccess, [
        "listId",
        "observedAt",
        "generation",
        "providerSnapshot",
        "configBinding",
      ]);
    const parsed = taskRefreshReceipt(value);
    if (value.lastSuccess !== null) successfulGeneration(value.lastSuccess);
    if (
      value.freshness === "fresh" &&
      !isDeepStrictEqual(parsed.lastSuccess, value.lastSuccess)
    )
      throw invalidReceipt();
    return value;
  } catch {
    throw invalidReceipt();
  }
}

function successfulGeneration(value: {
  listId?: unknown;
  observedAt?: unknown;
  generation?: unknown;
  providerSnapshot?: unknown;
  configBinding?: unknown;
}): TaskRefreshGeneration {
  if (
    typeof value.listId !== "string" ||
    value.listId.length === 0 ||
    !validInstant(value.observedAt) ||
    !validDigest(value.generation) ||
    !validDigest(value.providerSnapshot) ||
    (value.configBinding !== undefined &&
      typeof value.configBinding !== "string")
  )
    throw invalidReceipt();
  return {
    listId: value.listId,
    observedAt: value.observedAt as string,
    generation: value.generation as string,
    providerSnapshot: value.providerSnapshot as string,
    ...(value.configBinding === undefined
      ? {}
      : { configBinding: value.configBinding }),
  };
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(new Date(value).valueOf()) &&
    new Date(value).toISOString() === value
  );
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function assertKeys(value: unknown, allowed: readonly string[]): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw invalidReceipt();
}

function invalidReceipt(): OperationalError {
  return new OperationalError(
    "operational-failure",
    "The private Task-refresh receipt is invalid; retain it for inspection.",
  );
}
