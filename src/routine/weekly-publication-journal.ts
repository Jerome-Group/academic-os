import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withJournalMutationOwner } from "../journal-mutation-owner.js";
import type {
  MorningRunEvidence,
  WeeklyComment,
  WeeklyDiscussionIdentity,
} from "./types.js";
import {
  day,
  digest,
  hash,
  hashes,
  positive,
  record,
} from "./weekly-review-state.js";

export interface WeeklyBasis {
  ticket: string;
  coverage: MorningRunEvidence["scope"];
  scope: string;
  date: string;
  parents: string[];
  repositoryParents: string[];
}
export type PublicationOperation =
  | { kind: "anchor"; week: string; title: string; body: string }
  | { kind: "comment"; number: number; body: string }
  | { kind: "state"; number: number; state: "OPEN" | "CLOSED" };
type JournalEntry =
  | { kind: "binding"; identity: WeeklyDiscussionIdentity }
  | { kind: "basis"; basis: WeeklyBasis }
  | { kind: "anchor"; number: number; id: number; week: string }
  | {
      kind: "intent";
      id: string;
      semanticDigest: string;
      operation: PublicationOperation;
    }
  | { kind: "receipt"; id: string; remoteIds: number[] }
  | { kind: "seen"; comment: WeeklyComment };
