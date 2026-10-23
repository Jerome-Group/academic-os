import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { SHELF_INDEX_FILENAME } from "./file-shelf-index-store.js";
import { createFileShelfReader } from "./file-shelf-reader.js";
import {
  hasCode,
  observeShelfFile,
  requireShelfRoot,
  sameFile,
} from "./shelf-file-observation.js";
import type { ShelfRun } from "./shelf-run-journal.js";
import type { ShelfRunObservation } from "./types.js";

export async function observeShelfRun(
  run: ShelfRun,
  journal: string,
): Promise<ShelfRunObservation> {
  const paths = [
    join(run.shelfRoot, SHELF_INDEX_FILENAME),
    join(run.shelfRoot, run.probe),
    join(run.shelfRoot, run.proposal),
    ...run.books.flatMap(({ row }) => [
      join(run.shelfRoot, row.source),
      join(run.shelfRoot, row.entry.file),
    ]),
  ];
  const report: ShelfRunObservation = {
    schemaVersion: 1,
    command: "textbooks reconcile",
    runId: run.runId,
    journal,
    state: "partial",
    index: "unknown",
    paths: [...new Set(paths)],
    evidence: [`Expected root ${run.shelfRoot}: ${JSON.stringify(run.root)}.`],
  };
  try {
    await requireShelfRoot(run.shelfRoot, run.root);
    const current = await observeShelfFile(run.shelfRoot, SHELF_INDEX_FILENAME);
    report.evidence.push(`Canonical observation: ${JSON.stringify(current)}.`);
    if (
      run.publication !== null &&
      current !== null &&
      sameFile(current, run.publication.proposal)
    )
      report.index = "published-unconfirmed";
    let allBefore = true;
    let allAfter = true;
    for (const { row, observation } of run.books) {
      const source = await observeShelfFile(run.shelfRoot, row.source);
      report.evidence.push(
        `Book source ${row.source}: ${JSON.stringify(source)}.`,
      );
      if (row.source === row.entry.file) {
        const matching = source !== null && sameFile(source, observation);
        allBefore &&= matching;
        allAfter &&= matching;
      } else {
        const final = await observeShelfFile(run.shelfRoot, row.entry.file);
        report.evidence.push(
          `Book final ${row.entry.file}: ${JSON.stringify(final)}.`,
        );
        allBefore &&=
          source !== null && sameFile(source, observation) && final === null;
        allAfter &&=
          source === null && final !== null && sameFile(final, observation);
      }
    }
    const listing = await createFileShelfReader(run.shelfRoot).listBooks();
    const finalNames = new Map(
      run.books.map(({ row }) => [row.source, row.entry.file]),
    );
    allBefore &&= JSON.stringify(listing) === JSON.stringify(run.listing);
    allAfter &&=
      JSON.stringify(listing) ===
      JSON.stringify(
        run.listing.map((name) => finalNames.get(name) ?? name).sort(),
      );
    const probeAbsent = await absent(join(run.shelfRoot, run.probe));
    if (!probeAbsent)
      report.evidence.push(
        "Retained capability probe needs exact-path inspection; no automatic cleanup.",
      );
    const publication = run.publication;
    if (publication === null) {
      const indexUnchanged =
        run.initialIndex === null
          ? current === null
          : current !== null && sameFile(current, run.initialIndex);
      const proposalAbsent = await absent(join(run.shelfRoot, run.proposal));
      if (allBefore && indexUnchanged && probeAbsent && proposalAbsent) {
        report.state = "unapplied";
        report.index = "not-written";
      } else {
        report.index = "not-written";
        report.evidence.push(
          "Run stopped before publication intent; inspect retained metadata and independent book moves.",
        );
      }
    } else {
      const capture = await observeShelfFile(
        run.shelfRoot,
        publication.capture,
      );
      report.evidence.push(
        `Capture ${publication.capture}: ${JSON.stringify(capture)}.`,
      );
      const canonicalProposal =
        current !== null && sameFile(current, publication.proposal);
      const capturedOriginal =
        publication.original === null
          ? capture === null
          : capture !== null && sameFile(capture, publication.original);
      const canonicalOriginal =
        publication.original === null
          ? current === null
          : current !== null && sameFile(current, publication.original);
      const capturedProposal =
        capture !== null && sameFile(capture, publication.proposal);
      if (canonicalProposal) {
        report.index = "published-unconfirmed";
        if (capturedOriginal && allAfter && probeAbsent) {
          report.state = "applied";
          report.index = "written";
        } else
          report.evidence.push(
            "Proposal is canonical; captured original, books or root cannot be confirmed. Preserve both names.",
          );
      } else if (
        canonicalOriginal &&
        capturedProposal &&
        allBefore &&
        probeAbsent
      ) {
        report.state = "unapplied";
        report.index = "not-written";
      } else {
        report.evidence.push(
          "Recorded original/proposal pair differs. Preserve both names; never repeat the exchange blindly.",
        );
      }
    }
    await requireShelfRoot(run.shelfRoot, run.root);
  } catch (error) {
    report.state = "partial";
    report.evidence.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (report.state !== "partial")
    report.evidence.push(
      `Exact recorded identities and raw hashes prove ${report.state} at this observation.`,
    );
  if (report.state === "partial")
    report.evidence.push(
      "Inspect the listed exact paths and private journal before any new apply. No rollback, unlink or merge was attempted.",
    );
  return report;
}

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true;
    throw error;
  }
}
