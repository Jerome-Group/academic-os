export { readRepositoryRepairStatus } from "./repository-repair-state.js";

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { createRepositoryRepairPorts } from "./repository-repair-adapters.js";
import {
  REQUIRED_REPOSITORY_CHECKS,
  type RepositoryCandidate,
  type RepositoryPullRequestState,
  type RepositoryRepairPorts,
  type RepositoryRepairReport,
  type RepositoryReview,
} from "./repository-repair-types.js";

export type {
  RepositoryRepairPorts,
  RepositoryRepairReport,
} from "./repository-repair-types.js";

export function eligibleRepositoryRepairPaths(
  paths: readonly string[],
): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        !path.includes("\\") &&
        !path.split("/").includes("..") &&
        !/(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|CONTEXT\.md|SECURITY\.md)$/u.test(
          path,
        ) &&
        !/^(?:src|test)\/(?:privacy|contract|conformance|mounted|config|capabilities|repair|drive|tasks|calendar|operations|launchd|pinned|seed)\//u.test(
          path,
        ) &&
        !/(?:^|\/)(?:check-[^/]+|build-cheatsheet-skill-runtime|compile-seed-templates)\.[cm]?[jt]s$/u.test(
          path,
        ) &&
        !/(?:auth|credential|security|sandbox|permissions|safe-drive|repository-repair|codex-module-session|maintenance-safety|write-journal|morning-session-prompt|module-maintenance-work-order|session-settings|cohort-prelude|run-morning-routine|render-public-morning-report|weekly-review|file-weekly-evidence)/iu.test(
          path,
        ) &&
        /^(?:src\/|test\/|scripts\/|docs\/agents\/capabilities\.md$)/u.test(
          path,
        ) &&
        /\.(?:[cm]?[jt]s|md)$/u.test(path),
    )
  );
}

