export interface RepositoryRepairReport {
  schemaVersion: 1;
  outcome: "healthy" | "merged" | "blocked" | "unchanged" | "busy";
  code?: string;
  fingerprint?: string;
  issue?: number;
  pullRequest?: number;
  head?: string;
  mergeCommit?: string;
  postmergeVerification?: "passed" | "blocked";
  rolloutVerification?: "passed" | "blocked";
  evidence?: string;
  modelAttestation: "unverified";
}

export interface RepositoryCheckEvidence {
  passed: boolean;
  diagnosticsComplete?: boolean;
  digest: string;
  actions: {
    action: string;
    exitCode: number | null;
    outputSha256: string;
    failureSignature?: string;
    outputTruncated?: boolean;
  }[];
}

export interface RepositoryCandidate {
  root: string;
  branch: string;
  base: string;
}

export interface RepositoryReview {
  head: string;
  reviewer: string;
  approved: boolean;
  findings: string[];
}

export interface RepositoryPullRequestState {
  head: string;
  base: string;
  open: boolean;
  owned: boolean;
  ready: boolean;
  unresolvedThreads: number;
  checks: { name: string; head: string; state: string }[];
}

export interface RepositoryRepairPorts {
  snapshot(): Promise<{ base: string; clean: boolean; toolsDigest: string }>;
  createCandidate(input: {
    base: string;
    directory: string;
    branch: string;
  }): Promise<RepositoryCandidate>;
  checks(
    candidate: RepositoryCandidate,
    evidence: string,
  ): Promise<RepositoryCheckEvidence>;
  issue(fingerprint: string): Promise<number>;
  implement(candidate: RepositoryCandidate, evidence: string): Promise<void>;
  changes(
    candidate: RepositoryCandidate,
  ): Promise<{ paths: string[]; unsafeEntries: boolean; regression: boolean }>;
  commit(candidate: RepositoryCandidate): Promise<string>;
  review(
    candidate: RepositoryCandidate,
    head: string,
    evidence: string,
  ): Promise<RepositoryReview>;
  publish(
    candidate: RepositoryCandidate,
    issue: number,
    head: string,
  ): Promise<number>;
  pullRequest(number: number): Promise<RepositoryPullRequestState>;
  merge(number: number, head: string): Promise<string>;
  merged(number: number, head: string, merge: string): Promise<boolean>;
  conclude(input: {
    issue: number;
    fingerprint: string;
    pullRequest: number;
    mergeCommit: string;
    postmergeVerified: boolean;
    rolledOut: boolean;
  }): Promise<void>;
  rollout(
    candidate: RepositoryCandidate,
    originalBase: string,
    merge: string,
    evidence: string,
  ): Promise<{ postmergeVerified: boolean; rolledOut: boolean }>;
}

export const REQUIRED_REPOSITORY_CHECKS = [
  "lint",
  "checks",
  "format",
  "conformance / check",
  "privacy",
  "typecheck",
  "templates",
  "rule-coverage",
  "test",
] as const;
