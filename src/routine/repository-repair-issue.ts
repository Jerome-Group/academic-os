import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryRepairPorts } from "./repository-repair-types.js";

type GitHub = (args: string[]) => Promise<string>;
type Issue = { body: string; state: "OPEN" | "CLOSED" };
type Comment = { id: number; body: string };

const acceptanceCriteria = [
  "Meaningful synthetic regression and local checks on the exact repair head.",
  "Two independent exact-head reviews with findings resolved.",
];

export function renderRepositoryRepairIssue(
  fingerprint: string,
  delivered = false,
): string {
  const criteria = acceptanceCriteria
    .map((criterion) => `- [${delivered ? "x" : " "}] ${criterion}`)
    .join("\n");
  return `<!-- academic-os-repository-repair:v1 fingerprint=${fingerprint} -->\n\nA reproducible scheduled public repository verification failure needs an isolated repair. Private diagnostics remain local.\n\n## Acceptance criteria\n\n${criteria}\n\nProtected remote checks, postmerge verification and rollout are separate execution evidence.\n`;
}

function ownedFingerprint(body: string): string {
  const fingerprint =
    /^<!-- academic-os-repository-repair:v1 fingerprint=([a-f0-9]{64}) -->$/u.exec(
      body.split("\n")[0] ?? "",
    )?.[1];
  if (!fingerprint) throw new Error("Issue ownership changed.");
  return fingerprint;
}

async function readIssue(gh: GitHub, issue: number): Promise<Issue> {
  const value: unknown = JSON.parse(
    await gh(["issue", "view", String(issue), "--json", "body,state"]),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("body" in value) ||
    typeof value.body !== "string" ||
    !("state" in value) ||
    (value.state !== "OPEN" && value.state !== "CLOSED")
  )
    throw new Error("Issue readback unavailable.");
  return { body: value.body, state: value.state };
}

async function ownedIssue(gh: GitHub, issue: number, fingerprint: string) {
  const current = await readIssue(gh, issue);
  if (ownedFingerprint(current.body) !== fingerprint)
    throw new Error("Issue ownership changed.");
  return current;
}

export async function deliverRepositoryRepairAcceptance(
  input: Pick<
    Parameters<RepositoryRepairPorts["publish"]>[0],
    "issue" | "fingerprint"
  > & {
    gh: GitHub;
    privateStateRoot: string;
  },
): Promise<void> {
  const { gh, issue, fingerprint } = input;
  const current = await ownedIssue(gh, issue, fingerprint);
  const lines = current.body.split("\n");
  for (const criterion of acceptanceCriteria) {
    const pending = `- [ ] ${criterion}`;
    const delivered = `- [x] ${criterion}`;
    const matches = lines.filter(
      (line) => line === pending || line === delivered,
    );
    if (matches.length !== 1)
      throw new Error("Owned acceptance criteria changed.");
    const index = lines.findIndex(
      (line) => line === pending || line === delivered,
    );
    lines[index] = delivered;
  }
  const body = lines.join("\n");
  const file = join(
    input.privateStateRoot,
    "repository-repair",
    `${randomUUID()}-acceptance.md`,
  );
  await writeFile(file, body, { flag: "wx", mode: 0o600 });
  const before = await ownedIssue(gh, issue, fingerprint);
  if (before.body !== current.body)
    throw new Error("Issue content changed before acceptance update.");
  if (body !== before.body)
    await gh(["issue", "edit", String(issue), "--body-file", file]);
  const after = await ownedIssue(gh, issue, fingerprint);
  if (after.body !== body)
    throw new Error("Issue acceptance readback differs.");
}

async function readComments(gh: GitHub, issue: number): Promise<Comment[]> {
  const comments: Comment[] = [];
  const ids = new Set<number>();
  for (let page = 1; page <= 10; page++) {
    const value: unknown = JSON.parse(
      await gh([
        "api",
        `repos/Jerome-Group/academic-os/issues/${issue}/comments?per_page=100&page=${page}`,
      ]),
    );
    if (!Array.isArray(value) || value.length > 100)
      throw new Error("Conclusion comments unavailable.");
    const items: unknown[] = value;
    for (const item of items) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        typeof item.id !== "number" ||
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        ids.has(item.id) ||
        !("body" in item) ||
        typeof item.body !== "string"
      )
        throw new Error("Conclusion comment readback unavailable.");
      ids.add(item.id);
      comments.push({ id: item.id, body: item.body });
    }
    if (value.length < 100) return comments;
  }
  throw new Error("Conclusion comment history exceeds bounded readback.");
}

function exactConclusion(comments: Comment[], marker: string, body: string) {
  const matches = comments.filter(
    (comment) => comment.body.split("\n")[0] === marker,
  );
  if (matches.length > 1 || matches.some((comment) => comment.body !== body))
    throw new Error("Conclusion receipt changed or duplicated.");
  return matches[0];
}

export async function concludeRepositoryRepairIssue(
  input: Parameters<RepositoryRepairPorts["conclude"]>[0] & {
    gh: GitHub;
    privateStateRoot: string;
  },
): Promise<void> {
  const { gh, issue, fingerprint } = input;
  await ownedIssue(gh, issue, fingerprint);
  const summary = `Merged PR #${input.pullRequest} (${input.mergeCommit}). Combined-main verification: ${input.postmergeVerified ? "passed" : "blocked"}; primary rollout: ${input.rolledOut ? "passed" : "blocked"}.`;
  const digest = createHash("sha256").update(summary).digest("hex");
  const marker = `<!-- academic-os-repository-repair-conclusion:v1 fingerprint=${fingerprint} receipt=${digest} -->`;
  const body = `${marker}\n\n${summary}\n`;
  let receipt = exactConclusion(await readComments(gh, issue), marker, body);
  if (!receipt) {
    const file = join(
      input.privateStateRoot,
      "repository-repair",
      `${randomUUID()}-conclusion.md`,
    );
    await writeFile(file, body, { flag: "wx", mode: 0o600 });
    await ownedIssue(gh, issue, fingerprint);
    await gh(["issue", "comment", String(issue), "--body-file", file]);
    receipt = exactConclusion(await readComments(gh, issue), marker, body);
    if (!receipt) throw new Error("Conclusion receipt outcome unknown.");
  }
  const state = input.postmergeVerified && input.rolledOut ? "CLOSED" : "OPEN";
  const before = await ownedIssue(gh, issue, fingerprint);
  if (before.state !== state)
    await gh(["issue", state === "CLOSED" ? "close" : "reopen", String(issue)]);
  const after = await ownedIssue(gh, issue, fingerprint);
  if (after.state !== state)
    throw new Error("Conclusion issue state readback differs.");
  const confirmed = exactConclusion(
    await readComments(gh, issue),
    marker,
    body,
  );
  if (confirmed?.id !== receipt.id)
    throw new Error("Conclusion receipt readback differs.");
}
