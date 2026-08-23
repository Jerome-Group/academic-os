import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { OperationalError } from "../mounted/index.js";
import type { MorningIssuePort } from "./types.js";

const ISSUE_URL_PATTERN = /\/(\d+)\s*$/u;

// `gh` infers the repository from the clone it runs in, so the routine reaches the tracker the same
// way a session does. Searching by title before creating is what makes the day's issue at most one:
// a second firing finds the first morning's issue rather than raising a second.
export function createGhMorningIssue(ghPath: string): MorningIssuePort {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const gh = (arguments_: string[], input?: string): string =>
    runGh({
      ghPath,
      repositoryRoot,
      arguments: arguments_,
      ...(input === undefined ? {} : { input }),
    });
  return {
    find: async (title) => {
      const listed: unknown = JSON.parse(
        gh([
          "issue",
          "list",
          "--state",
          "all",
          "--limit",
          "100",
          "--search",
          `"${title}" in:title`,
          "--json",
          "number,title",
        ]),
      );
      if (!Array.isArray(listed)) {
        throw new OperationalError(
          "operational-failure",
          "gh did not list issues as an array.",
        );
      }
      return listed.find(
        (issue): issue is { number: number; title: string } =>
          typeof issue === "object" &&
          issue !== null &&
          (issue as { title?: unknown }).title === title,
      )?.number;
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
  };
}

function runGh(input: {
  ghPath: string;
  repositoryRoot: string;
  arguments: string[];
  input?: string;
}): string {
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
