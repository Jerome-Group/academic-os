import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  WeeklyComment,
  WeeklyDiscussionPort,
  WeeklyIssue,
} from "./types.js";

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
): WeeklyDiscussionPort {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const gh = (arguments_: string[], input?: string): string =>
    runner({
      ghPath,
      repositoryRoot,
      arguments: arguments_,
      ...(input === undefined ? {} : { input }),
    });
  const get = (endpoint: string): unknown => JSON.parse(gh(["api", endpoint]));
  const write = (
    endpoint: string,
    method: "POST" | "PATCH",
    input: unknown,
  ): unknown =>
    JSON.parse(
      gh(
        ["api", endpoint, "--method", method, "--input", "-"],
        JSON.stringify(input),
      ),
    );
  let repository: { api: URL; html: URL; id: number } | undefined;
  function repositoryIdentity() {
    if (repository !== undefined) return repository;
    const repo = object(get("repos/{owner}/{repo}"));
    const api = new URL(urlText(repo.url)),
      html = new URL(urlText(repo.html_url));
    if (
      !/^\/repos\/[^/]+\/[^/]+$/u.test(api.pathname) ||
      !/^\/[^/]+\/[^/]+$/u.test(html.pathname) ||
      api.search !== "" ||
      html.search !== ""
    )
      throw new Error("Invalid repository identity URL.");
    repository = { api, html, id: positive(repo.id) };
    return repository;
  }
  function parseIssue(value: unknown): WeeklyIssue {
    const issue = readIssue(value),
      expected = repositoryIdentity();
    if (issue.url !== `${expected.html.href}/issues/${issue.number}`)
      throw new Error("Issue belongs to another repository.");
    return issue;
  }
  function parseComment(value: unknown, number?: number): WeeklyComment {
    const comment = readComment(value, number),
      expected = repositoryIdentity();
    const raw = object(value);
    if (
      raw.issue_url !== `${expected.api.href}/issues/${comment.issueNumber}` ||
      comment.url !==
        `${expected.html.href}/issues/${comment.issueNumber}#issuecomment-${comment.id}`
    )
      throw new Error("Comment belongs to another repository.");
    return comment;
  }
  function pages(endpoint: string): { records: unknown[]; pages: number } {
    const records: unknown[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    let path = `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=1`;
    const visited = new Set<string>();
    const fixed = new URLSearchParams(endpoint.split("?")[1]);
    for (let page = 1; page <= 100; page += 1) {
      if (visited.has(path))
        throw new Error("Repeated GitHub pagination endpoint.");
      visited.add(path);
      const response = gh(["api", path, "--include"]);
      bytes += Buffer.byteLength(response);
      if (bytes > 32 * 1024 * 1024)
        throw new Error("GitHub listing exceeds 32 MiB.");
      const split = /\r?\n\r?\n/u.exec(response);
      if (split?.index === undefined)
        throw new Error("Incomplete GitHub page headers.");
      const headers = response.slice(0, split.index);
      if (!/^HTTP\/\S+ 200\b/u.test(headers))
        throw new Error("Invalid GitHub page status.");
      const body = response.slice(split.index + split[0].length);
      const values: unknown = JSON.parse(body);
      if (!Array.isArray(values) || values.length > 100 || seen.has(body)) {
        if (
          Array.isArray(values) &&
          values.length === 0 &&
          !/rel="next"/u.test(headers)
        )
          return { records, pages: page };
        throw new Error("Invalid or repeated GitHub page.");
      }
      seen.add(body);
      records.push(...values);
      const links = headers
        .split(/\r?\n/u)
        .filter((line) => /^link:/iu.test(line));
      if (links.length > 1) throw new Error("Ambiguous GitHub pagination.");
      if (links[0] === undefined) return { records, pages: page };
      const relations = new Map<string, URL>();
      for (const part of links[0]
        .slice(links[0].indexOf(":") + 1)
        .trim()
        .split(/,\s*(?=<)/u)) {
        const match = /^<([^>]+)>;\s*rel="(next|prev|first|last)"$/u.exec(part);
        if (
          match?.[1] === undefined ||
          match[2] === undefined ||
          relations.has(match[2])
        )
          throw new Error("Malformed GitHub pagination links.");
        const url = new URL(urlText(match[1])),
          repo = repositoryIdentity(),
          expected = endpoint
            .split("?")[0]
            ?.replace("repos/{owner}/{repo}", repo.api.pathname.slice(1));
        const pageNumber = url.searchParams.get("page");
        if (
          url.origin !== repo.api.origin ||
          expected === undefined ||
          (url.pathname !== `/${expected}` &&
            url.pathname !==
              `/repositories/${repo.id}${expected.slice(repo.api.pathname.length - 1)}`) ||
          url.hash !== "" ||
          [...url.searchParams.keys()].some(
            (key) =>
              url.searchParams.getAll(key).length !== 1 ||
              (!fixed.has(key) &&
                !["per_page", "page", "after", "before", "since"].includes(
                  key,
                )),
          ) ||
          [...fixed].some(
            ([key, value]) => url.searchParams.get(key) !== value,
          ) ||
          pageNumber === null ||
          !/^[1-9]\d*$/u.test(pageNumber) ||
          url.searchParams.get("per_page") !== "100"
        )
          throw new Error("Invalid GitHub pagination endpoint.");
        relations.set(match[2], url);
      }
      const next = relations.get("next");
      if (next === undefined) return { records, pages: page };
      if (next.searchParams.get("page") !== String(page + 1))
        throw new Error("Invalid GitHub next page identity.");
      path = next.href;
    }
    throw new Error("GitHub listing exceeds 100 complete pages.");
  }
  return {
    identify: async () => {
      repository = undefined;
      const user = object(get("user")),
        repo = repositoryIdentity();
      return { publisherId: positive(user.id), repositoryId: repo.id };
    },
    listIssues: async () => {
      const listing = pages(
          "repos/{owner}/{repo}/issues?state=all&sort=created&direction=asc",
        ),
        values = listing.records;
      return {
        issues: values
          .filter((value) => !("pull_request" in object(value)))
          .map(parseIssue),
        totalCount: values.length,
        pages: listing.pages,
        bodyBytes: values.reduce<number>((size, value) => {
          const body = object(value).body;
          return size + Buffer.byteLength(body === null ? "" : string(body));
        }, 0),
      };
    },
    readIssue: async (number) => {
      const result = parseIssue(
        get(`repos/{owner}/{repo}/issues/${positive(number)}`),
      );
      if (result.number !== number)
        throw new Error("Mismatched issue readback.");
      return result;
    },
    listComments: async (number) => {
      const listing = pages(
        `repos/{owner}/{repo}/issues/${positive(number)}/comments`,
      );
      return {
        comments: listing.records.map((value) => parseComment(value, number)),
        pages: listing.pages,
      };
    },
    readComment: async (id) => {
      const result = parseComment(
        get(`repos/{owner}/{repo}/issues/comments/${positive(id)}`),
      );
      if (result.id !== id) throw new Error("Mismatched comment readback.");
      return result;
    },
    createIssue: async (input) =>
      parseIssue(write("repos/{owner}/{repo}/issues", "POST", input)),
    appendComment: async ({ number, body }) =>
      parseComment(
        write(
          `repos/{owner}/{repo}/issues/${positive(number)}/comments`,
          "POST",
          { body },
        ),
        number,
      ),
    setState: async ({ number, state }) => {
      const result = parseIssue(
        write(`repos/{owner}/{repo}/issues/${positive(number)}`, "PATCH", {
          state: state === "OPEN" ? "open" : "closed",
        }),
      );
      if (result.number !== number)
        throw new Error("Mismatched issue state response.");
      return result;
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid GitHub record.");
  return value as Record<string, unknown>;
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid GitHub numeric identity.");
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid GitHub text.");
  return value;
}
function urlText(value: unknown): string {
  const text = string(value),
    parsed = new URL(text);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href !== text ||
    Buffer.byteLength(text) > 2048
  )
    throw new Error("Invalid GitHub URL.");
  return text;
}
function readIssue(value: unknown): WeeklyIssue {
  const issue = object(value);
  if (
    "pull_request" in issue ||
    (issue.state !== "open" && issue.state !== "closed")
  )
    throw new Error("Invalid GitHub issue.");
  return {
    id: positive(issue.id),
    number: positive(issue.number),
    creatorId: positive(object(issue.user).id),
    title: string(issue.title),
    body: issue.body === null ? "" : string(issue.body),
    state: issue.state === "open" ? "OPEN" : "CLOSED",
    url: urlText(issue.html_url),
  };
}
function readComment(value: unknown, expectedIssue?: number): WeeklyComment {
  const comment = object(value),
    issueUrl = new URL(string(comment.issue_url));
  const number = positive(
    Number(/\/issues\/(\d+)$/u.exec(issueUrl.pathname)?.[1]),
  );
  if (expectedIssue !== undefined && expectedIssue !== number)
    throw new Error("Mismatched comment issue.");
  const createdAt = string(comment.created_at),
    updatedAt = string(comment.updated_at);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(createdAt) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(updatedAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(updatedAt))
  )
    throw new Error("Invalid comment timestamps.");
  return {
    id: positive(comment.id),
    issueNumber: number,
    creatorId: positive(object(comment.user).id),
    body: comment.body === null ? "" : string(comment.body),
    createdAt,
    updatedAt,
    url: urlText(comment.html_url),
  };
}
function runGh(input: GhMorningIssueRunnerInput): string {
  const result = spawnSync(input.ghPath, input.arguments, {
    cwd: input.repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    ...(input.input === undefined ? {} : { input: input.input }),
  });
  if (result.error !== undefined || result.status !== 0)
    throw new Error(
      `GitHub request failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout;
}
