import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { createGhMorningIssue } from "../../src/routine/gh-morning-issue.js";
import {
  beginWeeklyObservation,
  reconcileWeeklyIssue,
} from "../../src/routine/weekly-review.js";
import type { WeeklyRepositorySummary } from "../../src/routine/types.js";
import { writeWeeklyGhFixture } from "../fixtures/weekly-gh-provider.js";

const scope = {
  date: "2026-10-23",
  cohort: "SECRET COHORT",
  moduleCodes: ["SECRET MODULE"],
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
  const root = await mkdtemp(join(tmpdir(), "academic-weekly-subprocess-"));
  t.after(async () => {
    const evidence = process.env.ACADEMIC_WEEKLY_EVIDENCE_ROOT;
    if (evidence !== undefined) {
      await mkdir(evidence, { recursive: true, mode: 0o700 });
      await cp(root, join(evidence, basename(root)), { recursive: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  const files = await writeWeeklyGhFixture(root),
    issue = createGhMorningIssue(files.ghPath);
  const read = async () =>
    JSON.parse(await readFile(files.providerPath, "utf8"));
  const patch = async (change: Record<string, unknown>) =>
    writeFile(
      files.providerPath,
      JSON.stringify({ ...(await read()), ...change }),
    );
  async function publish(
    change: {
      date?: string;
      parked?: number;
      needsOwner?: boolean;
      maintained?: number;
      writes?: number;
      repository?: WeeklyRepositorySummary;
    } = {},
  ) {
    const observation = await beginWeeklyObservation({
      ...scope,
      date: change.date ?? scope.date,
      issue,
      stateRoot: root,
    });
    return reconcileWeeklyIssue({
      issue,
      stateRoot: root,
      observation,
      summary: {
        ...summary,
        parked: change.parked ?? 0,
        verifiedMaintenance: change.maintained ?? 0,
        verifiedControlWrites: change.writes ?? 0,
      },
      ...(change.repository === undefined
        ? {}
        : { repository: change.repository }),
      needsOwner: change.needsOwner ?? false,
    });
  }
  return { root, ...files, issue, read, patch, publish };
}
it("compiled subprocess preserves early/late Owner body and comment edits through append, reopen and rollover", async (t) => {
  const f = await fixture(t);
  await f.publish();
  let state = await f.read();
  state.issues[0].body += "\nOWNER-EARLY\t\n";
  state.comments.push({
    id: 1,
    body: "OWNER COMMENT\n",
    user: { id: 99 },
    issue_url: "https://api.github.com/repos/fixture/repo/issues/1",
    html_url: "https://github.com/fixture/repo/issues/1#issuecomment-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  });
  state.inject = true;
  state.issues[0].state = "closed";
  await f.patch(state);
  const update = await f.publish({ parked: 1, needsOwner: true });
  assert.equal(update.outcome, "reopened");
  state = await f.read();
  assert.equal(state.injected, true);
  assert.match(state.issues[0].body, /OWNER-EARLY\t\n\nOWNER-LATE\t\n/u);
  assert.match(
    state.comments.find((c: { id: number }) => c.id === 1).body,
    /OWNER-COMMENT-LATE\t\n/u,
  );
  const body = state.issues[0].body,
    ownerComment = state.comments.find((c: { id: number }) => c.id === 1).body;
  await f.patch({ inject: true });
  const rollover = await f.publish({ date: "2026-10-26" });
  assert.equal(rollover.outcome, "created");
  state = await f.read();
  assert.equal(state.issues[0].body, `${body}\nOWNER-LATE\t\n`);
  assert.equal(
    state.comments.find((c: { id: number }) => c.id === 1).body,
    `${ownerComment}\nOWNER-COMMENT-LATE\t\n`,
  );
  assert.equal(state.issues[0].state, "closed");
  for (const request of state.requests) {
    assert.equal(request.args[0], "api");
    if (request.args.includes("PATCH"))
      assert.deepEqual(Object.keys(request.data), ["state"]);
    assert.equal(request.args.includes("DELETE"), false);
  }
  const publicBytes =
    state.issues.map((i: { body: string }) => i.body).join() +
    state.comments
      .filter((c: { user: { id: number } }) => c.user.id === 7)
      .map((c: { body: string }) => c.body)
      .join();
  assert.doesNotMatch(publicBytes, /SECRET COHORT|SECRET MODULE/u);
});
it("compiled resolution recovers a committed close response loss and later reopens without duplicate writes", async (t) => {
  const f = await fixture(t);
  const repository: WeeklyRepositorySummary = {
    merged: [],
    unresolved: 0,
    awaiting: 0,
  };
  await f.publish();
  let state = await f.read();
  state.issues[0].body += "\nOWNER BEFORE CLOSE\t\n";
  state.comments.push({
    id: 1,
    body: "OWNER COMMENT\n",
    user: { id: 99 },
    issue_url: "https://api.github.com/repos/fixture/repo/issues/1",
    html_url: "https://github.com/fixture/repo/issues/1#issuecomment-1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  });
  state.loseState = true;
  state.inject = true;
  await f.patch(state);
  assert.equal((await f.publish({ repository })).outcome, "failed");
  state = await f.read();
  assert.equal(state.issues[0].state, "closed");
  const body = state.issues[0].body;
  const ownerComment = state.comments.find(
    (c: { id: number }) => c.id === 1,
  ).body;
  const mutations = state.requests.filter(
    (r: { args: string[] }) =>
      r.args.includes("POST") || r.args.includes("PATCH"),
  ).length;
  const comments = state.comments.length;
  assert.equal((await f.publish({ repository })).outcome, "not-needed");
  state = await f.read();
  assert.equal(state.comments.length, comments);
  assert.equal(
    state.requests.filter(
      (r: { args: string[] }) =>
        r.args.includes("POST") || r.args.includes("PATCH"),
    ).length,
    mutations,
  );
  assert.equal(
    (await f.publish({ repository, needsOwner: true })).outcome,
    "reopened",
  );
  state = await f.read();
  assert.equal(state.issues[0].state, "open");
  assert.equal(state.issues[0].body, body);
  assert.equal(
    state.comments.find((c: { id: number }) => c.id === 1).body,
    ownerComment,
  );
  const entries = (
    await readFile(join(f.root, "weekly-publication/publication.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const close = entries.find(
    (entry) => entry.kind === "intent" && entry.operation.kind === "resolution",
  );
  assert.equal(close.operation.anchorId, state.issues[0].id);
  assert.ok(
    entries.some((entry) => entry.kind === "receipt" && entry.id === close.id),
  );
  for (const request of state.requests)
    if (request.args.includes("PATCH"))
      assert.deepEqual(Object.keys(request.data), ["state"]);
  const g = await fixture(t);
  await g.patch({ loseState: true });
  assert.equal((await g.publish({ repository })).outcome, "failed");
  assert.equal((await g.read()).issues[0].state, "closed");
  assert.equal(
    (await g.publish({ repository, needsOwner: true })).outcome,
    "reopened",
  );
  assert.equal((await g.read()).issues[0].state, "open");
});
it("response lost after commit reuses exact trusted comment and unknown late commit stays fenced until found", async (t) => {
  const f = await fixture(t);
  await f.publish();
  await f.patch({ loseComment: true });
  assert.equal(
    (await f.publish({ parked: 1, needsOwner: true })).outcome,
    "failed",
  );
  await f.publish({ parked: 1, needsOwner: true });
  assert.equal((await f.read()).comments.length, 2);
  await f.patch({ deferComment: true });
  assert.equal(
    (await f.publish({ parked: 2, needsOwner: true })).outcome,
    "failed",
  );
  await assert.rejects(() => f.publish({ parked: 2 }), /remains fenced/u);
  const state = await f.read();
  assert.equal(state.comments.length, 2);
  state.comments.push(state.deferred);
  delete state.deferred;
  await f.patch(state);
  await f.publish({ parked: 2, needsOwner: true });
  assert.equal((await f.read()).comments.length, 3);
});
it("partial anchor creation resumes exact anchor after response loss", async (t) => {
  const f = await fixture(t);
  await f.patch({ loseCreate: true });
  assert.equal((await f.publish()).outcome, "failed");
  const result = await f.publish();
  assert.equal(result.number, 1);
  const state = await f.read();
  assert.equal(state.issues.length, 1);
  assert.equal(state.comments.length, 1);
});
it("two actual publishers capture concurrent bases then combine scopes or retain same-scope conflict", async (t) => {
  for (const same of [false, true]) {
    const f = await fixture(t);
    const worker = join(f.root, "publisher.mjs");
    const moduleUrl = new URL(
      "../../src/routine/weekly-review.js",
      import.meta.url,
    ).href;
    const adapterUrl = new URL(
      "../../src/routine/gh-morning-issue.js",
      import.meta.url,
    ).href;
    await writeFile(
      worker,
      `import {writeFile,access} from 'node:fs/promises';\nimport {beginWeeklyObservation,reconcileWeeklyIssue} from ${JSON.stringify(moduleUrl)};\nimport {createGhMorningIssue} from ${JSON.stringify(adapterUrl)};\nconst input=JSON.parse(process.argv[2]),issue=createGhMorningIssue(input.ghPath);\nconst observation=await beginWeeklyObservation({...input.scope,issue,stateRoot:input.root});\nawait writeFile(input.ready,'ready');while(true){try{await access(input.release);break}catch{await new Promise(r=>setTimeout(r,10))}}\nconst result=await reconcileWeeklyIssue({issue,stateRoot:input.root,observation,summary:input.summary,needsOwner:input.needsOwner});\nprocess.stdout.write(JSON.stringify(result));`,
    );
    const release = join(f.root, "release");
    function child(index: number) {
      const ready = join(f.root, `ready-${index}`);
      const input = {
        root: f.root,
        ghPath: f.ghPath,
        scope: { ...scope, moduleCodes: same ? ["A"] : [String(index)] },
        summary: { ...summary, parked: index },
        needsOwner: index > 0,
        ready,
        release,
      };
      const process_ = spawn(
        process.execPath,
        [worker, JSON.stringify(input)],
        {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        error = "";
      process_.stdout.on("data", (chunk) => {
        output += chunk;
      });
      process_.stderr.on("data", (chunk) => {
        error += chunk;
      });
      const finished = new Promise<{ outcome: string }>((resolve, reject) =>
        process_.once("close", (code) =>
          code === 0 ? resolve(JSON.parse(output)) : reject(Error(error)),
        ),
      );
      return { ready, finished };
    }
    const a = child(0),
      b = child(1);
    for (let n = 0; n < 500; n++) {
      try {
        await Promise.all([readFile(a.ready), readFile(b.ready)]);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
        if (n === 499) throw Error("publisher basis barrier timed out");
      }
    }
    await writeFile(release, "go");
    const results = await Promise.all([a.finished, b.finished]);
    for (const result of results)
      assert.notEqual(result.outcome, "failed", JSON.stringify(result));
    t.diagnostic(
      `Concurrent ${same ? "same" : "different"} scope publisher outcomes ${JSON.stringify(results)}`,
    );
    const state = await f.read(),
      body = state.comments.at(-1).body;
    assert.equal(state.issues.length, 1);
    assert.equal(state.comments.length, 2);
    assert.match(
      body,
      same ? /Incomparable observations/u : /2 exact maintenance scopes/u,
    );
    if (same) {
      const observation = await beginWeeklyObservation({
        ...scope,
        moduleCodes: ["A"],
        issue: f.issue,
        stateRoot: f.root,
      });
      assert.equal(observation.parents.length, 2);
      const result = await reconcileWeeklyIssue({
        issue: f.issue,
        stateRoot: f.root,
        observation,
        summary,
        needsOwner: false,
      });
      assert.equal(result.actionable, false);
    }
  }
});
it("complete 60-week trusted history stays bounded and late closed-anchor facts remain observed", async (t) => {
  const f = await fixture(t),
    state = await f.read();
  const { observationMarker, digest } = await import(
    "../../src/routine/weekly-review-state.js"
  );
  const scopeId = "a".repeat(64);
  let parent: string[] = [];
  for (let index = 0; index < 60; index++) {
    const date = new Date(Date.UTC(2025, 7, 4 + 7 * index))
      .toISOString()
      .slice(0, 10);
    const number = index + 1,
      observation = {
        scope: scopeId,
        date,
        parents: parent,
        repositoryParents: [],
        summary,
        needsOwner: false,
      };
    parent = [digest(observation)];
    state.issues.push({
      id: number + 1000,
      number,
      title: `Weekly maintenance review ${date}`,
      body: `<!-- academic-os-weekly-issue:v2 week=${date} -->\n`,
      state: "closed",
      user: { id: 7 },
      html_url: `https://github.com/fixture/repo/issues/${number}`,
    });
    state.comments.push({
      id: number + 100,
      body: `${observationMarker(observation)}\nAs of fixture.`,
      user: { id: 7 },
      issue_url: `https://api.github.com/repos/fixture/repo/issues/${number}`,
      html_url: `https://github.com/fixture/repo/issues/${number}#issuecomment-${number + 100}`,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    });
  }
  await f.patch(state);
  const result = await f.publish();
  assert.equal(result.outcome, "created");
  const actual = await f.read(),
    publication = actual.comments.at(-1).body;
  assert.match(publication, /2 exact maintenance scopes/u);
  assert.ok(Buffer.byteLength(publication) < 60000);
  assert.equal(actual.comments.length, 61);
  assert.equal(
    actual.issues.filter((i: { state: string }) => i.state === "open").length,
    1,
  );
  assert.ok(
    actual.requests.length < 400,
    `actual requests ${actual.requests.length}`,
  );
  t.diagnostic(
    `60-week scan used ${actual.requests.length} gh subprocess requests; review ${Buffer.byteLength(publication)} bytes; 60 trusted historic observations`,
  );
});
it("provider spoof and pagination failures cannot trigger adoption or mutation", async (t) => {
  const f = await fixture(t),
    state = await f.read();
  const outsider = {
    id: 1,
    number: 1,
    title: "Weekly maintenance review 2026-10-19",
    body: "<!-- academic-os-weekly-issue:v2 week=2026-10-19 -->\n",
    state: "open",
    user: { id: 99 },
    html_url: "https://github.com/fixture/repo/issues/1",
  };
  state.issues.push(outsider);
  state.issuePages = [[{ ...outsider, pull_request: {} }], [outsider]];
  await f.patch(state);
  assert.equal((await f.issue.listIssues()).issues.length, 1);
  await f.patch({ issuePages: undefined });
  const result = await f.publish();
  assert.equal(result.number, 2);
  assert.equal((await f.read()).issues[0].state, "open");
  const g = await fixture(t);
  await g.patch({ badPage: true });
  await assert.rejects(() => g.publish(), /page headers/u);
  const provider = await g.read();
  assert.equal(
    provider.requests.some(
      (r: { args: string[] }) =>
        r.args.includes("POST") || r.args.includes("PATCH"),
    ),
    false,
  );
});
it("closed bound anchors, quiet dates, positive receipts, copied outsider publications and legacy unknowns use the actual transport", async (t) => {
  const f = await fixture(t);
  await f.publish({
    maintained: 3,
    writes: 2,
    repository: {
      merged: [
        {
          pullRequest: 19,
          commit: "a".repeat(40),
          verification: "verified",
          rollout: "verified",
        },
      ],
      unresolved: 0,
      awaiting: 0,
    },
  });
  let state = await f.read();
  state.issues[0].title = "Owner title";
  state.issues[0].body = "Owner body\t\n";
  state.issues[0].state = "closed";
  const machine = state.comments[0];
  const outsiders = Array.from({ length: 100 }, (_, n) => ({
    ...machine,
    id: n + 1000,
    user: { id: 99, login: "publisher", author_association: "OWNER" },
    html_url: `https://github.com/fixture/repo/issues/1#issuecomment-${n + 1000}`,
  }));
  state.comments = [...outsiders, machine];
  state.issues.push({
    id: 2000,
    number: 2,
    title: "Weekly maintenance review 2026-10-19",
    body: "<!-- academic-os-weekly-issue:v2 week=2026-10-19 -->\n",
    state: "open",
    user: { id: 99, login: "publisher" },
    html_url: "https://github.com/fixture/repo/issues/2",
  });
  await f.patch(state);
  const quiet = await f.publish({ date: "2026-10-24" });
  assert.equal(quiet.outcome, "not-needed");
  state = await f.read();
  assert.equal(state.comments.length, 101);
  assert.equal(state.issues[0].state, "closed");
  const receipt = await f.publish({ date: "2026-10-24", maintained: 1 });
  assert.equal(receipt.outcome, "updated");
  state = await f.read();
  assert.match(
    state.comments.at(-1).body,
    /Verified maintenance entries: 4\./u,
  );
  assert.match(state.comments.at(-1).body, /verified control writes: 2\./u);
  assert.match(
    state.comments.at(-1).body,
    /combined-main verification verified; rollout verified/u,
  );
  assert.equal(state.issues[0].state, "closed");
  assert.equal(state.issues[1].state, "open");
  state.issues.push({
    id: 2001,
    number: 3,
    title: "Weekly maintenance review 2026-10-12",
    body: "<!-- academic-os-weekly-issue:v1 week=2026-10-12 -->\nLEGACY PRIVATE POSITIVE 999",
    state: "open",
    user: { id: 7 },
    html_url: "https://github.com/fixture/repo/issues/3",
  });
  await f.patch(state);
  await f.publish({ date: "2026-10-24" });
  state = await f.read();
  const publicReview = state.comments
    .filter(
      (c: { user: { id: number }; body: string }) =>
        c.user.id === 7 &&
        c.body.startsWith("<!-- academic-os-weekly-observation"),
    )
    .at(-1).body;
  assert.match(
    publicReview,
    /Evidence-unknown predecessor or publication: #3/u,
  );
  assert.match(publicReview, /Owner notes and discussion remain in #3/u);
  assert.doesNotMatch(publicReview, /LEGACY PRIVATE POSITIVE/u);
  assert.equal(state.issues[1].state, "open");
  assert.equal(state.issues[2].state, "closed");
});
it("exact duplicate lost-response comments coalesce and duplicate anchors transfer without replacing notes", async (t) => {
  const f = await fixture(t);
  await f.publish();
  await f.patch({ loseComment: true });
  await f.publish({ parked: 1, needsOwner: true });
  let state = await f.read();
  const original = state.comments.at(-1);
  state.comments.push({
    ...original,
    id: 999,
    html_url: "https://github.com/fixture/repo/issues/1#issuecomment-999",
  });
  state.issues.push({
    id: 2000,
    number: 2,
    title: "Weekly maintenance review 2026-10-19",
    body: "<!-- academic-os-weekly-issue:v2 week=2026-10-19 -->\nDUPLICATE OWNER NOTES\t",
    state: "open",
    user: { id: 7 },
    html_url: "https://github.com/fixture/repo/issues/2",
  });
  await f.patch(state);
  const result = await f.publish({ parked: 1, needsOwner: true });
  assert.equal(result.number, 1);
  assert.notEqual(result.outcome, "failed");
  state = await f.read();
  assert.equal(state.issues[1].state, "closed");
  assert.match(state.issues[1].body, /DUPLICATE OWNER NOTES\t$/u);
  const review = state.comments
    .filter((c: { body: string }) =>
      c.body.startsWith("<!-- academic-os-weekly-observation"),
    )
    .at(-1).body;
  assert.match(review, /1 exact maintenance scopes/u);
  assert.match(review, /Owner notes and discussion remain in #2/u);
  assert.doesNotMatch(review, /DUPLICATE OWNER NOTES/u);
});
it("lost state response is verified by readback on retry, and absent create remains durably unknown", async (t) => {
  const f = await fixture(t);
  await f.publish();
  let state = await f.read();
  state.issues[0].state = "closed";
  state.loseState = true;
  await f.patch(state);
  assert.equal((await f.publish({ needsOwner: true })).outcome, "failed");
  const before = (await f.read()).comments.length;
  assert.notEqual((await f.publish({ needsOwner: true })).outcome, "failed");
  state = await f.read();
  assert.equal(state.comments.length, before);
  assert.equal(state.issues[0].state, "open");
  const g = await fixture(t);
  await g.patch({ failCreate: true });
  assert.equal((await g.publish()).outcome, "failed");
  await assert.rejects(() => g.publish(), /remains fenced/u);
  state = await g.read();
  assert.equal(state.issues.length, 0);
  assert.equal(
    state.requests.filter((r: { args: string[] }) => r.args.includes("POST"))
      .length,
    1,
  );
});
it("changed numeric repository or authenticated publisher identity refuses before further mutation", async (t) => {
  for (const change of [{ repositoryId: 10 }, { publisherId: 8 }]) {
    const f = await fixture(t);
    await f.publish();
    const before = (await f.read()).requests.filter(
      (r: { args: string[] }) =>
        r.args.includes("POST") || r.args.includes("PATCH"),
    ).length;
    await f.patch(change);
    await assert.rejects(() => f.publish(), /identity changed/u);
    const after = (await f.read()).requests.filter(
      (r: { args: string[] }) =>
        r.args.includes("POST") || r.args.includes("PATCH"),
    ).length;
    assert.equal(after, before);
  }
});
