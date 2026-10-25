import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { createGhMorningIssue } from "../../src/routine/gh-morning-issue.js";
import {
  beginWeeklyObservation,
  reconcileWeeklyIssue,
} from "../../src/routine/weekly-review.js";
import { writeWeeklyGhFixture } from "../fixtures/weekly-gh-provider.js";

const scope = {
  date: "2026-10-23",
  cohort: "fixture",
  moduleCodes: ["A"],
  scope: "monitoring-cohort" as const,
};
const summary = {
  targets: 1,
  preludePending: 0,
  parked: 0,
  failures: 0,
  verifiedMaintenance: 0,
  checkedMaintenance: 9,
  verifiedControlWrites: 0,
  awaitingMaintenance: 0,
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "academic-weekly-admission-"));
  t.after(async () => {
    const evidence = process.env.ACADEMIC_WEEKLY_EVIDENCE_ROOT;
    if (evidence !== undefined) {
      await mkdir(evidence, { recursive: true, mode: 0o700 });
      await cp(root, join(evidence, basename(root)), { recursive: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  const { ghPath, providerPath } = await writeWeeklyGhFixture(root),
    issue = createGhMorningIssue(ghPath);
  const read = async () => JSON.parse(await readFile(providerPath, "utf8"));
  const patch = async (state: Record<string, unknown>) =>
    writeFile(providerPath, JSON.stringify(state));
  const capture = (name: string) =>
    cp(providerPath, join(root, `${name}-provider.json`));
  const basis = (date = scope.date) =>
    beginWeeklyObservation({ ...scope, date, issue, stateRoot: root });
  const publish = async (observation: Awaited<ReturnType<typeof basis>>) =>
    reconcileWeeklyIssue({
      issue,
      stateRoot: root,
      observation,
      summary,
      needsOwner: false,
    });
  await publish(await basis());
  return { root, issue, read, patch, capture, basis, publish };
}
function ownerComment(id: number, body: string) {
  return {
    id,
    body,
    user: { id: 99 },
    issue_url: "https://api.github.com/repos/fixture/repo/issues/1",
    html_url: `https://github.com/fixture/repo/issues/1#issuecomment-${id}`,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}
function mutations(state: { requests: { args: string[] }[] }): number {
  return state.requests.filter(
    (request) =>
      request.args.includes("POST") || request.args.includes("PATCH"),
  ).length;
}
it("admits the whole rollover comment batch before creating its anchor", async (t) => {
  const f = await fixture(t),
    state = await f.read();
  state.comments.push(
    ...Array.from({ length: 9998 }, (_, index) =>
      ownerComment(1000 + index, ""),
    ),
  );
  await f.patch(state);
  const observation = await f.basis("2026-10-26");
  const before = mutations(await f.read());
  await f.capture("before");
  const refused = await f.publish(observation);
  assert.equal(refused.outcome, "failed");
  assert.match(refused.failure?.message ?? "", /exceed 10000/u);
  let actual = await f.read();
  await f.capture("refused");
  assert.equal(mutations(actual), before);
  assert.equal(actual.issues.length, 1);
  actual.comments.splice(-100);
  await f.patch(actual);
  const admitted = await f.publish(observation);
  assert.equal(admitted.outcome, "created", JSON.stringify(admitted));
  actual = await f.read();
  assert.equal(actual.comments.length, 9901);
  assert.equal(actual.issues[0].state, "closed");
  assert.equal(mutations(actual), before + 4);
});
it("counts raw pull requests when admitting a new weekly anchor", async (t) => {
  const f = await fixture(t),
    state = await f.read();
  state.issues.push(
    ...Array.from({ length: 9999 }, (_, index) => ({
      id: index + 10000,
      number: index + 10000,
      body: "",
      pull_request: {},
    })),
  );
  await f.patch(state);
  const observation = await f.basis("2026-10-26"),
    before = mutations(await f.read());
  await f.capture("before");
  assert.equal((await f.publish(observation)).outcome, "failed");
  await f.capture("refused");
  assert.equal(mutations(await f.read()), before);
});
it("admits observed plus planned discussion bytes before any rollover mutation", async (t) => {
  const f = await fixture(t),
    state = await f.read();
  let left =
    32 * 1024 * 1024 -
    100 -
    state.issues.reduce(
      (n: number, issue: { body: string }) => n + Buffer.byteLength(issue.body),
      0,
    ) -
    state.comments.reduce(
      (n: number, comment: { body: string }) =>
        n + Buffer.byteLength(comment.body),
      0,
    );
  for (let index = 0; left > 0; index++) {
    const size = Math.min(left, 50000);
    left -= size;
    if (index < 330)
      state.issues.push({
        id: index + 10000,
        number: index + 10000,
        title: "outside",
        body: "x".repeat(size),
        state: "open",
        user: { id: 99 },
        html_url: `https://github.com/fixture/repo/issues/${index + 10000}`,
      });
    else state.comments.push(ownerComment(index + 1000, "x".repeat(size)));
  }
  await f.patch(state);
  const observation = await f.basis("2026-10-26"),
    before = mutations(await f.read());
  await f.capture("before");
  const refused = await f.publish(observation);
  assert.equal(refused.outcome, "failed");
  assert.match(refused.failure?.message ?? "", /32 MiB discussion/u);
  let actual = await f.read();
  await f.capture("refused");
  assert.equal(mutations(actual), before);
  actual.comments.pop();
  await f.patch(actual);
  const admitted = await f.publish(observation);
  assert.equal(admitted.outcome, "created", JSON.stringify(admitted));
  actual = await f.read();
  assert.equal(actual.issues[0].state, "closed");
});
it("reserves intent, escaped readback and receipt journal bytes for every planned mutation", async (t) => {
  const f = await fixture(t),
    observation = await f.basis("2026-10-26"),
    before = mutations(await f.read());
  const path = join(f.root, "weekly-publication/publication.jsonl"),
    bytes = await readFile(path, "utf8"),
    line = `${JSON.stringify({ kind: "basis", basis: observation })}\n`;
  const fill = (remaining: number) =>
    writeFile(
      path,
      bytes +
        line.repeat(
          Math.floor(
            (32 * 1024 * 1024 - remaining - Buffer.byteLength(bytes)) /
              Buffer.byteLength(line),
          ),
        ),
      { mode: 0o600 },
    );
  await fill(20_000);
  await f.capture("before");
  const refused = await f.publish(observation);
  await f.capture("refused");
  assert.equal(refused.outcome, "failed");
  assert.match(refused.failure?.message ?? "", /journal exceeds 32 MiB/u);
  assert.equal(mutations(await f.read()), before);
  await fill(100_000);
  const admitted = await f.publish(observation);
  assert.equal(admitted.outcome, "created", JSON.stringify(admitted));
  const journal = await readFile(path, "utf8");
  assert.ok(Buffer.byteLength(journal) <= 32 * 1024 * 1024);
  const entries = journal
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const entry of entries.filter((entry) => entry.kind === "intent"))
    assert.ok(
      entries.some(
        (receipt) => receipt.kind === "receipt" && receipt.id === entry.id,
      ),
    );
});
it("insufficient replay evidence capacity retains the unknown intent without another POST", async (t) => {
  const f = await fixture(t),
    observation = await f.basis(),
    state = await f.read();
  state.loseComment = true;
  await f.patch(state);
  const failed = await reconcileWeeklyIssue({
    issue: f.issue,
    stateRoot: f.root,
    observation,
    summary: { ...summary, parked: 1 },
    needsOwner: true,
  });
  assert.equal(failed.outcome, "failed");
  const before = mutations(await f.read()),
    path = join(f.root, "weekly-publication/publication.jsonl"),
    bytes = await readFile(path, "utf8"),
    line = `${JSON.stringify({ kind: "basis", basis: observation })}\n`;
  const fill = (remaining: number) =>
    writeFile(
      path,
      bytes +
        line.repeat(
          Math.floor(
            (32 * 1024 * 1024 - remaining - Buffer.byteLength(bytes)) /
              Buffer.byteLength(line),
          ),
        ),
      { mode: 0o600 },
    );
  await fill(1000);
  await f.capture("before");
  await assert.rejects(() => f.basis(), /journal exceeds 32 MiB/u);
  await f.capture("refused");
  await cp(path, join(f.root, "refused-publication.jsonl"));
  assert.equal(mutations(await f.read()), before);
  let entries = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const pending = entries.filter(
    (entry) =>
      entry.kind === "intent" &&
      !entries.some(
        (receipt) => receipt.kind === "receipt" && receipt.id === entry.id,
      ),
  );
  assert.equal(pending.length, 1);
  await fill(100_000);
  await f.basis();
  assert.equal(mutations(await f.read()), before);
  entries = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    entries.some(
      (entry) => entry.kind === "receipt" && entry.id === pending[0].id,
    ),
  );
});
it("admits resolution review and close receipts together before the first remote effect", async (t) => {
  const f = await fixture(t);
  const observation = await f.basis();
  const before = mutations(await f.read());
  const path = join(f.root, "weekly-publication/publication.jsonl");
  const bytes = await readFile(path, "utf8");
  const line = `${JSON.stringify({ kind: "basis", basis: observation })}\n`;
  const fill = (remaining: number) =>
    writeFile(
      path,
      bytes +
        line.repeat(
          Math.floor(
            (32 * 1024 * 1024 - remaining - Buffer.byteLength(bytes)) /
              Buffer.byteLength(line),
          ),
        ),
      { mode: 0o600 },
    );
  const resolve = () =>
    reconcileWeeklyIssue({
      issue: f.issue,
      stateRoot: f.root,
      observation,
      summary,
      needsOwner: false,
      repository: { merged: [], unresolved: 0, awaiting: 0 },
    });
  await fill(2000);
  await f.capture("resolution-before");
  const refused = await resolve();
  assert.equal(refused.outcome, "failed");
  assert.match(refused.failure?.message ?? "", /journal exceeds 32 MiB/u);
  assert.equal(mutations(await f.read()), before);
  assert.equal((await f.read()).issues[0].state, "open");
  await f.capture("resolution-refused");
  await fill(100_000);
  const result = await resolve();
  assert.equal(result.outcome, "closed");
  const actual = await f.read();
  assert.equal(actual.issues[0].state, "closed");
  assert.equal(mutations(actual), before + 2);
  const journal = await readFile(path, "utf8");
  assert.ok(Buffer.byteLength(journal) <= 32 * 1024 * 1024);
  const entries = journal
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const close = entries.find(
    (entry) => entry.kind === "intent" && entry.operation.kind === "resolution",
  );
  assert.equal(close.operation.publicationId, result.publicationId);
  assert.ok(
    entries.some((entry) => entry.kind === "receipt" && entry.id === close.id),
  );
});