export interface PublicationJournal {
  entries: JournalEntry[];
  append(entry: JournalEntry): Promise<void>;
}
export async function ownWeeklyJournal<T>(
  stateRoot: string,
  run: (journal: PublicationJournal) => Promise<T>,
): Promise<T> {
  const directory = join(stateRoot, "weekly-publication");
  await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700
  )
    throw new Error(
      "Weekly publication requires a private ordinary directory.",
    );
  const mutate = async (path: string): Promise<T> => {
    const file = await open(
      path,
      constants.O_CREAT |
        constants.O_APPEND |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const metadata = await file.stat();
      if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o777) !== 0o600 ||
        metadata.size > 32 * 1024 * 1024
      )
        throw new Error("Unsafe or oversized weekly publication journal.");
      const bytes = await file.readFile("utf8");
      if (bytes !== "" && !bytes.endsWith("\n"))
        throw new Error(
          "Incomplete weekly journal record requires reconciliation.",
        );
      const entries = bytes
        .split("\n")
        .filter(Boolean)
        .map((line) => parseEntry(JSON.parse(line)));
      let bytesUsed = metadata.size;
      const journal: PublicationJournal = {
        entries,
        async append(entry) {
          const line = `${JSON.stringify(entry)}\n`;
          const size = Buffer.byteLength(line);
          if (bytesUsed + size > 32 * 1024 * 1024)
            throw new Error("Weekly publication journal exceeds 32 MiB.");
          await file.writeFile(line);
          await file.sync();
          bytesUsed += size;
          entries.push(entry);
        },
      };
      const parent = await open(dirname(path), constants.O_RDONLY);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      return await run(journal);
    } finally {
      await file.close();
    }
  };
  for (let attempt = 0; ; attempt += 1) {
    const result = await withJournalMutationOwner(
      { stateRoot, journalPath: join(directory, "publication.jsonl") },
      mutate,
    );
    if (result.kind === "owned") return result.value;
    if (result.reason !== "busy" || attempt === 119)
      throw new Error(result.evidence);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
export async function bindPublisher(
  journal: PublicationJournal,
  identity: WeeklyDiscussionIdentity,
): Promise<void> {
  const bindings = journal.entries.filter((e) => e.kind === "binding");
  if (
    bindings.length > 1 ||
    bindings.some(
      (e) =>
        e.identity.repositoryId !== identity.repositoryId ||
        e.identity.publisherId !== identity.publisherId,
    )
  )
    throw new Error(
      "Weekly repository or publisher identity changed; private reconciliation required.",
    );
  if (bindings.length === 0)
    await journal.append({ kind: "binding", identity });
}
export function parseBasis(value: unknown): WeeklyBasis {
  const basis = record(value);
  if (
    basis.coverage !== "monitoring-cohort" &&
    basis.coverage !== "modules-only"
  )
    throw new Error("Invalid weekly coverage basis.");
  return {
    coverage: basis.coverage,
    ticket: hash(basis.ticket),
    scope: hash(basis.scope),
    date: day(basis.date),
    parents: hashes(basis.parents),
    repositoryParents: hashes(basis.repositoryParents),
  };
}
export function requireBasis(
  journal: PublicationJournal,
  basis: WeeklyBasis,
): void {
  if (
    !journal.entries.some(
      (e) =>
        e.kind === "basis" && JSON.stringify(e.basis) === JSON.stringify(basis),
    )
  )
    throw new Error("Unrecognized private weekly observation basis.");
}
export function intents(
  journal: PublicationJournal,
): { id: string; operation: PublicationOperation }[] {
  return journal.entries.flatMap((e) =>
    e.kind === "intent" &&
    !journal.entries.some((r) => r.kind === "receipt" && r.id === e.id)
      ? [{ id: e.id, operation: e.operation }]
      : [],
  );
}
export function knownComments(journal: PublicationJournal): WeeklyComment[] {
  return journal.entries.flatMap((e) => (e.kind === "seen" ? [e.comment] : []));
}
export function anchorBindings(
  journal: PublicationJournal,
): { number: number; id: number; week: string }[] {
  return journal.entries.flatMap((e) =>
    e.kind === "anchor" ? [{ number: e.number, id: e.id, week: e.week }] : [],
  );
}
export function knownAnchors(journal: PublicationJournal): number[] {
  return anchorBindings(journal).map((e) => e.number);
}
export async function rememberAnchor(
  journal: PublicationJournal,
  input: { number: number; id: number; week: string },
): Promise<void> {
  const known = anchorBindings(journal).find((e) => e.number === input.number);
  if (
    known !== undefined &&
    (known.id !== input.id || known.week !== input.week)
  )
    throw new Error("Known weekly anchor identity changed.");
  if (known === undefined) await journal.append({ kind: "anchor", ...input });
}
export async function rememberComment(
  journal: PublicationJournal,
  comment: WeeklyComment,
): Promise<void> {
  if (!knownComments(journal).some((known) => known.id === comment.id))
    await journal.append({ kind: "seen", comment });
}
export async function intent(
  journal: PublicationJournal,
  operation: PublicationOperation,
): Promise<string> {
  const id = digest([operation, randomUUID()]);
  await journal.append({
    kind: "intent",
    id,
    semanticDigest: digest(operation),
    operation,
  });
  return id;
}
export async function receipt(
  journal: PublicationJournal,
  id: string,
  remoteIds: number[],
): Promise<void> {
  if (!journal.entries.some((e) => e.kind === "receipt" && e.id === id))
    await journal.append({ kind: "receipt", id, remoteIds });
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid weekly journal text.");
  return value;
}
function parseEntry(value: unknown): JournalEntry {
  const entry = record(value);
  switch (entry.kind) {
    case "binding": {
      const identity = record(entry.identity);
      return {
        kind: "binding",
        identity: {
          publisherId: positive(identity.publisherId),
          repositoryId: positive(identity.repositoryId),
        },
      };
    }
    case "anchor":
      return {
        kind: "anchor",
        number: positive(entry.number),
        id: positive(entry.id),
        week: day(entry.week),
      };
    case "basis":
      return { kind: "basis", basis: parseBasis(entry.basis) };
    case "intent": {
      const op = record(entry.operation);
      let operation: PublicationOperation;
      switch (op.kind) {
        case "anchor":
          operation = {
            kind: "anchor",
            week: day(op.week),
            title: text(op.title),
            body: text(op.body),
          };
          break;
        case "comment":
          operation = {
            kind: "comment",
            number: positive(op.number),
            body: text(op.body),
          };
          break;
        case "state":
          if (op.state !== "OPEN" && op.state !== "CLOSED")
            throw new Error("Invalid weekly state intent.");
          operation = {
            kind: "state",
            number: positive(op.number),
            state: op.state,
          };
          break;
        default:
          throw new Error("Invalid weekly journal operation.");
      }
      if (hash(entry.semanticDigest) !== digest(operation))
        throw new Error("Weekly intent digest changed.");
      return {
        kind: "intent",
        id: hash(entry.id),
        semanticDigest: hash(entry.semanticDigest),
        operation,
      };
    }
    case "receipt":
      if (!Array.isArray(entry.remoteIds) || entry.remoteIds.length === 0)
        throw new Error("Invalid weekly receipt.");
      return {
        kind: "receipt",
        id: hash(entry.id),
        remoteIds: entry.remoteIds.map(positive),
      };
    case "seen": {
      const comment = record(entry.comment);
      return {
        kind: "seen",
        comment: {
          id: positive(comment.id),
          issueNumber: positive(comment.issueNumber),
          creatorId: positive(comment.creatorId),
          body: text(comment.body),
          createdAt: text(comment.createdAt),
          updatedAt: text(comment.updatedAt),
          url: text(comment.url),
        },
      };
    }
    default:
      throw new Error("Invalid weekly journal entry.");
  }
}
