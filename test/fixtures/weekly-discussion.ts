import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type {
  WeeklyComment,
  WeeklyDiscussionPort,
  WeeklyIssue,
} from "../../src/routine/types.js";

export function weeklyFixture(overrides: Partial<WeeklyDiscussionPort> = {}) {
  const stateRoot = mkdtempSync(join(tmpdir(), "academic-weekly-"));
  after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const issues = new Map<number, WeeklyIssue>(),
    comments = new Map<number, WeeklyComment>();
  const raised: { title: string; body: string; labels: readonly string[] }[] =
    [];
  const appended: { number: number; body: string }[] = [];
  const states: { number: number; state: WeeklyIssue["state"] }[] = [];
  const issue: WeeklyDiscussionPort = {
    identify: async () => ({ publisherId: 7, repositoryId: 9 }),
    listIssues: async () => ({
      issues: structuredClone([...issues.values()]),
      totalCount: issues.size,
      bodyBytes: [...issues.values()].reduce(
        (n, issue) => n + Buffer.byteLength(issue.body),
        0,
      ),
      pages: Math.max(1, Math.ceil(issues.size / 100)),
    }),
    readIssue: async (number) => {
      const found = issues.get(number);
      if (found === undefined) throw new Error("missing issue");
      return structuredClone(found);
    },
    listComments: async (number) => {
      const listed = structuredClone(
        [...comments.values()].filter((c) => c.issueNumber === number),
      );
      return {
        comments: listed,
        pages: Math.max(1, Math.ceil(listed.length / 100)),
      };
    },
    readComment: async (id) => {
      const found = comments.get(id);
      if (found === undefined) throw new Error("missing comment");
      return structuredClone(found);
    },
    createIssue: async (input) => {
      raised.push(input);
      const number = 900 + issues.size;
      const created: WeeklyIssue = {
        id: number + 1000,
        number,
        creatorId: 7,
        title: input.title,
        body: input.body,
        state: "OPEN",
        url: `https://github.com/fixture/repo/issues/${number}`,
      };
      issues.set(number, created);
      return structuredClone(created);
    },
    appendComment: async (input) => {
      appended.push(input);
      const id = comments.size + 100;
      const comment: WeeklyComment = {
        id,
        issueNumber: input.number,
        creatorId: 7,
        body: input.body,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        url: `https://github.com/fixture/repo/issues/${input.number}#issuecomment-${id}`,
      };
      comments.set(id, comment);
      return structuredClone(comment);
    },
    setState: async (input) => {
      states.push(input);
      const found = issues.get(input.number);
      if (found === undefined) throw new Error("missing issue");
      found.state = input.state;
      return structuredClone(found);
    },
    ...overrides,
  };
  return { stateRoot, issue, issues, comments, raised, appended, states };
}
