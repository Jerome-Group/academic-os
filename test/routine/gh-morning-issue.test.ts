import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGhMorningIssue,
  type GhMorningIssueRunnerInput,
} from "../../src/routine/index.js";

describe("the GitHub morning-issue adapter", () => {
  it("lists managed evidence and maps create, update, reopen, and close exactly", async () => {
    const calls: GhMorningIssueRunnerInput[] = [];
    const issue = createGhMorningIssue("/tools/gh", (input) => {
      calls.push(input);
      if (input.arguments[0] === "api") {
        return JSON.stringify([
          [
            {
              number: 17,
              title: "Morning report 2026-08-23",
              body: "marker and report",
              state: "open",
            },
            {
              number: 999,
              title: "A pull request",
              body: null,
              state: "open",
              pull_request: { url: "https://api.github.test/pulls/999" },
            },
          ],
          [
            {
              number: 16,
              title: "Morning report 2026-08-22",
              body: null,
              state: "closed",
            },
          ],
        ]);
      }
      if (input.arguments[1] === "create") {
        return "https://github.com/Jerome-Group/academic-os/issues/18\n";
      }
      return "";
    });

    assert.deepEqual(await issue.list(), [
      {
        number: 17,
        title: "Morning report 2026-08-23",
        body: "marker and report",
        state: "OPEN",
      },
      {
        number: 16,
        title: "Morning report 2026-08-22",
        body: "",
        state: "CLOSED",
      },
    ]);
    assert.equal(
      await issue.raise({
        title: "Morning report 2026-08-23",
        body: "new report",
        labels: ["ready-for-human", "decision"],
      }),
      18,
    );
    await issue.update({ number: 17, body: "updated report" });
    await issue.reopen(17);
    await issue.close(17);

    assert.deepEqual(
      calls.map(({ arguments: arguments_, input }) => ({ arguments_, input })),
      [
        {
          arguments_: [
            "api",
            "--paginate",
            "--slurp",
            "repos/{owner}/{repo}/issues?state=all&per_page=100",
          ],
          input: undefined,
        },
        {
          arguments_: [
            "issue",
            "create",
            "--title",
            "Morning report 2026-08-23",
            "--body-file",
            "-",
            "--label",
            "ready-for-human",
            "--label",
            "decision",
          ],
          input: "new report",
        },
        {
          arguments_: ["issue", "edit", "17", "--body-file", "-"],
          input: "updated report",
        },
        {
          arguments_: ["issue", "reopen", "17"],
          input: undefined,
        },
        {
          arguments_: ["issue", "close", "17"],
          input: undefined,
        },
      ],
    );
    assert.ok(calls.every(({ ghPath }) => ghPath === "/tools/gh"));
  });

  it("rejects a malformed issue listing", async () => {
    const issue = createGhMorningIssue("/tools/gh", () =>
      JSON.stringify([[{ number: 17, title: "missing body and state" }]]),
    );

    await assert.rejects(issue.list(), /invalid issue record/u);
  });
});
