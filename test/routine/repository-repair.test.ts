import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  eligibleRepositoryRepairPaths,
  readRepositoryRepairStatus,
  repositoryMergeReady,
  runRepositoryRepair,
} from "../../src/routine/repository-repair.js";
import {
  createRepositoryRepairPorts,
  renderRepositoryRepairIssue,
  renderRepositoryRepairPullRequest,
  repositoryDiagnosticSignature,
  repositorySandboxArguments,
  runRepositoryProcess,
} from "../../src/routine/repository-repair-adapters.js";
import { repositoryFixtureRoot } from "../../src/routine/repository-repair-process.js";
import {
  repositoryModelIsolationArguments,
  runRepositoryRepairSession,
} from "../../src/routine/repository-repair-session.js";
import {
  REQUIRED_REPOSITORY_CHECKS,
  type RepositoryCandidate,
  type RepositoryPullRequestState,
  type RepositoryRepairPorts,
} from "../../src/routine/repository-repair-types.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "repo-repair-test-"));
  const repositoryRoot = join(root, "repo"),
    privateStateRoot = join(root, "private");
  await mkdir(repositoryRoot);
  const fixtureRootPath = join(root, "fixture-temp");
  await mkdir(fixtureRootPath, { mode: 0o700 });
  const fixtureRoot = await realpath(fixtureRootPath);
  const calls: string[] = [];
  let checks = 0;
  const state: RepositoryPullRequestState = {
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
  };
  const ports: RepositoryRepairPorts = {
    snapshot: async () => ({ base: "base", clean: true, toolsDigest: "tools" }),
    createCandidate: async (input) => ({
      root: input.directory,
      base: input.base,
      branch: input.branch,
    }),
    checks: async () => {
      calls.push("check");
      checks++;
      return {
        passed: checks > 1,
        digest: "failure",
        actions: [
          {
            action: "check",
            exitCode: checks > 1 ? 0 : 1,
            outputSha256: "stable",
          },
        ],
      };
    },
    issue: async () => {
      calls.push("issue");
      return 1;
    },
    implement: async () => {
      calls.push("implement");
    },
    changes: async () => ({
      paths: ["src/example.ts", "test/example.test.ts"],
      unsafeEntries: false,
      regression: true,
    }),
    commit: async () => "candidate",
    review: async (_c, head, evidence) => {
      calls.push("review");
      return { head, reviewer: evidence, approved: true, findings: [] };
    },
    publish: async () => {
      calls.push("publish");
      return 2;
    },
    pullRequest: async () => state,
    merge: async () => {
      calls.push("merge");
      return "a".repeat(40);
    },
    merged: async () => true,
    conclude: async () => {
      calls.push("conclude");
    },
    rollout: async () => ({ postmergeVerified: true, rolledOut: true }),
  };
  return {
    root,
    fixtureRoot,
    calls,
    state,
    ports,
    input: {
      repositoryRoot,
      privateStateRoot,
      codexPath: "fixture",
      ghPath: "fixture",
      ports,
    },
    close: async () => rm(root, { recursive: true, force: true }),
  };
}

