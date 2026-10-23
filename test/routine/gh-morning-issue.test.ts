import assert from "node:assert/strict";
import { it } from "node:test";
import { createGhMorningIssue } from "../../src/routine/gh-morning-issue.js";

const repository = {
  id: 9,
  url: "https://api.github.com/repos/fixture/repo",
  html_url: "https://github.com/fixture/repo",
};
const issue = {
  id: 4,
  number: 2,
  title: "Owner title",
  body: "bytes\t\n",
  state: "closed",
  user: { id: 7 },
  html_url: "https://github.com/fixture/repo/issues/2",
};
const comment = {
  id: 8,
  body: "comment",
  issue_url: "https://api.github.com/repos/fixture/repo/issues/2",
  html_url: "https://github.com/fixture/repo/issues/2#issuecomment-8",
  user: { id: 7 },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
it("port contains no text replacement/deletion operation; JSON writes only append or set state", async () => {
  const calls: { arguments: string[]; input?: string }[] = [];
  const port = createGhMorningIssue("gh", (input) => {
    if (input.arguments[1] === "repos/{owner}/{repo}")
      return JSON.stringify(repository);
    calls.push(input);
    return JSON.stringify(
      input.arguments[1]?.includes("comments") ? comment : issue,
    );
  });
  assert.deepEqual(
    Object.keys(port).sort(),
    [
      "identify",
      "listIssues",
      "readIssue",
      "listComments",
      "readComment",
      "createIssue",
      "appendComment",
      "setState",
    ].sort(),
  );
  await port.createIssue({
    title: "title",
    body: "static",
    labels: ["decision"],
  });
  await port.appendComment({ number: 2, body: "immutable" });
  await port.setState({ number: 2, state: "CLOSED" });
  assert.deepEqual(JSON.parse(calls[2]?.input ?? ""), { state: "closed" });
  assert.equal(calls[0]?.arguments.includes("POST"), true);
  assert.equal(calls[1]?.arguments.includes("POST"), true);
  assert.equal(calls[2]?.arguments.includes("PATCH"), true);
});
it("fully paginates provider pages including pages with no machine items", async () => {
  const calls: string[] = [];
  const port = createGhMorningIssue("gh", ({ arguments: args }) => {
    const path = args[1] ?? "";
    if (path === "repos/{owner}/{repo}") return JSON.stringify(repository);
    calls.push(path);
    if (path.endsWith("&page=1"))
      return `HTTP/2.0 200 OK\r\nLink: <https://api.github.com/repos/fixture/repo/issues?state=all&sort=created&direction=asc&per_page=100&page=2>; rel="next"\r\n\r\n${JSON.stringify([{ ...issue, pull_request: {} }])}`;
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify([issue])}`;
  });
  const listing = await port.listIssues();
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.totalCount, 2);
  assert.equal(listing.bodyBytes, 2 * Buffer.byteLength(issue.body));
  assert.equal(calls.length, 2);
});
it("follows the authenticated numeric repository Link with its opaque cursor intact", async () => {
  const calls: string[] = [];
  const next =
    "https://api.github.com/repositories/9/issues?state=all&sort=created&direction=asc&per_page=100&page=2&after=Y3Vyc29yOnYyOpLPAAABoBBDfvDPAAAAATRVxmI%3D";
  const port = createGhMorningIssue("gh", ({ arguments: args }) => {
    if (args[1] === "repos/{owner}/{repo}") return JSON.stringify(repository);
    calls.push(args[1] ?? "");
    return calls.length === 1
      ? `HTTP/2.0 200 OK\nLink: <${next}>; rel="next"\n\n${JSON.stringify([{ ...issue, pull_request: {} }])}`
      : `HTTP/2.0 200 OK\n\n${JSON.stringify([issue])}`;
  });
  assert.equal((await port.listIssues()).issues.length, 1);
  assert.equal(calls[1], next);
});
it("rejects foreign, altered, ambiguous and nonprogressing pagination links", async () => {
  const correct =
    "https://api.github.com/repositories/9/issues?state=all&sort=created&direction=asc&per_page=100&page=2";
  for (const next of [
    correct.replace("/9/", "/10/"),
    correct.replace("api.github.com", "other.example"),
    correct.replace("/issues?", "/issues/2/comments?"),
    correct.replace("state=all", "state=open"),
    correct.replace("&direction=asc", ""),
    `${correct}&page=2`,
    `${correct}&unexpected=1`,
    `${correct}#fragment`,
    correct.replace("page=2", "page=1"),
    correct.replace("page=2", "page=3"),
  ]) {
    const port = createGhMorningIssue("gh", ({ arguments: args }) =>
      args[1] === "repos/{owner}/{repo}"
        ? JSON.stringify(repository)
        : `HTTP/2.0 200 OK\nLink: <${next}>; rel="next"\n\n${JSON.stringify([issue])}`,
    );
    await assert.rejects(() => port.listIssues(), /pagination|next page/u);
  }
});
it("rejects oversized metadata and timestamp precision it cannot preserve", async () => {
  for (const changed of [
    {
      created_at: "2026-10-01T00:00:00.0001Z",
      updated_at: "2026-10-01T00:00:00.0002Z",
    },
    { html_url: `https://github.com/${"x".repeat(2048)}` },
  ]) {
    const port = createGhMorningIssue("gh", ({ arguments: args }) =>
      JSON.stringify(
        args[1] === "repos/{owner}/{repo}"
          ? repository
          : { ...comment, ...changed },
      ),
    );
    await assert.rejects(() => port.readComment(8), /timestamps|URL/u);
  }
});
it("refuses bad numeric identity, incomplete headers, repeated/capped and malformed pages", async () => {
  await assert.rejects(() =>
    createGhMorningIssue("gh", () =>
      JSON.stringify({ ...issue, user: { id: "7" } }),
    ).readIssue(2),
  );
  for (const response of [
    "[]",
    "HTTP/2.0 500 Error\n\n[]",
    "HTTP/2.0 200 OK\n\n{}",
    'HTTP/2.0 200 OK\nLink: <https://api.github.com/repos/fixture/repo/issues?page=9&per_page=100>; rel="next"\n\n[]',
  ])
    await assert.rejects(() =>
      createGhMorningIssue("gh", () => response).listIssues(),
    );
});
it("refuses a capped otherwise-valid listing and a cross-repository readback", async () => {
  let calls = 0;
  const port = createGhMorningIssue("gh", ({ arguments: args }) => {
    if (args[1] === "repos/{owner}/{repo}") return JSON.stringify(repository);
    const page = Number(/&page=(\d+)$/u.exec(args[1] ?? "")?.[1]);
    calls += 1;
    return `HTTP/2.0 200 OK\nLink: <https://api.github.com/repos/fixture/repo/issues?state=all&sort=created&direction=asc&per_page=100&page=${page + 1}>; rel="next"\n\n${JSON.stringify([{ ...issue, number: page, html_url: `https://github.com/fixture/repo/issues/${page}` }])}`;
  });
  await assert.rejects(() => port.listIssues(), /exceeds 100/u);
  assert.equal(calls, 100);
  const mismatch = createGhMorningIssue("gh", ({ arguments: args }) =>
    JSON.stringify(
      args[1] === "repos/{owner}/{repo}"
        ? repository
        : {
            ...comment,
            issue_url: "https://api.github.com/repos/other/repo/issues/2",
          },
    ),
  );
  await assert.rejects(() => mismatch.readComment(8), /another repository/u);
});
it("retains the bounded wire read refusal for unused provider metadata", async () => {
  const calls: string[][] = [];
  const response = `HTTP/2.0 200 OK\n\n${JSON.stringify([{ ...issue, unused: "x".repeat(32 * 1024 * 1024) }])}`;
  const port = createGhMorningIssue("gh", ({ arguments: args }) => {
    calls.push(args);
    return args[1] === "repos/{owner}/{repo}"
      ? JSON.stringify(repository)
      : response;
  });
  await assert.rejects(() => port.listIssues(), /listing exceeds 32 MiB/u);
  assert.equal(
    calls.some((args) => args.includes("POST") || args.includes("PATCH")),
    false,
  );
});
