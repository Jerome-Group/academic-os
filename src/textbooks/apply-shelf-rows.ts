import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";

import { createFileShelfReader } from "./file-shelf-reader.js";
import {
  appendShelfEntries,
  readShelfIndexDocument,
  SHELF_INDEX_FILENAME,
} from "./file-shelf-index-store.js";
import { observeShelfRun } from "./reconcile-shelf-run.js";
import {
  probeShelfCapabilities,
  writeSyncedShelfFile,
} from "./shelf-capability-probe.js";
import {
  identity,
  observeShelfFile,
  requireShelfRoot,
  sameFile,
  sameIdentity,
  shelfName,
  type ShelfIdentity,
} from "./shelf-file-observation.js";
import { compileShelfNative, runShelfNative } from "./shelf-native.js";
import { appendShelfRun, type ShelfRun } from "./shelf-run-journal.js";
import type {
  ShelfApprovedRow,
  ShelfMigrationReport,
  ShelfMutationEvidence,
} from "./types.js";

type MutationResult =
  | { outcome: "complete"; index: "written"; evidence: ShelfMutationEvidence }
  | {
      outcome: "refused";
      index: "not-written";
      evidence: ShelfMutationEvidence;
    }
  | {
      outcome: "partial";
      index: ShelfMigrationReport["index"];
      evidence: ShelfMutationEvidence;
    };