test("green checks use no model/GitHub and release own lock for next day", async () => {
  const f = await fixture();
  try {
    f.ports.checks = async () => ({ passed: true, digest: "ok", actions: [] });
    for (let n = 0; n < 2; n++)
      assert.equal((await runRepositoryRepair(f.input)).outcome, "healthy");
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});
test("check-only failure never dispatches model or public mutation", async () => {
  const f = await fixture();
  try {
    const r = await runRepositoryRepair({ ...f.input, checkOnly: true });
    assert.equal(r.code, "checks-failed");
    assert.deepEqual(f.calls, ["check"]);
  } finally {
    await f.close();
  }
});
test("repair requires two independent head-bound reviews before protected merge", async () => {
  const f = await fixture();
  try {
    const r = await runRepositoryRepair(f.input);
    assert.equal(r.outcome, "merged");
    assert.equal(r.mergeCommit, "a".repeat(40));
    const status = await readRepositoryRepairStatus(f.input.privateStateRoot);
    assert.equal(status.report?.outcome, "merged");
    assert.equal(status.report?.rolloutVerification, "passed");
    assert.deepEqual(f.calls, [
      "check",
      "issue",
      "implement",
      "check",
      "review",
      "review",
      "publish",
      "merge",
      "conclude",
    ]);
  } finally {
    await f.close();
  }
});
test("merged fact survives postmerge rollout refusal", async () => {
  const f = await fixture();
  try {
    f.ports.rollout = async () => ({
      postmergeVerified: true,
      rolledOut: false,
    });
    const r = await runRepositoryRepair(f.input);
    assert.equal(r.outcome, "blocked");
    assert.equal(r.mergeCommit, "a".repeat(40));
    assert.equal(r.rolloutVerification, "blocked");
    assert.equal(r.postmergeVerification, "passed");
    const status = await readRepositoryRepairStatus(f.input.privateStateRoot);
    assert.equal(status.report?.outcome, "blocked");
    assert.equal(status.report?.mergeCommit, "a".repeat(40));
  } finally {
    await f.close();
  }
});
test("out-of-scope patch cannot be committed or published", async () => {
  const f = await fixture();
  try {
    f.ports.changes = async () => ({
      paths: ["package.json"],
      unsafeEntries: false,
      regression: true,
    });
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "ineligible-repair-scope",
    );
    assert.equal(f.calls.includes("review"), false);
  } finally {
    await f.close();
  }
});
test("repeated failed fingerprint uses zero models until evidence changes", async () => {
  const f = await fixture();
  try {
    f.ports.changes = async () => ({
      paths: ["package.json"],
      unsafeEntries: false,
      regression: true,
    });
    f.ports.checks = async () => ({
      passed: false,
      digest: "bad",
      actions: [{ action: "check", exitCode: 1, outputSha256: "stable" }],
    });
    await runRepositoryRepair(f.input);
    f.calls.length = 0;
    assert.equal((await runRepositoryRepair(f.input)).outcome, "unchanged");
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});
test("pending exact-head checks resume without another implementer", async () => {
  const f = await fixture();
  try {
    f.state.ready = false;
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "protected-merge-not-ready",
    );
    f.calls.length = 0;
    f.state.ready = true;
    assert.equal((await runRepositoryRepair(f.input)).outcome, "merged");
    assert.deepEqual(f.calls, ["merge", "conclude"]);
  } finally {
    await f.close();
  }
});
test("unknown publish outcome holds lock and next run cannot duplicate publication", async () => {
  const f = await fixture();
  try {
    f.ports.publish = async () => {
      f.calls.push("publish");
      throw Error("unknown");
    };
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "repair-stage-failed-reconciliation-required",
    );
    assert.equal((await runRepositoryRepair(f.input)).outcome, "busy");
    assert.equal(f.calls.filter((x) => x === "publish").length, 1);
    const status = await readRepositoryRepairStatus(f.input.privateStateRoot);
    assert.equal((status as { outcome: string }).outcome, "observed");
    assert.match(
      await readFile(
        join(f.input.privateStateRoot, "repository-repair", "run.lock"),
        "utf8",
      ),
      /pid/,
    );
  } finally {
    await f.close();
  }
});
test("head/base/pending/unknown/thread failures refuse protected merge", () => {
  const checks = REQUIRED_REPOSITORY_CHECKS.map((name) => ({
    name,
    head: "head",
    state: "SUCCESS",
  }));
  const good = {
    head: "head",
    base: "base",
    owned: true,
    open: true,
    ready: true,
    unresolvedThreads: 0,
    checks,
  };
  assert.equal(repositoryMergeReady(good, "head", "base"), true);
  for (const bad of [
    { ...good, head: "other" },
    { ...good, base: "moved" },
    { ...good, unresolvedThreads: 1 },
    { ...good, checks: checks.map((x) => ({ ...x, state: "SKIPPED" })) },
  ])
    assert.equal(repositoryMergeReady(bad, "head", "base"), false);
});
test("scope restrictions and exact sandbox argv preserve critical boundaries", () => {
  assert.equal(
    eligibleRepositoryRepairPaths(["src/example.ts", "test/a.test.ts"]),
    true,
  );
  for (const path of [
    "src/security.ts",
    "docs/module-folder-contract.md",
    "skills/a.ts",
    "src/../package.json",
    ".github/workflows/a.ts",
  ])
    assert.equal(eligibleRepositoryRepairPaths([path]), false);
  const args = repositorySandboxArguments("/fixture", ["node", "fixture.js"]);
  assert.deepEqual(args.slice(0, 6), [
    "sandbox",
    "-P",
    ":workspace",
    "--include-managed-config",
    "-C",
    "/fixture",
  ]);
  assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(args.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
  assert.equal(
    args.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  );
});

test("production process runner rebases all temp roots and removes inherited synthetic secret", async () => {
  const f = await fixture();
  const key = "ACADEMIC_OS_SYNTHETIC_SECRET";
  const before = process.env[key];
  process.env[key] = "fixture-private";
  try {
    const r = await runRepositoryProcess({
      executable: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify({temp:[process.env.TMPDIR,process.env.TMP,process.env.TEMP],secret:process.env.ACADEMIC_OS_SYNTHETIC_SECRET??null}))",
      ],
      cwd: f.input.repositoryRoot,
    });
    const result = JSON.parse(r.output);
    assert.deepEqual(result.temp, [
      f.input.repositoryRoot,
      f.input.repositoryRoot,
      f.input.repositoryRoot,
    ]);
    assert.equal(result.secret, null);
    assert.equal(r.code, 0);
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
    await f.close();
  }
});

