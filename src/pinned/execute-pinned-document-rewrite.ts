import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sha256 } from "../checksum.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import {
  createMountedFile,
  replaceMountedFile,
} from "../mounted/replace-mounted-file.js";
import {
  openPinnedDocumentJournal,
  type PinnedDocumentJournalSubject,
} from "./pinned-document-journal.js";
import type {
  CohortPinnedCopies,
  PinnedCopyRewrite,
  PinnedRewritePlan,
  PinnedRewriteReport,
} from "./types.js";

interface ProvenRewrite {
  rewrite: PinnedCopyRewrite;
  target: string;
}

export async function executePinnedDocumentRewrite(input: {
  plan: PinnedRewritePlan;
  cohort: CohortPinnedCopies;
  mode: "preview" | "apply";
}): Promise<PinnedRewriteReport> {
  const summary = {
    schemaVersion: 1,
    command: "pinned rewrite",
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
    if (typeof target === "string") proven.push({ rewrite, target });
    else refusals.push(target.refusal);
  }
  if (refusals.length > 0) {
    return { ...summary, outcome: "refused", rewritten: 0, refusals };
  }

  const journal = await openPinnedDocumentJournal(input.cohort.stateRoot);
  let rewritten = 0;
  for (const { rewrite, target } of proven) {
    const subject: PinnedDocumentJournalSubject = {
      module: rewrite.module,
      semester: rewrite.semester,
      path: rewrite.path,
    };
    const to = sha256(rewrite.expected);
    await journal.append({
      ...subject,
      type: "intent",
      state: rewrite.state,
      from: rewrite.observedSha256,
      to,
    });
    const evidence = await writeCopy(rewrite, target, to);
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

// The write, and the reading that proves it landed. A copy whose bytes are not the ones intended
// is not a rewrite that half-worked; it is one this run cannot claim, so it refuses.
async function writeCopy(
  rewrite: PinnedCopyRewrite,
  target: string,
  expectedSha256: string,
): Promise<string | undefined> {
  try {
    if (rewrite.observedSha256 === null) {
      await createMountedFile({ path: target, contents: rewrite.expected });
    } else {
      await replaceMountedFile({
        path: target,
        contents: rewrite.expected,
        expectedSha256: rewrite.observedSha256,
        readContents: readOptional,
      });
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const written = await readOptional(target);
  return written !== undefined && sha256(written) === expectedSha256
    ? undefined
    : "the copy did not arrive intact.";
}

async function proveTarget(
  rewrite: PinnedCopyRewrite,
  cohort: CohortPinnedCopies,
): Promise<string | { refusal: string }> {
  const where = `${rewrite.module} ${rewrite.path}`;
  const moduleRoot = cohort.moduleRoots.get(rewrite.module);
  if (moduleRoot === undefined) {
    return { refusal: `${where}: no module root is configured.` };
  }
  const target = join(moduleRoot, rewrite.path);
  if (!isContainedBy(moduleRoot, target)) {
    return { refusal: `${where}: the path escapes the module folder.` };
  }
  const metadata = await lstat(target).catch(() => undefined);
  if (rewrite.state === "missing") {
    if (metadata !== undefined) {
      return { refusal: `${where}: the name is already taken.` };
    }
    if (!(await isDirectory(dirname(target)))) {
      return {
        refusal: `${where}: the folder that should hold it is not there, which is structure to seed rather than a copy to rewrite.`,
      };
    }
    return target;
  }
  if (metadata === undefined) {
    return { refusal: `${where}: the copy disappeared after it was read.` };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return { refusal: `${where}: the target is not an ordinary file.` };
  }
  const resolved = await realpath(target).catch(() => undefined);
  if (resolved === undefined || !isContainedBy(cohort.driveMount, resolved)) {
    return {
      refusal: `${where}: the target resolves outside the Drive mount.`,
    };
  }
  const current = await readOptional(target);
  if (current === undefined || sha256(current) !== rewrite.observedSha256) {
    return {
      refusal: `${where}: the copy changed after it was read for this run.`,
    };
  }
  return target;
}

async function isDirectory(path: string): Promise<boolean> {
  const metadata = await lstat(path).catch(() => undefined);
  return metadata?.isDirectory() ?? false;
}

async function readOptional(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch(() => undefined);
}

function publicRewrite(rewrite: PinnedCopyRewrite) {
  const { expected: _expected, observedSha256: _observed, ...rest } = rewrite;
  return rest;
}

function totalCopies(plan: PinnedRewritePlan): number {
  return plan.counts.current + plan.counts.stale + plan.counts.missing;
}
