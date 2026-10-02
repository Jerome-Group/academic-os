import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryRepairReport } from "./repository-repair-types.js";
export async function readRepositoryRepairStatus(
  privateStateRoot: string,
): Promise<{
  schemaVersion: 1;
  outcome: "unobserved" | "observed" | "blocked";
  report?: RepositoryRepairReport;
  stage?: string;
  code?: string;
  observedAt?: string;
  evidenceScope?: "historical";
}> {
  let stateObserved = false;
  const fail = () => ({
    schemaVersion: 1 as const,
    outcome: "blocked" as const,
    code: "invalid-state-evidence",
  });
  try {
    const directory = join(
        await realpath(privateStateRoot),
        "repository-repair",
      ),
      dm = await lstat(directory);
    if (!dm.isDirectory() || dm.isSymbolicLink() || (dm.mode & 0o777) !== 0o700)
      return fail();
    const statePath = join(directory, "state.json"),
      sm = await lstat(statePath);
    if (!sm.isFile() || sm.isSymbolicLink() || (sm.mode & 0o777) !== 0o600)
      return fail();
    stateObserved = true;
    const value = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof value.stage !== "string" ||
      !/^[-a-z]+$/u.test(value.stage) ||
      typeof value.evidence !== "string" ||
      typeof value.id !== "string"
    )
      return fail();
    const em = await lstat(value.evidence),
      evidence = await realpath(value.evidence);
    if (
      !em.isDirectory() ||
      em.isSymbolicLink() ||
      (em.mode & 0o777) !== 0o700 ||
      !evidence.startsWith(`${directory}/`)
    )
      return fail();
    const receiptPath = join(evidence, `${value.stage}.json`),
      fm = await lstat(receiptPath);
    if (!fm.isFile() || fm.isSymbolicLink() || (fm.mode & 0o777) !== 0o600)
      return fail();
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      receipt.id !== value.id ||
      typeof receipt.observedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.observedAt))
    )
      return fail();
    for (const key of [
      "head",
      "mergeCommit",
      "issue",
      "pullRequest",
      "fingerprint",
      "rolledOut",
      "postmergeVerified",
    ])
      if (
        value[key] !== undefined &&
        value[key] !== receipt[key] &&
        !(key === "mergeCommit" && value[key] === receipt.merge)
      )
        return fail();
    let outcome: RepositoryRepairReport["outcome"] = "blocked";
    if (value.stage === "healthy") {
      const baseline = receipt.baseline as
        | { passed?: unknown; actions?: { exitCode: unknown }[] }
        | undefined;
      if (
        baseline?.passed !== true ||
        !Array.isArray(baseline.actions) ||
        baseline.actions.length === 0 ||
        baseline.actions.some((a) => a.exitCode !== 0)
      )
        return fail();
      outcome = "healthy";
    }
    if (value.stage === "finished" && value.rolledOut === true) {
      if (
        value.postmergeVerified !== true ||
        typeof value.mergeCommit !== "string" ||
        !/^[a-f0-9]{40}$/u.test(value.mergeCommit) ||
        !Number.isSafeInteger(value.issue) ||
        !Number.isSafeInteger(value.pullRequest)
      )
        return fail();
      outcome = "merged";
    }
    const report: RepositoryRepairReport = {
      schemaVersion: 1,
      outcome,
      modelAttestation: "unverified",
      evidence,
    };
    for (const key of ["code", "fingerprint", "head", "mergeCommit"] as const)
      if (typeof value[key] === "string") report[key] = value[key];
    for (const key of ["issue", "pullRequest"] as const)
      if (Number.isSafeInteger(value[key])) report[key] = value[key] as number;
    if (["released", "retained"].includes(String(receipt.candidateCleanup)))
      report.candidateCleanup = receipt.candidateCleanup as
        | "released"
        | "retained";
    if (report.mergeCommit) {
      report.postmergeVerification =
        value.postmergeVerified === true ? "passed" : "blocked";
      report.rolloutVerification =
        value.rolledOut === true ? "passed" : "blocked";
    }
    return {
      schemaVersion: 1,
      outcome: "observed",
      report,
      stage: value.stage,
      observedAt: receipt.observedAt,
      evidenceScope: "historical",
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      outcome:
        (error as NodeJS.ErrnoException).code === "ENOENT" && !stateObserved
          ? "unobserved"
          : "blocked",
      code: "state-evidence-unavailable",
    };
  }
}