test("private child/state symlinks refuse before any port", async () => {
  for (const target of ["directory", "state"]) {
    const f = await fixture();
    try {
      await mkdir(f.input.privateStateRoot, { mode: 0o700 });
      const dir = join(f.input.privateStateRoot, "repository-repair");
      if (target === "directory") await symlink(f.input.repositoryRoot, dir);
      else {
        await mkdir(dir, { mode: 0o700 });
        const file = join(f.root, "outside.json");
        await writeFile(file, "{}", { mode: 0o600 });
        await symlink(file, join(dir, "state.json"));
      }
      const r = await runRepositoryRepair(f.input);
      assert.equal(
        r.code,
        target === "directory"
          ? "unsafe-private-directory"
          : "unsafe-private-state",
      );
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
});
test("shared private directory permissions refuse; known preflight refusal releases lock", async () => {
  const f = await fixture();
  try {
    const dir = join(f.input.privateStateRoot, "repository-repair");
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await chmod(dir, 0o755);
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "unsafe-private-directory",
    );
    await chmod(dir, 0o700);
    f.ports.snapshot = async () => ({
      base: "base",
      clean: false,
      toolsDigest: "tools",
    });
    for (let n = 0; n < 2; n++)
      assert.equal(
        (await runRepositoryRepair(f.input)).code,
        "primary-checkout-not-clean",
      );
  } finally {
    await f.close();
  }
});
test("missing terminal receipt never establishes health", async () => {
  const f = await fixture();
  try {
    const dir = join(f.input.privateStateRoot, "repository-repair");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({
        id: "fake",
        stage: "healthy",
        evidence: join(dir, "missing"),
      }),
      { mode: 0o600 },
    );
    const status = await readRepositoryRepairStatus(f.input.privateStateRoot);
    assert.notEqual(status.report?.outcome, "healthy");
  } finally {
    await f.close();
  }
});

