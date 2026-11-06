import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runRepositoryRepair } from "../../src/routine/repository-repair.js";
import {
  createRepositoryRepairPorts,
  renderRepositoryRepairIssue,
  runRepositoryProcess,
} from "../../src/routine/repository-repair-adapters.js";
import {
  REQUIRED_REPOSITORY_CHECKS,
  type RepositoryRepairPorts,
} from "../../src/routine/repository-repair-types.js";

const conclusion = {
  issue: 42,
  fingerprint: "a".repeat(64),
  pullRequest: 43,
  mergeCommit: "b".repeat(40),
  postmergeVerified: true,
  rolledOut: true,
};
const ownerBody = `${renderRepositoryRepairIssue(conclusion.fingerprint, true)}\nOwner note kept verbatim.\n`;
type ProviderState = {
  body: string;
  state: string;
  comments: { id: number; body: string }[];
  views: number;
};

async function fixture(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "repair-conclusion-"));
  const statePath = join(root, "provider.json");
  const requestsPath = join(root, "requests.jsonl");
  const ghPath = join(root, "fake-gh");
  const input = {
    repositoryRoot: join(root, "repo"),
    privateStateRoot: join(root, "private"),
    codexPath: "/unused/no-model",
    ghPath,
  };
  await mkdir(input.repositoryRoot);
  await mkdir(join(input.privateStateRoot, "repository-repair"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    statePath,
    JSON.stringify({ body: ownerBody, state: "OPEN", comments: [], views: 0 }),
  );
  await writeFile(requestsPath, "");
  await writeFile(
    ghPath,
    `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const statePath = ${JSON.stringify(statePath)};
const requestsPath = ${JSON.stringify(requestsPath)};
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
appendFileSync(requestsPath, JSON.stringify({ pid: process.pid, args }) + "\\n");
let output = "";
if (args[0] === "api") {
  if (mode === "invalid-comments") output = JSON.stringify({ message: "Unavailable" });
  else {
    const page = Number(new URL("https://fixture.invalid/" + args[1]).searchParams.get("page") || "1");
    output = JSON.stringify(state.comments.slice((page - 1) * 100, page * 100));
  }
} else if (args[0] === "issue" && args[1] === "view") {
  state.views++;
  if (state.views === 2 && mode === "concurrent-body") state.body += "Concurrent Owner addition.\\n";
  if ((state.views === 2 && mode === "ownership-before") || (state.views === 4 && mode === "ownership-after")) state.body = "Owner replaced the issue identity.\\n";
  if ((state.views === 2 && mode === "valid-ownership-before") || (state.views === 3 && mode === "valid-ownership-after")) state.body = state.body.replace("a".repeat(64), "c".repeat(64));
  output = JSON.stringify({ body: state.body, state: state.state });
} else if (args[0] === "issue" && args[1] === "comment") {
  const body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
  if (mode !== "no-op-comment") state.comments.push({ id: state.comments.length + 1, body: mode === "wrong-comment" ? body + "Provider changed receipt.\\n" : body });
  output = "https://github.com/Jerome-Group/academic-os/issues/42#issuecomment-1\\n";
} else if (args[0] === "issue" && args[1] === "edit") {
  if (mode !== "no-op-body") state.body = readFileSync(args[args.indexOf("--body-file") + 1], "utf8") + (mode === "wrong-body" ? "Provider changed body.\\n" : "");
} else if (args[0] === "issue" && ["close", "reopen"].includes(args[1])) {
  if (mode !== "no-op-state") state.state = args[1] === "close" ? "CLOSED" : "OPEN";
  if (mode === "wrong-state") state.state = "UNKNOWN";
  if (mode === "lost-final-receipt") state.comments = [];
} else if (args[0] === "pr" && args[1] === "create") {
  output = "https://github.com/Jerome-Group/academic-os/pull/43\\n";
} else process.exit(9);
writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(output);
if (args[1] === "comment" && mode === "lost-comment-response") process.exit(1);
`,
  );
  await chmod(ghPath, 0o700);
  return {
    input,
    ports: createRepositoryRepairPorts(input),
    state: async (): Promise<ProviderState> =>
      JSON.parse(await readFile(statePath, "utf8")),
    save: async (state: ProviderState) =>
      writeFile(statePath, JSON.stringify(state)),
    requests: async (): Promise<{ pid: number; args: string[] }[]> =>
      (await readFile(requestsPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

async function publicationCandidate(input: { repositoryRoot: string }) {
  const git = async (args: string[]) => {
    const result = await runRepositoryProcess({
      executable: "/usr/bin/git",
      args,
      cwd: input.repositoryRoot,
    });
    assert.equal(result.code, 0, result.output);
    return result.output.trim();
  };
  await git([
    "init",
    "--bare",
    join(dirname(input.repositoryRoot), "remote.git"),
  ]);
  await git(["init"]);
  await writeFile(
    join(input.repositoryRoot, "synthetic"),
    "Synthetic repository.\n",
  );
  await git(["add", "synthetic"]);
  await git([
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.invalid",
    "commit",
    "-m",
    "Synthetic fixture",
  ]);
  await git(["switch", "-c", "codex/synthetic"]);
  await git([
    "remote",
    "add",
    "origin",
    join(dirname(input.repositoryRoot), "remote.git"),
  ]);
  const head = await git(["rev-parse", "HEAD"]);
  return {
    candidate: {
      root: input.repositoryRoot,
      branch: "codex/synthetic",
      base: head,
    },
    head,
  };
}

test("production publication ticks only owned acceptance lines and preserves every other byte", async () => {
  const f = await fixture();
  try {
    const { candidate, head } = await publicationCandidate(f.input);
    const state = await f.state();
    state.body = `${state.body
      .replaceAll("- [x]", "- [ ]")
      .replace(
        "## Acceptance criteria",
        "Owner context inside the template.\n\n## Acceptance criteria",
      )}- [ ] Owner acceptance line.\n`;
    await f.save(state);
    assert.equal(
      await f.ports.publish({
        candidate,
        issue: 42,
        fingerprint: conclusion.fingerprint,
        head,
      }),
      43,
    );
    assert.equal(
      (await f.state()).body,
      state.body
        .replace("- [ ] Meaningful synthetic", "- [x] Meaningful synthetic")
        .replace("- [ ] Two independent", "- [x] Two independent"),
    );
  } finally {
    await f.close();
  }
});

for (const mode of [
  "concurrent-body",
  "no-op-body",
  "wrong-body",
  "ownership-before",
  "valid-ownership-before",
  "valid-ownership-after",
])
  test(`production publication refuses ${mode} before creating a PR`, async () => {
    const f = await fixture(mode);
    try {
      const { candidate, head } = await publicationCandidate(f.input);
      const state = await f.state();
      state.body = state.body.replaceAll("- [x]", "- [ ]");
      await f.save(state);
      await assert.rejects(
        f.ports.publish({
          candidate,
          issue: 42,
          fingerprint: conclusion.fingerprint,
          head,
        }),
      );
      assert.equal(
        (await f.requests()).some((r) => r.args[0] === "pr"),
        false,
      );
      if (mode === "concurrent-body")
        assert.equal(
          (await f.state()).body,
          `${state.body}Concurrent Owner addition.\n`,
        );
    } finally {
      await f.close();
    }
  });

test("public controller refuses substituted publication ownership before any remote effect", async () => {
  const f = await fixture();
  try {
    const { candidate, head } = await publicationCandidate(f.input);
    let checks = 0;
    let reviews = 0;
    const ports: RepositoryRepairPorts = {
      ...f.ports,
      snapshot: async () => ({
        clean: true,
        base: head,
        toolsDigest: "tools",
      }),
      createCandidate: async () => candidate,
      checks: async () => ({
        passed: ++checks > 1,
        digest: "failure",
        actions: [
          {
            action: "check",
            exitCode: checks > 1 ? 0 : 1,
            outputSha256: "stable",
          },
        ],
      }),
      issue: async (fingerprint) => {
        const state = await f.state();
        state.body = `${renderRepositoryRepairIssue(fingerprint)}\nOwner incident context.\n`;
        await f.save(state);
        return 42;
      },
      implement: async () => {},
      changes: async () => ({
        paths: ["src/example.ts", "test/example.test.ts"],
        regression: true,
        unsafeEntries: false,
      }),
      commit: async () => head,
      review: async (_candidate, reviewedHead, reviewer) => {
        if (++reviews === 2) {
          const state = await f.state();
          state.body = state.body.replace(
            /fingerprint=[a-f0-9]{64}/u,
            `fingerprint=${"c".repeat(64)}`,
          );
          await f.save(state);
        }
        return { head: reviewedHead, reviewer, approved: true, findings: [] };
      },
      pullRequest: async () => ({
        head,
        base: head,
        open: true,
        owned: true,
        ready: true,
        unresolvedThreads: 0,
        checks: REQUIRED_REPOSITORY_CHECKS.map((name) => ({
          name,
          head,
          state: "SUCCESS",
        })),
      }),
      merge: async () => conclusion.mergeCommit,
      merged: async () => true,
      rollout: async () => ({ postmergeVerified: true, rolledOut: true }),
    };
    const report = await runRepositoryRepair({ ...f.input, ports });
    assert.deepEqual(
      (await f.requests()).map(({ args }) => args.slice(0, 2).join(" ")),
      ["issue view"],
    );
    const refs = await runRepositoryProcess({
      executable: "/usr/bin/git",
      args: [
        "--git-dir",
        join(dirname(f.input.repositoryRoot), "remote.git"),
        "show-ref",
      ],
      cwd: f.input.repositoryRoot,
    });
    assert.equal(refs.code, 1);
    assert.equal(refs.output, "");
    assert.equal(report.outcome, "blocked");
    assert.equal(report.code, "repair-stage-failed-reconciliation-required");
    assert.equal(report.pullRequest, undefined);
    assert.equal(report.mergeCommit, undefined);
    const state = JSON.parse(
      await readFile(
        join(f.input.privateStateRoot, "repository-repair", "state.json"),
        "utf8",
      ),
    );
    assert.equal(state.stage, "publish-intent");
    assert.equal(state.fingerprint, report.fingerprint);
    assert.notEqual(report.fingerprint, "c".repeat(64));
    assert.equal(
      (await f.state()).body,
      `${renderRepositoryRepairIssue("c".repeat(64))}\nOwner incident context.\n`,
    );
    const repeated = await runRepositoryRepair({ ...f.input, ports });
    assert.equal(repeated.outcome, "busy");
    assert.equal(repeated.code, "lock-reconciliation-required");
    assert.equal((await f.requests()).length, 1);
  } finally {
    await f.close();
  }
});

test("production conclusion preserves Owner body and retries one exact immutable receipt", async () => {
  const f = await fixture();
  try {
    await f.ports.conclude(conclusion);
    const first = await f.state();
    assert.equal(first.body, ownerBody);
    assert.equal(first.state, "CLOSED");
    assert.equal(first.comments.length, 1);
    assert.match(first.comments[0]?.body ?? "", /Merged PR #43 \(b{40}\)/u);
    await f.ports.conclude(conclusion);
    const second = await f.state();
    assert.deepEqual(second.comments, first.comments);
    assert.equal(second.body, ownerBody);
    assert.equal(second.state, "CLOSED");
    assert.equal(
      (await f.requests()).filter((r) => r.args[1] === "comment").length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("production conclusion preserves concurrent Owner additions and reopens blocked rollout", async () => {
  const f = await fixture("concurrent-body");
  try {
    await f.ports.conclude(conclusion);
    await f.ports.conclude({ ...conclusion, rolledOut: false });
    const state = await f.state();
    assert.equal(state.body, `${ownerBody}Concurrent Owner addition.\n`);
    assert.equal(state.state, "OPEN");
    assert.equal(state.comments.length, 2);
    assert.match(state.comments[1]?.body ?? "", /primary rollout: blocked/u);
  } finally {
    await f.close();
  }
});

for (const mode of [
  "no-op-comment",
  "wrong-comment",
  "no-op-state",
  "wrong-state",
  "lost-final-receipt",
  "ownership-before",
  "ownership-after",
  "invalid-comments",
  "lost-comment-response",
])
  test(`production conclusion refuses ${mode} instead of reporting success`, async () => {
    const f = await fixture(mode);
    try {
      await assert.rejects(f.ports.conclude(conclusion));
      if (["ownership-before", "no-op-comment", "wrong-comment"].includes(mode))
        assert.equal(
          (await f.requests()).some((r) => r.args[1] === "close"),
          false,
        );
      if (!mode.startsWith("ownership"))
        assert.equal((await f.state()).body, ownerBody);
    } finally {
      await f.close();
    }
  });

test("production conclusion refuses an accepted no-op reopen after blocked rollout", async () => {
  const f = await fixture("no-op-state");
  try {
    const state = await f.state();
    state.state = "CLOSED";
    await f.save(state);
    await assert.rejects(f.ports.conclude({ ...conclusion, rolledOut: false }));
    assert.equal((await f.state()).state, "CLOSED");
    assert.equal((await f.state()).body, ownerBody);
  } finally {
    await f.close();
  }
});

test("production conclusion requires the exact first-line ownership marker", async () => {
  const f = await fixture();
  try {
    const state = await f.state();
    state.body = state.body.replace(" -->\n", " --> copied marker\n");
    await f.save(state);
    await assert.rejects(f.ports.conclude(conclusion));
    assert.equal((await f.requests()).length, 1);
    assert.equal((await f.state()).body, state.body);
  } finally {
    await f.close();
  }
});

test("production conclusion dedupes a receipt beyond the first provider page", async () => {
  const f = await fixture();
  try {
    await f.ports.conclude(conclusion);
    const state = await f.state();
    state.comments.unshift(
      ...Array.from({ length: 100 }, (_, id) => ({
        id: id + 100,
        body: `Owner discussion ${id}`,
      })),
    );
    await f.save(state);
    await f.ports.conclude(conclusion);
    assert.equal((await f.state()).comments.length, 101);
    assert.equal(
      (await f.requests()).filter((r) => r.args[1] === "comment").length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("production conclusion refuses incomplete bounded comment history before mutation", async () => {
  const f = await fixture();
  try {
    const state = await f.state();
    state.comments = Array.from({ length: 1000 }, (_, id) => ({
      id: id + 1,
      body: `Owner discussion ${id}`,
    }));
    await f.save(state);
    await assert.rejects(f.ports.conclude(conclusion));
    assert.equal((await f.state()).state, "OPEN");
    assert.equal(
      (await f.requests()).every(
        (r) => r.args[0] === "api" || r.args[1] === "view",
      ),
      true,
    );
  } finally {
    await f.close();
  }
});

for (const mode of ["no-op-comment", "lost-comment-response"])
  test(`production conclusion ${mode} remains durably unresolved in the public controller`, async () => {
    const f = await fixture(mode);
    let checks = 0;
    const ports: RepositoryRepairPorts = {
      ...f.ports,
      snapshot: async () => ({
        clean: true,
        base: "base",
        toolsDigest: "tools",
      }),
      createCandidate: async ({ directory, branch, base }) => ({
        root: directory,
        branch,
        base,
      }),
      checks: async () => ({
        passed: ++checks > 1,
        digest: "failure",
        actions: [
          {
            action: "check",
            exitCode: checks > 1 ? 0 : 1,
            outputSha256: "stable",
          },
        ],
      }),
      issue: async (fingerprint) => {
        const state = await f.state();
        state.body = `${renderRepositoryRepairIssue(fingerprint, true)}\nOwner note kept verbatim.\n`;
        await f.save(state);
        return 42;
      },
      implement: async () => {},
      changes: async () => ({
        paths: ["src/example.ts", "test/example.test.ts"],
        regression: true,
        unsafeEntries: false,
      }),
      commit: async () => "candidate",
      review: async (_candidate, head, reviewer) => ({
        head,
        reviewer,
        approved: true,
        findings: [],
      }),
      publish: async () => 43,
      pullRequest: async () => ({
        head: "candidate",
        base: "base",
        open: true,
        owned: true,
        ready: true,
        unresolvedThreads: 0,
        checks: REQUIRED_REPOSITORY_CHECKS.map((name) => ({
          name,
          head: "candidate",
          state: "SUCCESS",
        })),
      }),
      merge: async () => conclusion.mergeCommit,
      merged: async () => true,
      rollout: async () => ({ postmergeVerified: true, rolledOut: true }),
    };
    try {
      const report = await runRepositoryRepair({ ...f.input, ports });
      assert.equal(report.outcome, "blocked");
      assert.equal(report.code, "repair-stage-failed-reconciliation-required");
      const state = JSON.parse(
        await readFile(
          join(f.input.privateStateRoot, "repository-repair", "state.json"),
          "utf8",
        ),
      );
      assert.equal(state.stage, "conclude-intent");
      assert.equal((await f.state()).state, "OPEN");
    } finally {
      await f.close();
    }
  });