export async function runRepositoryRepair(input: {
  repositoryRoot: string;
  privateStateRoot: string;
  codexPath: string;
  ghPath: string;
  checkOnly?: boolean;
  clock?: () => Date;
  ports?: RepositoryRepairPorts;
}): Promise<RepositoryRepairReport> {
  const result = (
    outcome: RepositoryRepairReport["outcome"],
    extra: Partial<RepositoryRepairReport> = {},
  ): RepositoryRepairReport => ({
    schemaVersion: 1,
    outcome,
    modelAttestation: "unverified",
    ...extra,
  });
  const repositoryRoot = await realpath(input.repositoryRoot);
  if (!isAbsolute(input.privateStateRoot))
    return result("blocked", { code: "invalid-private-state" });
  await mkdir(input.privateStateRoot, { recursive: true, mode: 0o700 });
  const privateRoot = await realpath(input.privateStateRoot);
  const rel = relative(repositoryRoot, privateRoot);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
    return result("blocked", { code: "private-state-in-repository" });
  const directory = join(privateRoot, "repository-repair");
  await mkdir(directory, { mode: 0o700, recursive: true });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.getuid?.()
  )
    return result("blocked", { code: "unsafe-private-directory" });
  const existingState = join(directory, "state.json");
  try {
    const m = await lstat(existingState);
    if (
      !m.isFile() ||
      m.isSymbolicLink() ||
      (m.mode & 0o777) !== 0o600 ||
      m.uid !== process.getuid?.()
    )
      return result("blocked", { code: "unsafe-private-state" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lockPath = join(directory, "run.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined;
      throw error;
    },
  );
  if (lock === undefined)
    return result("busy", { code: "lock-reconciliation-required" });
  const id = randomUUID();
  const evidence = join(directory, id);
  await mkdir(evidence, { mode: 0o700 });
  await lock.writeFile(JSON.stringify({ pid: process.pid, id }));
  const statePath = join(directory, "state.json");
  let fingerprint: string | undefined;
  let issue: number | undefined;
  let pullRequest: number | undefined;
  let head: string | undefined;
  let mergeCommit: string | undefined;
  let terminal = false;
  let mutationBegun = false;
  let candidateState: RepositoryCandidate | undefined;
  let verifiedRollout:
    | { postmergeVerified: boolean; rolledOut: boolean }
    | undefined;
  const ports =
    input.ports ?? createRepositoryRepairPorts({ ...input, repositoryRoot });
  async function stage(name: string, data: object = {}): Promise<void> {
    const observedAt = (input.clock ?? (() => new Date()))().toISOString();
    await writeFile(
      join(evidence, `${name}.json`),
      JSON.stringify({
        observedAt,
        id,
        fingerprint,
        issue,
        pullRequest,
        head,
        mergeCommit,
        ...data,
      }),
      { flag: "wx", mode: 0o600 },
    );
    if (input.checkOnly) return;
    await writeFile(
      statePath,
      JSON.stringify({
        observedAt,
        id,
        evidence,
        fingerprint,
        issue,
        pullRequest,
        head,
        mergeCommit,
        candidate: candidateState,
        stage: name,
        ...data,
      }),
      { mode: 0o600 },
    );
  }
  async function finishPublished(
    candidate: RepositoryCandidate,
    base: string,
    failureFingerprint: string,
    repairIssue: number,
    pr: number,
    repairHead: string,
    reviews: RepositoryReview[],
  ): Promise<RepositoryRepairReport> {
    const remote = await ports.pullRequest(pr);
    if (!repositoryMergeReady(remote, repairHead, base)) {
      await stage("publish-intent-resumed", { reviews });
      await stage("awaiting-checks", {
        code: "protected-merge-not-ready",
        reviews,
      });
      terminal = true;
      return result("blocked", {
        code: "protected-merge-not-ready",
        fingerprint: failureFingerprint,
        issue: repairIssue,
        pullRequest: pr,
        head: repairHead,
        evidence,
      });
    }
    await stage("merge-intent", { head: repairHead, pullRequest: pr });
    mergeCommit = await ports.merge(pr, repairHead);
    if (!(await ports.merged(pr, repairHead, mergeCommit))) {
      await stage("merge-unknown", { mergeCommit });
      return result("blocked", {
        code: "merge-reconciliation-required",
        fingerprint: failureFingerprint,
        issue: repairIssue,
        pullRequest: pr,
        head: repairHead,
        mergeCommit,
        evidence,
      });
    }
    await stage("merged", { mergeCommit });
    const rollout = await ports.rollout(candidate, base, mergeCommit, evidence);
    verifiedRollout = rollout;
    await stage("conclude-intent", { mergeCommit, ...rollout });
    await ports.conclude({
      issue: repairIssue,
      fingerprint: failureFingerprint,
      pullRequest: pr,
      mergeCommit,
      ...rollout,
    });
    await stage("finished", { mergeCommit, ...rollout });
    terminal = true;
    return result(rollout.rolledOut ? "merged" : "blocked", {
      ...(rollout.rolledOut ? {} : { code: "postmerge-rollout-blocked" }),
      fingerprint: failureFingerprint,
      issue: repairIssue,
      pullRequest: pr,
      head: repairHead,
      mergeCommit,
      postmergeVerification: rollout.postmergeVerified ? "passed" : "blocked",
      rolloutVerification: rollout.rolledOut ? "passed" : "blocked",
      evidence,
    });
  }
  try {
    let previous:
      | {
          fingerprint?: string;
          stage: string;
          issue?: number;
          pullRequest?: number;
          head?: string;
          evidence?: string;
          candidate?: RepositoryCandidate;
        }
      | undefined;
    try {
      previous = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return result("blocked", {
          code: "state-reconciliation-required",
          evidence,
        });
    }
    if (
      previous?.stage === "awaiting-checks" &&
      previous.fingerprint &&
      previous.issue &&
      previous.pullRequest &&
      previous.head &&
      previous.candidate &&
      previous.evidence &&
      !input.checkOnly
    ) {
      mutationBegun = true;
      fingerprint = previous.fingerprint;
      issue = previous.issue;
      pullRequest = previous.pullRequest;
      head = previous.head;
      candidateState = previous.candidate;
      const receipt = JSON.parse(
        await readFile(join(previous.evidence, "publish-intent.json"), "utf8"),
      ) as {
        reviews: {
          head: string;
          approved: boolean;
          findings: string[];
          reviewer: string;
        }[];
      };
      if (
        receipt.reviews.length !== 2 ||
        new Set(receipt.reviews.map((r) => r.reviewer)).size !== 2 ||
        receipt.reviews.some(
          (r) => r.head !== head || !r.approved || r.findings.length > 0,
        )
      )
        return result("blocked", {
          code: "review-reconciliation-required",
          evidence,
        });
      await stage("publish-intent", { head, reviews: receipt.reviews });
      return await finishPublished(
        candidateState,
        candidateState.base,
        fingerprint,
        issue,
        pullRequest,
        head,
        receipt.reviews,
      );
    }
    if (
      previous &&
      !["finished", "healthy", "blocked", "awaiting-checks"].includes(
        previous.stage,
      )
    )
      return result("blocked", {
        code: "interrupted-reconciliation-required",
        evidence,
      });
    const snapshot = await ports.snapshot();
    if (!snapshot.clean) {
      await stage("blocked", { code: "primary-checkout-not-clean" });
      terminal = true;
      return result("blocked", {
        code: "primary-checkout-not-clean",
        evidence,
      });
    }
    const candidate = await ports.createCandidate({
      base: snapshot.base,
      directory: join(evidence, "checkout"),
      branch: `codex/daily-repair-${id}`,
    });
    candidateState = candidate;
    const baseline = await ports.checks(candidate, join(evidence, "baseline"));
    if (baseline.passed) {
      const cleanup: Partial<RepositoryRepairReport> = {};
      if (ports.releaseCandidate) {
        const released = await ports
          .releaseCandidate(candidate)
          .catch(() => false);
        cleanup.candidateCleanup = released ? "released" : "retained";
        if (!released) cleanup.code = "healthy-candidate-cleanup-refused";
      }
      await stage("healthy", { baseline, ...cleanup });
      terminal = true;
      return result("healthy", { evidence, ...cleanup });
    }
    fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          base: snapshot.base,
          tools: snapshot.toolsDigest,
          checks: baseline.actions.map((x) => ({
            action: x.action,
            exitCode: x.exitCode,
            signature: x.failureSignature ?? x.outputSha256,
          })),
        }),
      )
      .digest("hex");
    if (baseline.diagnosticsComplete === false) {
      await stage("blocked", { code: "diagnostics-truncated" });
      terminal = true;
      return result("blocked", {
        code: "diagnostics-truncated",
        fingerprint,
        evidence,
      });
    }
    if (input.checkOnly) {
      await stage("blocked", { code: "checks-failed", baseline });
      terminal = true;
      return result("blocked", {
        code: "checks-failed",
        fingerprint,
        evidence,
      });
    }
    if (previous?.fingerprint === fingerprint) {
      await stage("blocked", { code: "unchanged-failure", baseline });
      terminal = true;
      return result("unchanged", { fingerprint, evidence });
    }
    mutationBegun = true;
    await stage("issue-intent", { baseline });
    issue = await ports.issue(fingerprint);
    await stage("issue-created", { issue });
    await ports.implement(candidate, evidence);
    const changes = await ports.changes(candidate);
    if (
      !eligibleRepositoryRepairPaths(changes.paths) ||
      changes.unsafeEntries ||
      !changes.regression
    ) {
      await stage("blocked", { code: "ineligible-repair-scope", changes });
      terminal = true;
      return result("blocked", {
        code: "ineligible-repair-scope",
        fingerprint,
        issue,
        evidence,
      });
    }
    head = await ports.commit(candidate);
    const verification = await ports.checks(
      candidate,
      join(evidence, "verification"),
    );
    if (!verification.passed) {
      await stage("blocked", { code: "candidate-checks-failed", verification });
      terminal = true;
      return result("blocked", {
        code: "candidate-checks-failed",
        fingerprint,
        issue,
        evidence,
      });
    }
    const reviews = [];
    for (let n = 0; n < 2; n++)
      reviews.push(
        await ports.review(candidate, head, join(evidence, `review-${n}`)),
      );
    if (
      reviews.some(
        (r) => !r.approved || r.head !== head || r.findings.length > 0,
      ) ||
      new Set(reviews.map((r) => r.reviewer)).size !== 2
    ) {
      await stage("blocked", { code: "independent-review-failed", reviews });
      terminal = true;
      return result("blocked", {
        code: "independent-review-failed",
        fingerprint,
        issue,
        head,
        evidence,
      });
    }
    await stage("publish-intent", { head, reviews });
    pullRequest = await ports.publish(candidate, issue, head);
    await stage("published", { head, pullRequest });
    return await finishPublished(
      candidate,
      snapshot.base,
      fingerprint,
      issue,
      pullRequest,
      head,
      reviews,
    );
  } catch {
    if (!mutationBegun) {
      await stage("blocked", { code: "repository-preflight-unavailable" });
      terminal = true;
      return result("blocked", {
        code: "repository-preflight-unavailable",
        evidence,
      });
    }
    return result("blocked", {
      code: "repair-stage-failed-reconciliation-required",
      ...(fingerprint ? { fingerprint } : {}),
      ...(issue ? { issue } : {}),
      ...(pullRequest ? { pullRequest } : {}),
      ...(head ? { head } : {}),
      ...(mergeCommit
        ? ({
            mergeCommit,
            postmergeVerification: verifiedRollout?.postmergeVerified
              ? "passed"
              : "blocked",
            rolloutVerification: verifiedRollout?.rolledOut
              ? "passed"
              : "blocked",
          } as const)
        : {}),
      evidence,
    });
  } finally {
    await lock.close();
    if (terminal) await unlink(lockPath);
  }
}

export function repositoryMergeReady(
  remote: RepositoryPullRequestState,
  head: string,
  base: string,
): boolean {
  return (
    remote.open &&
    remote.owned &&
    remote.ready &&
    remote.unresolvedThreads === 0 &&
    remote.head === head &&
    remote.base === base &&
    REQUIRED_REPOSITORY_CHECKS.every((name) =>
      remote.checks.some(
        (c) => c.name === name && c.head === head && c.state === "SUCCESS",
      ),
    )
  );
}
