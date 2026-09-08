import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { OperationalError } from "../mounted/index.js";
import type { MorningIssue, MorningIssuePort } from "./types.js";

const ISSUE_URL_PATTERN = /\/(\d+)\s*$/u;

// `gh` infers the repository from the clone it runs in, which is the clone this built CLI sits in:
// the same three levels up from `dist/src/routine/` that every root resolution here counts.
export interface GhMorningIssueRunnerInput {
  ghPath: string;
  repositoryRoot: string;
  arguments: string[];
  input?: string;
}

export type GhMorningIssueRunner = (input: GhMorningIssueRunnerInput) => string;

export function createGhMorningIssue(
  ghPath: string,
  runner: GhMorningIssueRunner = runGh,
): MorningIssuePort {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const gh = (arguments_: string[], input?: string): string =>
    runner({
      ghPath,
      repositoryRoot,
      arguments: arguments_,
      ...(input === undefined ? {} : { input }),
    });
  return {
    list: async () => {
      const pages: unknown = JSON.parse(
        gh([
          "api",
          "--paginate",
          "--slurp",
          "repos/{owner}/{repo}/issues?state=all&per_page=100",
        ]),
      );
      if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
        throw new OperationalError(
          "operational-failure",
          "gh did not list issue pages as arrays.",
        );
      }
      return pages.flat().flatMap(readIssueRecord);
    },
    raise: async ({ title, body, labels }) => {
      const created = gh(
        [
          "issue",
          "create",
          "--title",
          title,
          "--body-file",
          "-",
          ...labels.flatMap((label) => ["--label", label]),
        ],
        body,
      );
      const number = ISSUE_URL_PATTERN.exec(created)?.[1];
      if (number === undefined) {
        throw new OperationalError(
          "operational-failure",
          `gh did not report a created issue: ${created.trim()}.`,
        );
      }
      return Number(number);
    },
    update: async ({ number, body }) => {
      gh(["issue", "edit", String(number), "--body-file", "-"], body);
    },
    reopen: async (number) => {
      gh(["issue", "reopen", String(number)]);
    },
    close: async (number) => {
      gh(["issue", "close", String(number)]);
    },
  };
}

function readIssueRecord(value: unknown): MorningIssue[] {
  if (typeof value !== "object" || value === null) return invalidIssueRecord();
  if ("pull_request" in value) return [];
  const issue = value as {
    number?: unknown;
    title?: unknown;
    body?: unknown;
    state?: unknown;
  };
  if (
    !Number.isInteger(issue.number) ||
    typeof issue.title !== "string" ||
    (issue.body !== null && typeof issue.body !== "string") ||
    (issue.state !== "open" && issue.state !== "closed")
  ) {
    return invalidIssueRecord();
  }
  return [
    {
      number: issue.number as number,
      title: issue.title,
      body: issue.body ?? "",
      state: issue.state.toUpperCase() as MorningIssue["state"],
    },
  ];
}

function invalidIssueRecord(): never {
  throw new OperationalError(
    "operational-failure",
    "gh listed an invalid issue record.",
  );
}

function runGh(input: GhMorningIssueRunnerInput): string {
  const result = spawnSync(input.ghPath, input.arguments, {
    cwd: input.repositoryRoot,
    encoding: "utf8",
    ...(input.input === undefined ? {} : { input: input.input }),
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new OperationalError(
      "operational-failure",
      `gh ${input.arguments[0]} ${input.arguments[1]} failed: ${
        result.error?.message ?? result.stderr.trim()
      }`,
    );
  }
  return result.stdout;
}
