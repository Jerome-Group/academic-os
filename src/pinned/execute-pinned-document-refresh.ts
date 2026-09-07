import { sha256 } from "../checksum.js";
import { backupPinnedCopy } from "./backup-pinned-copy.js";
import {
  provePinnedCopyTarget,
  type ProvenPinnedCopyTarget,
  writePinnedCopy,
} from "./pinned-copy-io.js";
import {
  openPinnedDocumentJournal,
  type PinnedDocumentJournalSubject,
} from "./pinned-document-journal.js";
import type {
  CohortPinnedCopies,
  PinnedCopyRewrite,
  PinnedRefreshPlan,
  PinnedRefreshReport,
} from "./types.js";

interface ProvenRewrite {
  rewrite: PinnedCopyRewrite;
  target: ProvenPinnedCopyTarget;
  original?: Uint8Array;
}

export async function executePinnedDocumentRefresh(input: {
  plan: PinnedRefreshPlan;
  cohort: CohortPinnedCopies;
  mode: "preview" | "apply";
}): Promise<PinnedRefreshReport> {
  const summary = {
    schemaVersion: 1,
    command: "pinned refresh",
    mode: input.mode,
    counts: input.plan.counts,
    rewrites: input.plan.rewrites.map(publicRewrite),
    unresolved: input.cohort.unresolved,
  } as const;

  if (input.mode === "preview" || input.plan.rewrites.length === 0) {
    return {
      ...summary,
      outcome: input.plan.outcome,
      rewritten: 0,
      refusals: [],
    };
  }

  // Nothing is written until every target has proved itself, so one moved file refuses the run
  // rather than leaving a cohort half-rewritten.
  const proven: ProvenRewrite[] = [];
  const refusals: string[] = [];
  for (const rewrite of input.plan.rewrites) {
    const target = await proveTarget(rewrite, input.cohort);
    if ("target" in target) proven.push({ rewrite, ...target });
    else refusals.push(target.refusal);
  }
  if (refusals.length > 0) {
    return { ...summary, outcome: "refused", rewritten: 0, refusals };
  }

  const journal = await openPinnedDocumentJournal(input.cohort.stateRoot);
  const backups = new Map<string, string>();
  try {
    for (const { rewrite, original } of proven) {
      if (original === undefined || rewrite.observedSha256 === null) continue;
      const key = `${rewrite.module}\0${rewrite.path}`;
      const backup = await backupPinnedCopy({
        stateRoot: input.cohort.stateRoot,
        runId: journal.runId,
        targetKind: "modules",
        targetKey: rewrite.module,
        relativePath: rewrite.path,
        contents: original,
        expectedSha256: rewrite.observedSha256,
      });
      backups.set(key, backup);
      await journal.append({
        module: rewrite.module,
        semester: rewrite.semester,
        path: rewrite.path,
        type: "backup",
        from: rewrite.observedSha256,
        backup,
      });
    }
  } catch (error) {
    return {
      ...summary,
      outcome: "refused",
      rewritten: 0,
      refusals: [error instanceof Error ? error.message : String(error)],
      journal: journal.path,
    };
  }
  let rewritten = 0;
  for (const { rewrite, target } of proven) {
    const subject: PinnedDocumentJournalSubject = {
      module: rewrite.module,
      semester: rewrite.semester,
      path: rewrite.path,
    };
    const to = sha256(rewrite.expected);
    const backup = backups.get(`${rewrite.module}\0${rewrite.path}`);
    await journal.append({
      ...subject,
      type: "intent",
      state: rewrite.state,
      from: rewrite.observedSha256,
      to,
      ...(backup === undefined ? {} : { backup }),
    });
    const evidence = await writePinnedCopy(rewrite, target);
    if (evidence !== undefined) {
      await journal.append({ ...subject, type: "refused", evidence });
      return {
        ...summary,
        // Earlier copies in this run are already written, and no rollback can unwrite them without
        // holding every original. The journal is the record of how far it got.
        outcome: rewritten === 0 ? "refused" : "partially-rewritten",
        rewritten,
        refusals: [`${rewrite.module} ${rewrite.path}: ${evidence}`],
        journal: journal.path,
      };
    }
    await journal.append({ ...subject, type: "result", outcome: "rewritten" });
    rewritten += 1;
  }
  return {
    ...summary,
    outcome: "current",
    counts: { current: totalCopies(input.plan), stale: 0, missing: 0 },
    rewritten,
    refusals: [],
    journal: journal.path,
  };
}

async function proveTarget(
  rewrite: PinnedCopyRewrite,
  cohort: CohortPinnedCopies,
): Promise<
  | { target: ProvenPinnedCopyTarget; original?: Uint8Array }
  | { refusal: string }
> {
  const where = `${rewrite.module} ${rewrite.path}`;
  const moduleRoot = cohort.moduleRoots.get(rewrite.module);
  if (moduleRoot === undefined) {
    return { refusal: `${where}: no module root is configured.` };
  }
  return await provePinnedCopyTarget({
    rewrite,
    root: moduleRoot,
    driveMount: cohort.driveMount,
    relativePath: rewrite.path,
    label: where,
    missingParentEvidence:
      "the folder that should hold it is not there, which is structure to seed rather than a copy to rewrite.",
  });
}

function publicRewrite(rewrite: PinnedCopyRewrite) {
  const { expected: _expected, observedSha256: _observed, ...rest } = rewrite;
  return rest;
}

function totalCopies(plan: PinnedRefreshPlan): number {
  return plan.counts.current + plan.counts.stale + plan.counts.missing;
}
