import { sha256 } from "../checksum.js";
import { firstDifference } from "../conformance/first-difference.js";
import type { ResearchProjectControls } from "../conformance/index.js";
import type { ResearchProjectContract } from "../conformance/research-project-contract.js";
import { researchProjectSharedControlPaths } from "../contract/research-project-structure.js";
import type { ResolvedConfiguredResearchProjectRoots } from "../mounted/resolve-configured-research-project-roots.js";
import { backupPinnedCopy } from "./backup-pinned-copy.js";
import {
  provePinnedCopyTarget,
  type ProvenPinnedCopyTarget,
  writePinnedCopy,
} from "./pinned-copy-io.js";
import { openPinnedDocumentJournal } from "./pinned-document-journal.js";
import type { PinnedCopyState, PinnedRefreshOutcome } from "./types.js";

export interface ResearchSharedControlRewrite {
  project: string;
  path: string;
  state: Exclude<PinnedCopyState, "current">;
  evidence: string;
  observedSha256: string | null;
  expected: string;
}

export interface ResearchSharedControlRefreshPlan {
  outcome: PinnedCopyState;
  counts: Record<PinnedCopyState, number>;
  rewrites: ResearchSharedControlRewrite[];
}

export interface ResearchSharedControlRefreshReport {
  schemaVersion: 1;
  command: "pinned refresh";
  target: { kind: "research-project"; key: string };
  mode: "preview" | "apply";
  outcome: PinnedRefreshOutcome;
  counts: Record<PinnedCopyState, number>;
  rewrites: Array<
    Omit<ResearchSharedControlRewrite, "expected" | "observedSha256">
  >;
  unresolved: [];
  rewritten: number;
  refusals: string[];
  journal?: string;
}

export function planResearchSharedControlRefresh(input: {
  contract: ResearchProjectContract;
  projectKey: string;
  projectFolder: string;
  controls: ResearchProjectControls;
}): ResearchSharedControlRefreshPlan {
  const counts: Record<PinnedCopyState, number> = {
    current: 0,
    stale: 0,
    missing: 0,
  };
  const rewrites: ResearchSharedControlRewrite[] = [];
  for (const path of researchProjectSharedControlPaths) {
    const template = input.contract.seedFiles[path];
    if (template === undefined) {
      throw new Error(`Research shared-control seed is missing: ${path}.`);
    }
    const expected = template.replaceAll(
      "{{PROJECT_NAME}}",
      input.projectFolder,
    );
    const copy = input.controls.sharedControls?.[path];
    const state =
      copy === undefined ? "missing" : copy === expected ? "current" : "stale";
    counts[state] += 1;
    if (state === "current") continue;
    rewrites.push({
      project: input.projectKey,
      path,
      state,
      evidence:
        copy === undefined
          ? `No readable copy exists at ${path}.`
          : `Shared control differs from its generalized seed at ${firstDifference(copy, expected)}.`,
      observedSha256: copy === undefined ? null : sha256(copy),
      expected,
    });
  }
  return {
    outcome:
      counts.missing > 0 ? "missing" : counts.stale > 0 ? "stale" : "current",
    counts,
    rewrites,
  };
}

export async function executeResearchSharedControlRefresh(input: {
  plan: ResearchSharedControlRefreshPlan;
  target: ResolvedConfiguredResearchProjectRoots;
  mode: "preview" | "apply";
}): Promise<ResearchSharedControlRefreshReport> {
  const summary = {
    schemaVersion: 1,
    command: "pinned refresh",
    target: { kind: "research-project", key: input.target.project.key },
    mode: input.mode,
    counts: input.plan.counts,
    rewrites: input.plan.rewrites.map(publicRewrite),
    unresolved: [] as [],
  } as const;
  if (input.mode === "preview" || input.plan.rewrites.length === 0) {
    return {
      ...summary,
      outcome: input.plan.outcome,
      rewritten: 0,
      refusals: [],
    };
  }

  const proven: Array<{
    rewrite: ResearchSharedControlRewrite;
    target: ProvenPinnedCopyTarget;
    original?: Uint8Array;
  }> = [];
  const refusals: string[] = [];
  for (const rewrite of input.plan.rewrites) {
    const result = await proveResearchTarget(rewrite, input.target);
    if ("target" in result) proven.push({ rewrite, ...result });
    else refusals.push(result.refusal);
  }
  if (refusals.length > 0) {
    return { ...summary, outcome: "refused", rewritten: 0, refusals };
  }

  const journal = await openPinnedDocumentJournal(input.target.stateRoot);
  const backups = new Map<string, string>();
  try {
    for (const { rewrite, original } of proven) {
      if (original === undefined || rewrite.observedSha256 === null) continue;
      const backup = await backupPinnedCopy({
        stateRoot: input.target.stateRoot,
        runId: journal.runId,
        targetKind: "research-projects",
        targetKey: rewrite.project,
        relativePath: rewrite.path,
        contents: original,
        expectedSha256: rewrite.observedSha256,
      });
      backups.set(rewrite.path, backup);
      await journal.append({
        researchProject: rewrite.project,
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
    const subject = {
      researchProject: rewrite.project,
      path: rewrite.path,
    };
    const to = sha256(rewrite.expected);
    const backup = backups.get(rewrite.path);
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
        outcome: rewritten === 0 ? "refused" : "partially-rewritten",
        rewritten,
        refusals: [`${rewrite.project} ${rewrite.path}: ${evidence}`],
        journal: journal.path,
      };
    }
    await journal.append({ ...subject, type: "result", outcome: "rewritten" });
    rewritten += 1;
  }
  return {
    ...summary,
    outcome: "current",
    counts: {
      current: input.plan.counts.current + input.plan.rewrites.length,
      stale: 0,
      missing: 0,
    },
    rewritten,
    refusals: [],
    journal: journal.path,
  };
}

async function proveResearchTarget(
  rewrite: ResearchSharedControlRewrite,
  target: ResolvedConfiguredResearchProjectRoots,
): Promise<
  | { target: ProvenPinnedCopyTarget; original?: Uint8Array }
  | { refusal: string }
> {
  return await provePinnedCopyTarget({
    rewrite,
    root: target.projectRoot,
    driveMount: target.driveMount,
    relativePath: rewrite.path,
    label: `${rewrite.project} ${rewrite.path}`,
    missingParentEvidence:
      "the parent folder is absent; seed structure before refreshing controls.",
  });
}

function publicRewrite(rewrite: ResearchSharedControlRewrite) {
  const { expected: _expected, observedSha256: _observed, ...rest } = rewrite;
  return rest;
}