export async function applyShelfRows(input: {
  shelfRoot: string;
  stateRoot: string;
  root: ShelfIdentity;
  journal: string;
  operation: "migrate" | "catch-up";
  rows: ShelfApprovedRow[];
  listing: string[];
  current: Awaited<ReturnType<typeof readShelfIndexDocument>>;
}): Promise<MutationResult> {
  const runId = randomUUID();
  const evidence: ShelfMutationEvidence = {
    journal: input.journal,
    captures: [],
    renamed: [],
    reasons: [],
  };
  let run: ShelfRun | undefined;
  let effects: "none" | "books" | "index" = "none";
  const root = await open(
    input.shelfRoot,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    if (!sameIdentity(identity(await root.stat({ bigint: true })), input.root))
      throw new Error("Opened Shelf root differs.");
    await requireShelfRoot(input.shelfRoot, input.root);
    const listing = input.listing;
    if (
      JSON.stringify(
        await createFileShelfReader(input.shelfRoot).listBooks(),
      ) !== JSON.stringify(listing)
    )
      throw new Error("Shelf listing changed after planning.");
    const books: ShelfRun["books"] = [];
    for (const row of input.rows) {
      shelfName(row.entry.file);
      if (row.entry.file.startsWith("."))
        throw new Error(
          "A final Shelf book name must remain visible to the Shelf reader.",
        );
      const observation = await observeShelfFile(input.shelfRoot, row.source);
      if (observation === null || observation.sha256 !== row.entry.sha256)
        throw new Error(`Approved Shelf source changed: ${row.source}.`);
      books.push({ row, observation });
    }
    const contents = appendShelfEntries(
      input.current.document,
      input.rows.filter((row) => row.kind === "append"),
    );
    const runtimeParent = join(input.stateRoot, "shelf-runs");
    await mkdir(runtimeParent, { mode: 0o700 }).catch((error: unknown) => {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    });
    const runtimeStat = await lstat(runtimeParent);
    if (
      !runtimeStat.isDirectory() ||
      (await realpath(runtimeParent)) !== runtimeParent ||
      runtimeStat.uid !== process.getuid?.() ||
      (runtimeStat.mode & 0o777) !== 0o700
    )
      throw new Error(
        "Shelf native runtime parent must be canonical, owned and private.",
      );
    const runtime = join(runtimeParent, runId);
    await mkdir(runtime, { mode: 0o700 });
    const binary = await compileShelfNative(runtime);
    run = {
      runId,
      shelfRoot: input.shelfRoot,
      root: input.root,
      operation: input.operation,
      books,
      activeBook: null,
      listing,
      initialIndex: input.current.observation,
      probe: `.academic-os-shelf-probe-${runId}`,
      probeIdentity: null,
      probeFiles: {},
      probeStep: "create",
      proposal: `.academic-os-shelf-index-${runId}.yaml`,
      publication: null,
      phase: "started",
      evidence: [],
    };
    await appendShelfRun(input.journal, run);
    evidence.runId = runId;
    await probeShelfCapabilities({ run, journal: input.journal, binary });
    run.phase = "probe-verified";
    await appendShelfRun(input.journal, run);
    await requireBooks(input.shelfRoot, input.root, books, false, listing);
    await requireIndex(input.shelfRoot, input.current.observation);
    for (const book of books) {
      if (book.row.source === book.row.entry.file) continue;
      await requireBooks(
        input.shelfRoot,
        input.root,
        books,
        false,
        listing,
        evidence.renamed,
      );
      run.phase = "book-intent";
      run.activeBook = book.row.source;
      await appendShelfRun(input.journal, run);
      effects = "books";
      const receipt = await runShelfNative({
        binary,
        rootFd: root.fd,
        root: input.root,
        operation: "exclusive",
        source: book.row.source,
        target: book.row.entry.file,
        sourceIdentity: book.observation,
        targetIdentity: null,
      });
      const final = await observeShelfFile(
        input.shelfRoot,
        book.row.entry.file,
      );
      const source = await observeShelfFile(input.shelfRoot, book.row.source);
      const actual = `Book dispatch ${book.row.source} -> ${book.row.entry.file}: ${JSON.stringify({ receipt, source, final })}.`;
      run.evidence.push(actual);
      run.phase = "book-observed";
      await appendShelfRun(input.journal, run);
      await root.sync();
      await requireShelfRoot(input.shelfRoot, input.root);
      if (
        final !== null &&
        sameFile(final, book.observation) &&
        source === null
      ) {
        evidence.renamed.push({
          from: book.row.source,
          to: book.row.entry.file,
        });
      } else throw new Error(`Book rename differs from approval. ${actual}`);
      if (receipt.kind !== "moved")
        throw new Error(
          `Book native receipt needs reconciliation: ${JSON.stringify(receipt)}.`,
        );
    }
    await requireBooks(input.shelfRoot, input.root, books, true, listing);
    run.phase = "proposal-intent";
    run.activeBook = null;
    await appendShelfRun(input.journal, run);
    const proposal = await writeSyncedShelfFile(
      input.shelfRoot,
      run.proposal,
      contents,
    );
    const observedProposal = await observeShelfFile(
      input.shelfRoot,
      run.proposal,
    );
    evidence.captures.push(join(input.shelfRoot, run.proposal));
    if (
      observedProposal === null ||
      !sameFile(proposal, observedProposal) ||
      (input.current.observation !== null &&
        sameIdentity(proposal, input.current.observation))
    )
      throw new Error(
        "Shelf proposal identity is unavailable or aliases original.",
      );
    run.publication = {
      operation: input.current.observation === null ? "exclusive" : "exchange",
      capture: run.proposal,
      original: input.current.observation,
      proposal,
    };
    await requireBooks(input.shelfRoot, input.root, books, true, listing);
    await requireIndex(input.shelfRoot, input.current.observation);
    run.phase = "publication-intent";
    await appendShelfRun(input.journal, run);
    effects = "index";
    const receipt = await runShelfNative({
      binary,
      rootFd: root.fd,
      root: input.root,
      operation: run.publication.operation,
      source: run.proposal,
      target: SHELF_INDEX_FILENAME,
      sourceIdentity: proposal,
      targetIdentity: input.current.observation,
    });
    await root.sync();
    const observation = await observeShelfRun(run, input.journal);
    if (run.publication.original === null && observation.state === "applied")
      evidence.captures = [];
    run.phase = "observed";
    run.evidence = [
      ...observation.evidence,
      `Publication native receipt: ${JSON.stringify(receipt)}.`,
    ];
    await appendShelfRun(input.journal, run);
    if (observation.state !== "applied" || receipt.kind !== "moved") {
      evidence.recovery = observation;
      throw new Error(
        `Shelf publication needs reconciliation: ${JSON.stringify(receipt)}; ${observation.evidence.join(" ")}`,
      );
    }
    run.phase = "complete";
    await appendShelfRun(input.journal, run);
    return { outcome: "complete", index: "written", evidence };
  } catch (error) {
    evidence.reasons.push(
      error instanceof Error ? error.message : String(error),
    );
    if (run === undefined)
      return { outcome: "refused", index: "not-written", evidence };
    const recovery = await observeShelfRun(run, input.journal);
    evidence.recovery = recovery;
    const partial = effects !== "none" || recovery.state === "partial";
    run.phase = partial ? "partial" : "refused";
    run.evidence.push(...evidence.reasons);
    try {
      await appendShelfRun(input.journal, run);
    } catch (error) {
      evidence.reasons.push(
        `Outcome journal unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        outcome: "partial",
        index: effects === "index" ? recovery.index : "not-written",
        evidence,
      };
    }
    if (!partial) return { outcome: "refused", index: "not-written", evidence };
    return {
      outcome: "partial",
      index:
        effects === "index"
          ? recovery.index === "written"
            ? "published-unconfirmed"
            : recovery.index
          : "not-written",
      evidence,
    };
  } finally {
    await root.close();
  }
}

async function requireBooks(
  root: string,
  expected: ShelfIdentity,
  books: ShelfRun["books"],
  final: boolean,
  listing: string[],
  renamed: ShelfMutationEvidence["renamed"] = [],
): Promise<void> {
  await requireShelfRoot(root, expected);
  const moved = new Map(renamed.map((row) => [row.from, row.to]));
  const finalNames = new Map(
    books.map(({ row }) => [row.source, row.entry.file]),
  );
  const expectedListing = listing
    .map((name) =>
      final ? (finalNames.get(name) ?? name) : (moved.get(name) ?? name),
    )
    .sort();
  if (
    JSON.stringify(await createFileShelfReader(root).listBooks()) !==
    JSON.stringify(expectedListing)
  )
    throw new Error("Shelf listing changed during apply.");
  for (const { row, observation } of books) {
    const name = final ? row.entry.file : (moved.get(row.source) ?? row.source);
    const current = await observeShelfFile(root, name);
    if (current === null || !sameFile(current, observation))
      throw new Error(`Approved Shelf bytes or identity changed: ${name}.`);
    if (
      name !== row.source &&
      (await observeShelfFile(root, row.source)) !== null
    )
      throw new Error(`New source arrival after rename: ${row.source}.`);
  }
  await requireShelfRoot(root, expected);
}

async function requireIndex(
  root: string,
  expected: ShelfRun["initialIndex"],
): Promise<void> {
  const current = await observeShelfFile(root, SHELF_INDEX_FILENAME);
  if (
    expected === null
      ? current !== null
      : current === null || !sameFile(current, expected)
  )
    throw new Error("Shelf index changed before publication.");
}
