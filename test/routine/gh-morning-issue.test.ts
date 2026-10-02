import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        return JSON.stringify(
          input.arguments[1]?.endsWith("page=1")
            ? {
                count: 100,
                issues: [
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
              }
            : {
                count: 1,
                issues: [
                  {
                    number: 16,
                    title: "Morning report 2026-08-22",
                    body: null,
                    state: "closed",
                  },
                ],
              },
        );
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
            "repos/{owner}/{repo}/issues?state=all&per_page=100&page=1",
            "--jq",
            '{count: length, issues: [.[] | select(has("pull_request") | not) | select(.title | (startswith("Morning report ") or startswith("Weekly maintenance review "))) | {number, title, body, state}]} | tojson',
          ],
          input: undefined,
        },
        {
          arguments_: [
            "api",
            "repos/{owner}/{repo}/issues?state=all&per_page=100&page=2",
            "--jq",
            '{count: length, issues: [.[] | select(has("pull_request") | not) | select(.title | (startswith("Morning report ") or startswith("Weekly maintenance review "))) | {number, title, body, state}]} | tojson',
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
      JSON.stringify({
        count: 1,
        issues: [{ number: 17, title: "missing body and state" }],
      }),
    );

    await assert.rejects(issue.list(), /invalid issue record/u);
  });
  it("continues after a full page with no morning issues", async () => {
    const calls: GhMorningIssueRunnerInput[] = [];
    const issue = createGhMorningIssue("/tools/gh", (input) => {
      calls.push(input);
      return JSON.stringify({
        count: calls.length === 1 ? 100 : 0,
        issues: [],
      });
    });
    assert.deepEqual(await issue.list(), []);
    assert.equal(calls.length, 2);
    assert.match(calls[1]?.arguments[1] ?? "", /page=2$/u);
  });

  it("rejects malformed pagination metadata", async () => {
    for (const count of [-1, 101, 1.5, null]) {
      const issue = createGhMorningIssue("/tools/gh", () =>
        JSON.stringify({ count, issues: [] }),
      );
      await assert.rejects(issue.list(), /valid issue page/u);
    }
  });

  it("reads a projected page larger than the default subprocess buffer", async () => {
    const root = await mkdtemp(join(tmpdir(), "academic-os-gh-page-"));
    try {
      const ghPath = join(root, "gh");
      await writeFile(
        ghPath,
        `#!/usr/bin/env node
process.stdout.write(JSON.stringify({count: 1, issues: [{number: 17, title: "Morning report 2026-08-23", body: "x".repeat(2 * 1024 * 1024), state: "open"}]}));
`,
        { mode: 0o700 },
      );
      const issues = await createGhMorningIssue(ghPath).list();
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.body.length, 2 * 1024 * 1024);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("reads the exact weekly issue separately and rejects a mismatched identity", async () => {
  const issue = createGhMorningIssue("/tools/gh", (input) => {
    assert.deepEqual(input.arguments, [
      "api",
      "repos/{owner}/{repo}/issues/17",
    ]);
    return JSON.stringify({
      number: 17,
      title: "Weekly maintenance review 2026-08-24",
      body: "safe body",
      state: "open",
    });
  });
  assert.equal((await issue.read?.(17))?.state, "OPEN");
  const mismatch = createGhMorningIssue("/tools/gh", () =>
    JSON.stringify({
      number: 18,
      title: "Weekly maintenance review 2026-08-24",
      body: "safe body",
      state: "open",
    }),
  );
  await assert.rejects(
    mismatch.read?.(17) as Promise<unknown>,
    /invalid issue record/u,
  );
});

it("transfers closure with only a fixed public comment and never submits the source body", async () => {
  const calls: GhMorningIssueRunnerInput[] = [];
  const issue = createGhMorningIssue("/tools/gh", (input) => {
    calls.push(input);
    return "";
  });
  await issue.close(17, 19);
  assert.deepEqual(calls[0]?.arguments, [
    "issue",
    "close",
    "17",
    "--comment",
    "Transferred to weekly review #19. Closure records transfer, not resolution.",
  ]);
  assert.equal(calls[0]?.input, undefined);
  await assert.rejects(
    issue.close(17, -1),
    /Invalid weekly transfer identity/u,
  );
});
