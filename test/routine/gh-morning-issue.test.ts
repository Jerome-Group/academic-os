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
      return `HTTP/2.0 200 OK\r\nLink: <https://api.github.com/repos/fixture/repo/issues?state=all&per_page=100&page=2>; rel="next"\r\n\r\n${JSON.stringify([{ ...issue, pull_request: {} }])}`;
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify([issue])}`;
  });
  assert.equal((await port.listIssues()).length, 1);
  assert.equal(calls.length, 2);
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
    return `HTTP/2.0 200 OK\nLink: <https://api.github.com/repos/fixture/repo/issues?per_page=100&page=${page + 1}>; rel="next"\n\n${JSON.stringify([{ ...issue, number: page, html_url: `https://github.com/fixture/repo/issues/${page}` }])}`;
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