test("generated public issue/PR carry truthful acceptance and conformance linkage", () => {
  const body = renderRepositoryRepairIssue("a".repeat(64));
  assert.match(body, /## Acceptance criteria/);
  assert.equal((body.match(/- \[ \]/g) ?? []).length, 2);
  const delivered = renderRepositoryRepairIssue("a".repeat(64), true);
  assert.equal((delivered.match(/- \[x\]/g) ?? []).length, 2);
  const pr = renderRepositoryRepairPullRequest(123);
  assert.match(pr, /Closes #123/);
  assert.match(
    pr,
    /\*\*#123 — Scheduled repository verification repair: 2 of 2 criteria delivered, nothing beyond the brief\.\*\*/,
  );
  assert.match(
    pr,
    /Assisted-by: GPT-6\.1 Sol \(medium\)\nCo-authored-by: OpenAI Codex <noreply@openai\.com>\n$/,
  );
  assert.doesNotMatch(pr, /private-path|token|credential/i);
});
test("actual diagnostic normalization retains distinct evidence while discarding timing/run noise", () => {
  assert.equal(
    repositoryDiagnosticSignature(
      "failure abc durationMs:10, /tmp/candidate",
      "/tmp/candidate",
    ),
    repositoryDiagnosticSignature(
      "failure abc durationMs:30, /other/candidate",
      "/other/candidate",
    ),
  );
  assert.notEqual(
    repositoryDiagnosticSignature(`failure ${"a".repeat(64)}`, "/fixture"),
    repositoryDiagnosticSignature(`failure ${"b".repeat(64)}`, "/fixture"),
  );
});
test("critical normative/safety/check implementation and mirrored tests remain outside autonomous repair", () => {
  for (const path of [
    "src/privacy/check.ts",
    "src/contract/load.ts",
    "src/mounted/write.ts",
    "src/config/types.ts",
    "src/capabilities/checks.ts",
    "scripts/check-contract-rule-coverage.mjs",
    "test/contract/a.test.ts",
    "src/routine/codex-module-session.ts",
    "test/routine/write-journal.test.ts",
  ])
    assert.equal(eligibleRepositoryRepairPaths([path]), false, path);
});

test("model external tools disabled per-call before dispatch with fail-closed metadata verification", async () => {
  const features = async () =>
    Object.fromEntries(
      [
        "plugins",
        "apps",
        "remote_plugin",
        "hooks",
        "browser_use",
        "browser_use_external",
        "computer_use",
      ].map((x) => [x, false]),
    );
  let lists = 0;
  const args = await repositoryModelIsolationArguments(async (overrides) => {
    lists++;
    return [
      {
        name: "synthetic",
        enabled: !overrides.includes("mcp_servers.synthetic.enabled=false"),
      },
    ];
  }, features);
  assert.equal(lists, 2);
  assert.ok(args.includes("features.apps=false"));
  assert.ok(args.includes("features.hooks=false"));
  assert.ok(args.includes("mcp_servers.synthetic.enabled=false"));
  await assert.rejects(
    repositoryModelIsolationArguments(
      async () => [{ name: "unsupported:name", enabled: true }],
      features,
    ),
    /Unsupported MCP/,
  );
  await assert.rejects(
    repositoryModelIsolationArguments(
      async () => [{ name: "synthetic", enabled: true }],
      features,
    ),
    /MCP isolation/,
  );
  await assert.rejects(
    repositoryModelIsolationArguments(
      async () => [],
      async () => ({ apps: true }),
    ),
    /External capability/,
  );
});
test("truncated diagnostics refuse useful repair and retain bounded process evidence", async () => {
  const f = await fixture();
  try {
    f.ports.checks = async () => ({
      passed: false,
      diagnosticsComplete: false,
      digest: "truncated",
      actions: [
        {
          action: "check",
          exitCode: 1,
          outputSha256: "abc",
          outputTruncated: true,
        },
      ],
    });
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "diagnostics-truncated",
    );
    assert.equal(f.calls.includes("implement"), false);
    const r = await runRepositoryProcess({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"],
      cwd: f.input.repositoryRoot,
    });
    assert.equal(r.outputTruncated, true);
    assert.equal(r.outputBytes, 2 * 1024 * 1024);
    assert.ok(r.output.length <= 1024 * 1024);
  } finally {
    await f.close();
  }
});

test("production session verifies tool isolation before model and rejects truncated model evidence", async () => {
  const f = await fixture();
  try {
    const codex = join(f.root, "synthetic-codex.mjs"),
      evidence = join(f.root, "session");
    await writeFile(
      codex,
      `#!/usr/bin/env node\nimport fs from 'node:fs';const a=process.argv.slice(2);if(a.includes('features')){for(const n of ['plugins','apps','remote_plugin','hooks','browser_use','browser_use_external','computer_use'])console.log(n+' stable false');}else if(a.includes('mcp'))console.log('[]');else{fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({summary:'fixture'}));process.stdout.write('x'.repeat(2*1024*1024));}\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      runRepositoryRepairSession({
        codexPath: codex,
        candidate: {
          root: f.input.repositoryRoot,
          fixtureRoot: f.fixtureRoot,
          branch: "fixture",
          base: "base",
        },
        evidence,
        git: async () => "",
      }),
      /truncated/,
    );
  } finally {
    await f.close();
  }
});

test("failed check-only observation cannot suppress the first authorized repair", async () => {
  const f = await fixture();
  try {
    let observations = 0;
    f.ports.checks = async () => {
      observations++;
      return {
        passed: observations >= 3,
        digest: "failure",
        actions: [
          {
            action: "check",
            exitCode: observations >= 3 ? 0 : 1,
            outputSha256: "stable",
          },
        ],
      };
    };
    const observation = await runRepositoryRepair({
      ...f.input,
      checkOnly: true,
    });
    assert.equal(observation.code, "checks-failed");
    assert.ok(observation.evidence);
    await readFile(join(observation.evidence, "blocked.json"));
    await assert.rejects(
      readFile(
        join(f.input.privateStateRoot, "repository-repair", "state.json"),
      ),
      { code: "ENOENT" },
    );
    assert.equal(
      (await readRepositoryRepairStatus(f.input.privateStateRoot)).outcome,
      "unobserved",
    );
    assert.equal((await runRepositoryRepair(f.input)).outcome, "merged");
    assert.equal(f.calls.filter((c) => c === "implement").length, 1);
  } finally {
    await f.close();
  }
});
test("healthy check-only preserves pending PR checkpoint bytes and next normal run resumes without worker", async () => {
  const f = await fixture();
  try {
    f.state.ready = false;
    assert.equal(
      (await runRepositoryRepair(f.input)).code,
      "protected-merge-not-ready",
    );
    const checkpoint = join(
        f.input.privateStateRoot,
        "repository-repair",
        "state.json",
      ),
      before = await readFile(checkpoint);
    const released: RepositoryCandidate[] = [];
    f.ports.releaseCandidate = async (candidate) => {
      released.push(candidate);
      return true;
    };
    const observation = await runRepositoryRepair({
      ...f.input,
      checkOnly: true,
    });
    assert.equal(observation.outcome, "healthy");
    assert.ok(observation.evidence);
    assert.equal(released.length, 1);
    const previous = JSON.parse(before.toString()) as {
      candidate: RepositoryCandidate;
    };
    assert.notEqual(released[0]?.root, previous.candidate.root);
    assert.equal(released[0]?.root, join(observation.evidence, "checkout"));
    assert.ok(observation.evidence);
    await readFile(join(observation.evidence, "healthy.json"));
    assert.deepEqual(await readFile(checkpoint), before);
    const status = await readRepositoryRepairStatus(f.input.privateStateRoot);
    assert.equal(status.stage, "awaiting-checks");
    assert.equal(status.report?.outcome, "blocked");
    f.calls.length = 0;
    f.state.ready = true;
    assert.equal((await runRepositoryRepair(f.input)).outcome, "merged");
    assert.deepEqual(f.calls, ["merge", "conclude"]);
  } finally {
    await f.close();
  }
});

test("healthy diagnostic release is exact, nonfatal on refusal, and never used after model or failure", async () => {
  for (const released of [true, false, "throw"] as const) {
    const f = await fixture();
    try {
      f.ports.checks = async () => ({
        passed: true,
        digest: "green",
        actions: [{ action: "check", exitCode: 0, outputSha256: "green" }],
      });
      const candidates: RepositoryCandidate[] = [];
      f.ports.releaseCandidate = async (candidate) => {
        candidates.push(candidate);
        if (released === "throw") throw new Error("fixture");
        return released;
      };
      const report = await runRepositoryRepair(f.input);
      assert.equal(report.outcome, "healthy");
      assert.equal(
        report.candidateCleanup,
        released === true ? "released" : "retained",
      );
      assert.ok(report.evidence);
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.root, join(report.evidence, "checkout"));
      const receipt = JSON.parse(
        await readFile(join(report.evidence, "healthy.json"), "utf8"),
      );
      assert.equal(receipt.candidateCleanup, report.candidateCleanup);
      assert.equal(
        (await readRepositoryRepairStatus(f.input.privateStateRoot)).report
          ?.candidateCleanup,
        report.candidateCleanup,
      );
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
  for (const checkOnly of [true, false]) {
    const f = await fixture();
    try {
      f.ports.releaseCandidate = async () => {
        throw new Error("Must never release failed or model-used checkout");
      };
      const report = await runRepositoryRepair({ ...f.input, checkOnly });
      assert.equal(report.outcome, checkOnly ? "blocked" : "merged");
      assert.equal(report.candidateCleanup, undefined);
    } finally {
      await f.close();
    }
  }
});

test("production release removes only owned unchanged diagnostics and refuses unexpected ignored content", async () => {
  const f = await fixture();
  try {
    const git = async (args: string[], cwd = f.input.repositoryRoot) => {
      const r = await runRepositoryProcess({
        executable: "/usr/bin/git",
        args,
        cwd,
      });
      assert.equal(r.code, 0);
      return r.output.trim();
    };
    await git(["init"]);
    await writeFile(
      join(f.input.repositoryRoot, ".gitignore"),
      "node_modules/\ndist/\n*.local\n",
    );
    await writeFile(
      join(f.input.repositoryRoot, "package.json"),
      JSON.stringify({ name: "synthetic-retirement", version: "1.0.0" }),
    );
    await writeFile(
      join(f.input.repositoryRoot, "package-lock.json"),
      JSON.stringify({
        name: "synthetic-retirement",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "synthetic-retirement", version: "1.0.0" } },
      }),
    );
    await git(["add", "."]);
    await git([
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "commit",
      "-m",
      "Synthetic fixture",
    ]);
    const base = await git(["rev-parse", "HEAD"]);
    const ports = createRepositoryRepairPorts(f.input);
    for (const unexpected of [false, true]) {
      const candidate = await ports.createCandidate({
        base,
        directory: join(f.root, `checkout-${unexpected}`),
        branch: `codex/fixture-${unexpected}`,
      });
      assert.ok(candidate.fixtureRoot);
      await writeFile(
        join(candidate.fixtureRoot, "synthetic-preview.png"),
        "retained synthetic render",
      );
      await mkdir(join(candidate.root, "dist"));
      await writeFile(
        join(candidate.root, "dist", "synthetic.js"),
        "// generated fixture",
      );
      if (unexpected)
        await writeFile(
          join(candidate.root, "private.local"),
          "synthetic ignored data",
        );
      assert.equal(
        await ports.releaseCandidate?.({ ...candidate, branch: "unowned" }),
        false,
      );
      assert.equal(await ports.releaseCandidate?.(candidate), !unexpected);
      assert.equal(
        await readFile(
          join(candidate.fixtureRoot, "synthetic-preview.png"),
          "utf8",
        ),
        "retained synthetic render",
      );
      if (unexpected)
        assert.equal(
          await readFile(join(candidate.root, "private.local"), "utf8"),
          "synthetic ignored data",
        );
      else
        await assert.rejects(readFile(join(candidate.root, "package.json")), {
          code: "ENOENT",
        });
    }
  } finally {
    await f.close();
  }
});

test("production worker explicitly supplies packaged helpers, Node/npm search and workspace temps without credentials", async () => {
  const f = await fixture();
  try {
    const bundle = join(f.root, "bundle"),
      bin = join(bundle, "bin"),
      helpers = join(bundle, "helpers");
    await mkdir(bin, { recursive: true });
    await mkdir(helpers);
    const codex = join(bin, "codex"),
      capture = join(f.root, "capture.json");
    await writeFile(join(helpers, "rg"), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    await writeFile(
      join(bundle, "codex-package.json"),
      JSON.stringify({
        layoutVersion: 1,
        variant: "codex",
        entrypoint: "bin/codex",
        pathDir: "helpers",
      }),
    );
    await writeFile(
      codex,
      `#!/usr/bin/env node\nimport fs from 'node:fs';const a=process.argv.slice(2);if(a.includes('features')){for(const n of ['plugins','apps','remote_plugin','hooks','browser_use','browser_use_external','computer_use'])console.log(n+' stable false');}else if(a.includes('mcp'))console.log('[]');else{fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:a,temp:process.env.TMPDIR,credentialKeys:Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD/.test(k))}));fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify(a.includes('read-only')?{approved:true,findings:[]}:{summary:'fixture'}));}\n`,
      { mode: 0o700 },
    );
    await runRepositoryRepairSession({
      codexPath: codex,
      candidate: {
        root: f.input.repositoryRoot,
        fixtureRoot: f.fixtureRoot,
        branch: "fixture",
        base: "base",
      },
      evidence: join(f.root, "session"),
      git: async () => "",
    });
    const captured = JSON.parse(await readFile(capture, "utf8")) as {
      args: string[];
      temp: string;
      credentialKeys: string[];
    };
    const configured = (name: string) => {
      const setting = captured.args.find((a) =>
        a.startsWith(`shell_environment_policy.set.${name}=`),
      );
      assert.ok(setting);
      return JSON.parse(setting.split("=").slice(1).join("=")) as string;
    };
    assert.ok(
      captured.args.includes('shell_environment_policy.inherit="none"'),
    );
    assert.ok(
      captured.args.includes(
        `sandbox_workspace_write.writable_roots=${JSON.stringify([f.fixtureRoot])}`,
      ),
    );
    assert.ok(configured("PATH").split(":").includes(helpers));
    assert.ok(configured("PATH").split(":").includes(bin));
    assert.ok(
      configured("PATH")
        .split(":")
        .includes(process.execPath.slice(0, process.execPath.lastIndexOf("/"))),
    );
    for (const name of ["TMPDIR", "TMP", "TEMP"])
      assert.equal(configured(name), f.fixtureRoot);
    assert.equal(configured("NODE_DISABLE_COMPILE_CACHE"), "1");
    assert.equal(captured.temp, f.fixtureRoot);
    assert.deepEqual(captured.credentialKeys, []);
    await runRepositoryRepairSession({
      codexPath: codex,
      candidate: {
        root: f.input.repositoryRoot,
        fixtureRoot: f.fixtureRoot,
        branch: "fixture",
        base: "base",
      },
      evidence: join(f.root, "review"),
      reviewHead: "a".repeat(40),
      git: async (args) => (args.includes("HEAD") ? "a".repeat(40) : ""),
    });
    const reviewed = JSON.parse(await readFile(capture, "utf8")) as {
      args: string[];
    };
    assert.equal(
      reviewed.args.some((a) =>
        a.startsWith("sandbox_workspace_write.writable_roots="),
      ),
      false,
    );
    assert.equal(
      reviewed.args[reviewed.args.indexOf("--sandbox") + 1],
      "read-only",
    );
  } finally {
    await f.close();
  }
});

test("fixture temporary roots refuse missing, checkout-contained, permissive and symlink roots", async () => {
  const f = await fixture();
  try {
    assert.equal(
      await repositoryFixtureRoot(f.input.repositoryRoot, f.fixtureRoot),
      f.fixtureRoot,
    );
    await assert.rejects(
      repositoryFixtureRoot(f.input.repositoryRoot, undefined),
      /unavailable/,
    );
    await assert.rejects(
      repositoryFixtureRoot(f.input.repositoryRoot, f.input.repositoryRoot),
      /Unsafe/,
    );
    const nested = join(f.input.repositoryRoot, "nested-temp");
    await mkdir(nested, { mode: 0o700 });
    await assert.rejects(
      repositoryFixtureRoot(f.input.repositoryRoot, nested),
      /Unsafe/,
    );
    await chmod(f.fixtureRoot, 0o755);
    await assert.rejects(
      repositoryFixtureRoot(f.input.repositoryRoot, f.fixtureRoot),
      /Unsafe/,
    );
    await chmod(f.fixtureRoot, 0o700);
    const link = join(f.root, "alias-temp");
    await symlink(f.fixtureRoot, link);
    await assert.rejects(
      repositoryFixtureRoot(f.input.repositoryRoot, link),
      /Unsafe/,
    );
  } finally {
    await f.close();
  }
});

test("failure signatures normalize owned fixture roots and first mkdtemp component without collapsing evidence", () => {
  const first = "/private/run-1/fixture-temp-a1B2c3",
    second = "/private/run-2/fixture-temp-Z9y8x7";
  const signature = (
    root: string,
    suffix: string,
    message = "unsafe-state-root",
  ) =>
    repositoryDiagnosticSignature(
      `OperationalError: ${message} at '${root}/academic-os-calendar-launchd-${suffix}/state/receipt.json'`,
      "/repository/checkout",
      root,
    );
  assert.equal(signature(first, "ABC123"), signature(second, "xyz789"));
  assert.notEqual(
    signature(first, "ABC123"),
    signature(second, "xyz789", "source-missing"),
  );
  assert.notEqual(
    repositoryDiagnosticSignature(
      `${first}/fixture-a1B2c3/nested/file-ABC123`,
      "/repository/checkout",
      first,
    ),
    repositoryDiagnosticSignature(
      `${second}/fixture-x9Y8z7/nested/file-XYZ789`,
      "/repository/checkout",
      second,
    ),
  );
  assert.notEqual(
    repositoryDiagnosticSignature(
      `${first}-external/fixture-ABC123`,
      "/repository/checkout",
      first,
    ),
    repositoryDiagnosticSignature(
      `${second}-external/fixture-xyz789`,
      "/repository/checkout",
      second,
    ),
  );
  assert.notEqual(
    repositoryDiagnosticSignature(
      "/external/fixture-ABC123",
      "/repository/checkout",
      first,
    ),
    repositoryDiagnosticSignature(
      "/external/fixture-xyz789",
      "/repository/checkout",
      second,
    ),
  );
});
