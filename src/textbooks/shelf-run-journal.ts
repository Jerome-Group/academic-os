import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  hasCode,
  identity,
  sameIdentity,
  shelfName,
  type ShelfFileObservation,
  type ShelfIdentity,
} from "./shelf-file-observation.js";
import type { ShelfApprovedRow } from "./types.js";

export interface ShelfPublication {
  operation: "exclusive" | "exchange";
  capture: string;
  original: ShelfFileObservation | null;
  proposal: ShelfFileObservation;
}

export interface ShelfRun {
  runId: string;
  shelfRoot: string;
  root: ShelfIdentity;
  operation: "migrate" | "catch-up";
  books: Array<{ row: ShelfApprovedRow; observation: ShelfFileObservation }>;
  activeBook: string | null;
  listing: string[];
  initialIndex: ShelfFileObservation | null;
  probe: string;
  probeIdentity: ShelfIdentity | null;
  probeFiles: Record<string, ShelfFileObservation>;
  probeStep:
    | "create"
    | "occupied-exclusion"
    | "exclusive"
    | "exchange"
    | "cleanup";
  proposal: string;
  publication: ShelfPublication | null;
  phase:
    | "started"
    | "probe-verified"
    | "book-intent"
    | "book-observed"
    | "proposal-intent"
    | "publication-intent"
    | "observed"
    | "partial"
    | "complete"
    | "refused"
    | "acknowledged";
  evidence: string[];
}

export function settledRun(run: ShelfRun): boolean {
  return ["complete", "refused", "acknowledged"].includes(run.phase);
}

export async function prepareShelfJournal(
  stateRoot: string,
  journalPath: string,
): Promise<void> {
  for (const path of [join(stateRoot, "journals"), dirname(journalPath)]) {
    await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    });
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700 ||
      (await realpath(path)) !== path
    )
      throw new Error(
        `Shelf journal parent must be canonical, owned and private: ${path}.`,
      );
    await syncDirectory(dirname(path));
  }
}

export async function appendShelfRun(
  path: string,
  run: ShelfRun,
): Promise<void> {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = await file.stat();
    const openedIdentity = identity(await file.stat({ bigint: true }));
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new Error("Shelf journal must be an ordinary owned private file.");
    await file.writeFile(
      `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), run })}\n`,
      "utf8",
    );
    await file.sync();
    if (!sameIdentity(openedIdentity, await fileIdentity(path)))
      throw new Error("Shelf journal identity changed.");
  } finally {
    await file.close();
  }
  await syncDirectory(dirname(path));
}

export async function readShelfRuns(
  path: string,
): Promise<Map<string, ShelfRun>> {
  const runs = new Map<string, ShelfRun>();
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (hasCode(error, "ENOENT")) return runs;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new Error("Shelf journal is not an ordinary owned private file.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.readFile(),
    );
    if (text !== "" && !text.endsWith("\n"))
      throw new Error(`Shelf journal has an interrupted record: ${path}.`);
    for (const line of text.split("\n").filter((line) => line !== "")) {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value) || value.schemaVersion !== 1 || !isRun(value.run))
        throw new Error(`Shelf journal has an unsupported record: ${path}.`);
      runs.set(value.run.runId, value.run);
    }
  } finally {
    await file.close();
  }
  return runs;
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function fileIdentity(path: string): Promise<ShelfIdentity> {
  return identity(await lstat(path, { bigint: true }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIdentity(value: unknown): value is ShelfIdentity {
  return (
    isRecord(value) &&
    typeof value.dev === "string" &&
    /^\d+$/u.test(value.dev) &&
    typeof value.ino === "string" &&
    /^\d+$/u.test(value.ino)
  );
}
function isObservation(value: unknown): value is ShelfFileObservation {
  return (
    isIdentity(value) &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    "size" in value &&
    typeof value.size === "string" &&
    /^\d+$/u.test(value.size)
  );
}
function isName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    shelfName(value);
    return true;
  } catch {
    return false;
  }
}
function isRow(value: unknown): value is ShelfApprovedRow {
  if (
    !isRecord(value) ||
    !isLiteral(value.kind, ["append", "indexed"]) ||
    !isName(value.source) ||
    typeof value.key !== "string" ||
    !isRecord(value.entry)
  )
    return false;
  const e = value.entry;
  return (
    isName(e.file) &&
    typeof e.title === "string" &&
    Array.isArray(e.authors) &&
    e.authors.every((a: unknown) => typeof a === "string") &&
    typeof e.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(e.sha256) &&
    (e.edition === undefined || typeof e.edition === "string") &&
    (e.division === undefined || typeof e.division === "string")
  );
}
function isPublication(value: unknown): value is ShelfPublication {
  return (
    isRecord(value) &&
    isLiteral(value.operation, ["exclusive", "exchange"]) &&
    isName(value.capture) &&
    (value.original === null || isObservation(value.original)) &&
    isObservation(value.proposal)
  );
}
function isRun(value: unknown): value is ShelfRun {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    /^[a-f0-9-]{36}$/u.test(value.runId) &&
    typeof value.shelfRoot === "string" &&
    isIdentity(value.root) &&
    isLiteral(value.operation, ["migrate", "catch-up"]) &&
    Array.isArray(value.books) &&
    value.books.every(
      (book: unknown) =>
        isRecord(book) && isRow(book.row) && isObservation(book.observation),
    ) &&
    (value.activeBook === null || isName(value.activeBook)) &&
    Array.isArray(value.listing) &&
    value.listing.every(isName) &&
    (value.initialIndex === null || isObservation(value.initialIndex)) &&
    isName(value.probe) &&
    isName(value.proposal) &&
    (value.probeIdentity === null || isIdentity(value.probeIdentity)) &&
    isRecord(value.probeFiles) &&
    Object.entries(value.probeFiles).every(
      ([name, file]) => isName(name) && isObservation(file),
    ) &&
    isLiteral(value.probeStep, [
      "create",
      "occupied-exclusion",
      "exclusive",
      "exchange",
      "cleanup",
    ]) &&
    (value.publication === null || isPublication(value.publication)) &&
    isLiteral(value.phase, [
      "started",
      "probe-verified",
      "book-intent",
      "book-observed",
      "proposal-intent",
      "publication-intent",
      "observed",
      "partial",
      "complete",
      "refused",
      "acknowledged",
    ]) &&
    Array.isArray(value.evidence) &&
    value.evidence.every((line: unknown) => typeof line === "string")
  );
}

function isLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" &&
    allowed.some((candidate) => candidate === value)
  );
}
