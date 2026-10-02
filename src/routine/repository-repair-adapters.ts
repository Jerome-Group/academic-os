import {
  repositoryDiagnosticSignature,
  repositorySandboxArguments,
  runRepositoryProcess,
} from "./repository-repair-process.js";
import { runRepositoryRepairSession } from "./repository-repair-session.js";

export {
  repositoryDiagnosticSignature,
  repositorySandboxArguments,
  runRepositoryProcess,
} from "./repository-repair-process.js";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  RepositoryCandidate,
  RepositoryCheckEvidence,
  RepositoryPullRequestState,
  RepositoryRepairPorts,
} from "./repository-repair-types.js";

const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const checks = ["check"];

export function renderRepositoryRepairIssue(
  fingerprint: string,
  delivered = false,
): string {
  const mark = delivered ? "x" : " ";
  return `<!-- academic-os-repository-repair:v1 fingerprint=${fingerprint} -->\n\nA reproducible scheduled public repository verification failure needs an isolated repair. Private diagnostics remain local.\n\n## Acceptance criteria\n\n- [${mark}] Meaningful synthetic regression and local checks on the exact repair head.\n- [${mark}] Two independent exact-head reviews with findings resolved.\n\nProtected remote checks, postmerge verification and rollout are separate execution evidence.\n`;
}

export function renderRepositoryRepairPullRequest(issue: number): string {
  return `Fix the reproduced repository verification failure with a meaningful synthetic regression.\n\nCloses #${issue}\n\nValidation: sandboxed exact-head local checks and two independent read-only reviews. Protected remote checks, postmerge verification and rollout remain separate gates.\n\n**#${issue} — Scheduled repository verification repair: 2 of 2 criteria delivered, nothing beyond the brief.**\n\nAssisted-by: GPT-6.1 Sol (medium)\nCo-authored-by: OpenAI Codex <noreply@openai.com>\n`;
}

export function createRepositoryRepairPorts(input: {
  repositoryRoot: string;
  privateStateRoot: string;
  codexPath: string;
  ghPath: string;
}): RepositoryRepairPorts {
  const ownedCandidates = new Map<
    string,
    {
      candidate: RepositoryCandidate;
      dev: number;
      ino: number;
    }
  >();
  const git = async (args: string[], cwd = input.repositoryRoot) => {
    const r = await runRepositoryProcess({
      executable: "/usr/bin/git",
      args,
      cwd,
    });
    if (r.code !== 0) throw new Error("Repository git operation failed.");
    return r.output.trim();
  };
  const gh = async (args: string[]) => {
    const r = await runRepositoryProcess({
      executable: input.ghPath,
      args,
      cwd: input.repositoryRoot,
      cleanEnvironment: false,
    });
    if (r.code !== 0) throw new Error("Repository GitHub operation failed.");
    return r.output;
  };
  async function checked(
    candidate: RepositoryCandidate,
    evidence: string,
  ): Promise<RepositoryCheckEvidence> {
    await mkdir(evidence, { mode: 0o700 });
    const actions = [];
    let diagnosticsComplete = true;
    for (const action of checks) {
      const r = await runRepositoryProcess({
        executable: input.codexPath,
        args: repositorySandboxArguments(candidate.root, [
          "npm",
          "run",
          action,
        ]),
        cwd: candidate.root,
        log: join(evidence, `${action.replace(":", "-")}.log`),
      });
      const diagnostics: string[] = [];
      if (r.outputTruncated) diagnosticsComplete = false;
      if (r.code !== 0) {
        let failed: string[] = [];
        try {
          const report = JSON.parse(
            r.output.slice(r.output.indexOf("\n{") + 1),
          ) as { checks: { action: string; outcome: string }[] };
          failed = report.checks
            .filter((c) => c.outcome !== "passed")
            .map((c) => c.action.replace(/^npm run /u, ""))
            .filter((c) =>
              [
                "format:check",
                "lint",
                "build",
                "cheatsheet-runtime:check",
                "rule-coverage:check",
                "templates:check",
              ].includes(c),
            );
        } catch {
          diagnostics.push(r.output);
        }
        for (const failedAction of failed.slice(0, 3)) {
          const diagnostic = await runRepositoryProcess({
            executable: input.codexPath,
            args: repositorySandboxArguments(candidate.root, [
              "npm",
              "run",
              failedAction,
            ]),
            cwd: candidate.root,
            log: join(
              evidence,
              `diagnostic-${failedAction.replace(":", "-")}.log`,
            ),
          });
          if (diagnostic.outputTruncated) diagnosticsComplete = false;
          diagnostics.push(
            `${failedAction} exit=${diagnostic.code}\n${diagnostic.output}`,
          );
        }
        if (failed.length > 3)
          diagnostics.push(
            "Additional failed actions omitted from bounded diagnosis.",
          );
        if (diagnostics.length === 0) diagnostics.push(r.output);
      }
      actions.push({
        action,
        exitCode: r.code,
        outputSha256: r.digest,
        outputTruncated: !diagnosticsComplete,
        failureSignature: repositoryDiagnosticSignature(
          diagnostics.join("\n"),
          candidate.root,
        ),
      });
    }
    return {
      passed: actions.every((a) => a.exitCode === 0),
      diagnosticsComplete,
      digest: sha(JSON.stringify(actions)),
      actions,
    };
  }
  const session = (
    candidate: RepositoryCandidate,
    evidence: string,
    reviewHead?: string,
  ) =>
    runRepositoryRepairSession({
      codexPath: input.codexPath,
      candidate,
      evidence,
      git,
      ...(reviewHead === undefined ? {} : { reviewHead }),
    });
  const ports: RepositoryRepairPorts = {
    snapshot: async () => {
      await git(["fetch", "origin", "main"]);
      const head = await git(["rev-parse", "HEAD"]),
        base = await git(["rev-parse", "origin/main"]);
      return {
        base,
        clean:
          (await git(["status", "--porcelain"])) === "" &&
          head === base &&
          (await git(["branch", "--show-current"])) === "main",
        toolsDigest: sha(
          Buffer.concat([
            await readFile(input.codexPath),
            await readFile(input.ghPath),
            Buffer.from(process.version),
          ]),
        ),
      };
    },
    createCandidate: async ({ base, directory, branch }) => {
      await git(["worktree", "add", "--detach", directory, base]);
      await git(["checkout", "-b", branch], directory);
      const candidate = { root: await realpath(directory), branch, base };
      // Install only the captured lockfile; lifecycle scripts cannot execute outside the sandbox.
      const install = await runRepositoryProcess({
        executable: "npm",
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: candidate.root,
      });
      if (install.code !== 0)
        throw new Error("Candidate dependencies unavailable.");
      const metadata = await lstat(candidate.root);
      ownedCandidates.set(candidate.root, {
        candidate: { ...candidate },
        dev: metadata.dev,
        ino: metadata.ino,
      });
      return candidate;
    },
    releaseCandidate: async (candidate) => {
      const owned = ownedCandidates.get(candidate.root);
      if (
        !owned ||
        owned.candidate.base !== candidate.base ||
        owned.candidate.branch !== candidate.branch
      )
        return false;
      const metadata = await lstat(candidate.root);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.dev !== owned.dev ||
        metadata.ino !== owned.ino ||
        (await realpath(candidate.root)) !== candidate.root ||
        (await git(["rev-parse", "HEAD"], candidate.root)) !== candidate.base ||
        (await git(["branch", "--show-current"], candidate.root)) !==
          candidate.branch ||
        (await git(["status", "--porcelain"], candidate.root)) !== ""
      )
        return false;
      // Only dependency/build output belongs to a never-model-used diagnostic checkout.
      const ignored = await git(
        ["status", "--porcelain", "--ignored"],
        candidate.root,
      );
      if (
        ignored
          .split("\n")
          .filter(Boolean)
          .some((line) => !["!! node_modules/", "!! dist/"].includes(line))
      )
        return false;
      for (const name of ["node_modules", "dist"]) {
        const entry = await lstat(join(candidate.root, name)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (entry && (!entry.isDirectory() || entry.isSymbolicLink()))
          return false;
      }
      const removal = await runRepositoryProcess({
        executable: "/usr/bin/git",
        args: ["worktree", "remove", candidate.root],
        cwd: input.repositoryRoot,
      });
      if (removal.code !== 0) return false;
      ownedCandidates.delete(candidate.root);
      return true;
    },
    checks: checked,
    issue: async (fingerprint) => {
      const marker = `<!-- academic-os-repository-repair:v1 fingerprint=${fingerprint} -->`;
      const matches = JSON.parse(
        await gh([
          "issue",
          "list",
          "--state",
          "all",
          "--search",
          marker,
          "--json",
          "number,body",
          "--limit",
          "100",
        ]),
      ) as { number: number; body: string }[];
      const existing = matches.find((x) => x.body.startsWith(marker));
      if (existing) return existing.number;
      const file = join(
        input.privateStateRoot,
        "repository-repair",
        `${randomUUID()}-issue.md`,
      );
      await writeFile(file, renderRepositoryRepairIssue(fingerprint), {
        flag: "wx",
        mode: 0o600,
      });
      const out = await gh([
        "issue",
        "create",
        "--title",
        "Scheduled repository verification repair",
        "--body-file",
        file,
        "--label",
        "ready-for-agent",
        "--label",
        "bug",
      ]);
      const number = Number(/\/(\d+)\s*$/u.exec(out)?.[1]);
      if (!Number.isSafeInteger(number))
        throw new Error("Issue outcome unknown.");
      return number;
    },
    implement: async (candidate, evidence) => {
      await session(candidate, join(evidence, "implementer"));
    },
    changes: async (candidate) => {
      const paths = (await git(["diff", "--name-only", "HEAD"], candidate.root))
        .split("\n")
        .filter(Boolean);
      const untracked = (
        await git(
          ["ls-files", "--others", "--exclude-standard"],
          candidate.root,
        )
      )
        .split("\n")
        .filter(Boolean);
      paths.push(...untracked);
      let unsafeEntries = false;
      for (const path of paths) {
        try {
          const entry = await lstat(join(candidate.root, path));
          if (!entry.isFile() || entry.isSymbolicLink()) unsafeEntries = true;
        } catch {
          unsafeEntries = true;
        }
      }
      return {
        paths: [...new Set(paths)],
        unsafeEntries,
        regression: paths.some((p) => /^test\/.*\.test\.ts$/u.test(p)),
      };
    },
    commit: async (candidate) => {
      await git(["add", "--all"], candidate.root);
      await git(
        [
          "commit",
          "-m",
          "Fix scheduled repository verification\n\nAssisted-by: GPT-6.1 Sol (medium)\nCo-authored-by: OpenAI Codex <noreply@openai.com>",
        ],
        candidate.root,
      );
      return await git(["rev-parse", "HEAD"], candidate.root);
    },
    review: async (candidate, head, evidence) => {
      const r = await session(candidate, evidence, head);
      if (!r) throw new Error("Review missing.");
      return r;
    },
    publish: async (candidate, issue, head) => {
      if ((await git(["rev-parse", "HEAD"], candidate.root)) !== head)
        throw new Error("Publish head changed.");
      const owned = JSON.parse(
        await gh(["issue", "view", String(issue), "--json", "body"]),
      ) as { body: unknown };
      const fingerprint =
        typeof owned.body === "string"
          ? /^<!-- academic-os-repository-repair:v1 fingerprint=([a-f0-9]{64}) -->/u.exec(
              owned.body,
            )?.[1]
          : undefined;
      if (!fingerprint) throw new Error("Issue ownership unavailable.");
      const acceptance = join(
        input.privateStateRoot,
        "repository-repair",
        `${randomUUID()}-acceptance.md`,
      );
      await writeFile(
        acceptance,
        renderRepositoryRepairIssue(fingerprint, true),
        { flag: "wx", mode: 0o600 },
      );
      await gh(["issue", "edit", String(issue), "--body-file", acceptance]);
      await git(["push", "origin", candidate.branch], candidate.root);
      const file = join(
        input.privateStateRoot,
        "repository-repair",
        `${randomUUID()}-pr.md`,
      );
      await writeFile(file, renderRepositoryRepairPullRequest(issue), {
        flag: "wx",
        mode: 0o600,
      });
      const out = await gh([
        "pr",
        "create",
        "--head",
        candidate.branch,
        "--base",
        "main",
        "--title",
        "Fix scheduled repository verification",
        "--body-file",
        file,
      ]);
      const number = Number(/\/(\d+)\s*$/u.exec(out)?.[1]);
      if (!Number.isSafeInteger(number)) throw new Error("PR outcome unknown.");
      return number;
    },
    pullRequest: async (number) => {
      let state: RepositoryPullRequestState | undefined;
      for (let n = 0; n < 16; n++) {
        const p = JSON.parse(
          await gh([
            "pr",
            "view",
            String(number),
            "--json",
            "headRefOid,baseRefOid,headRefName,state,isCrossRepository,mergeStateStatus,statusCheckRollup",
          ]),
        ) as {
          headRefOid: string;
          baseRefOid: string;
          headRefName: string;
          state: string;
          isCrossRepository: boolean;
          mergeStateStatus: string;
          statusCheckRollup: {
            name?: string;
            context?: string;
            conclusion?: string;
            state?: string;
          }[];
        };
        const threads = JSON.parse(
          await gh([
            "api",
            "graphql",
            "-f",
            "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}",
            "-f",
            "owner=Jerome-Group",
            "-f",
            "name=academic-os",
            "-F",
            `number=${number}`,
          ]),
        );
        const t = threads.data.repository.pullRequest.reviewThreads as {
          pageInfo: { hasNextPage: boolean };
          nodes: { isResolved: boolean }[];
        };
        state = {
          head: p.headRefOid,
          base: p.baseRefOid,
          open: p.state === "OPEN",
          owned:
            !p.isCrossRepository &&
            p.headRefName.startsWith("codex/daily-repair-"),
          ready: p.mergeStateStatus === "CLEAN",
          unresolvedThreads: t.pageInfo.hasNextPage
            ? 1
            : t.nodes.filter((x) => !x.isResolved).length,
          checks: p.statusCheckRollup.map((c) => ({
            name: c.name ?? c.context ?? "",
            head: p.headRefOid,
            state: c.conclusion ?? c.state ?? "UNKNOWN",
          })),
        };
        if (
          state.ready ||
          !state.open ||
          state.checks.some((c) =>
            ["FAILURE", "CANCELLED", "TIMED_OUT"].includes(c.state),
          )
        )
          break;
        if (n < 15) await sleep(30_000);
      }
      if (!state) throw new Error("PR state unavailable.");
      return state;
    },
    merge: async (number, head) => {
      await gh([
        "pr",
        "merge",
        String(number),
        "--squash",
        "--match-head-commit",
        head,
      ]);
      const p = JSON.parse(
        await gh(["pr", "view", String(number), "--json", "mergeCommit"]),
      );
      if (typeof p.mergeCommit?.oid !== "string")
        throw new Error("Merge outcome unknown.");
      return p.mergeCommit.oid;
    },
    merged: async (number, head, merge) => {
      const p = JSON.parse(
        await gh([
          "pr",
          "view",
          String(number),
          "--json",
          "state,headRefOid,mergeCommit",
        ]),
      );
      return (
        p.state === "MERGED" &&
        p.headRefOid === head &&
        p.mergeCommit?.oid === merge
      );
    },
    conclude: async ({
      issue,
      fingerprint,
      pullRequest,
      mergeCommit,
      postmergeVerified,
      rolledOut,
    }) => {
      const marker = `<!-- academic-os-repository-repair:v1 fingerprint=${fingerprint} -->`;
      const existing = JSON.parse(
        await gh(["issue", "view", String(issue), "--json", "body"]),
      ) as { body: unknown };
      if (
        typeof existing.body !== "string" ||
        !existing.body.startsWith(marker)
      )
        throw new Error("Issue ownership changed.");
      const file = join(
        input.privateStateRoot,
        "repository-repair",
        `${randomUUID()}-conclusion.md`,
      );
      await writeFile(
        file,
        `${renderRepositoryRepairIssue(fingerprint, true)}\nMerged PR #${pullRequest} (${mergeCommit}). Combined-main verification: ${postmergeVerified ? "passed" : "blocked"}; primary rollout: ${rolledOut ? "passed" : "blocked"}.\n`,
        { flag: "wx", mode: 0o600 },
      );
      await gh(["issue", "edit", String(issue), "--body-file", file]);
      await gh([
        "issue",
        postmergeVerified && rolledOut ? "close" : "reopen",
        String(issue),
      ]);
    },
    rollout: async (candidate, originalBase, merge, evidence) => {
      await git(["fetch", "origin", "main"]);
      if ((await git(["rev-parse", "origin/main"])) !== merge)
        return { postmergeVerified: false, rolledOut: false };
      const root = join(evidence, "merged-checkout");
      await git(["worktree", "add", "--detach", root, merge]);
      const install = await runRepositoryProcess({
        executable: "npm",
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: root,
      });
      if (install.code !== 0)
        return { postmergeVerified: false, rolledOut: false };
      if (
        !(
          await checked(
            { ...candidate, root, base: merge },
            join(evidence, "postmerge"),
          )
        ).passed
      )
        return { postmergeVerified: false, rolledOut: false };
      await git(["fetch", "origin", "main"]);
      if ((await git(["rev-parse", "origin/main"])) !== merge)
        return { postmergeVerified: true, rolledOut: false };
      if (
        (await git(["status", "--porcelain"])) !== "" ||
        (await git(["rev-parse", "HEAD"])) !== originalBase ||
        (await git(["branch", "--show-current"])) !== "main"
      )
        return { postmergeVerified: true, rolledOut: false };
      await git(["merge", "--ff-only", merge]);
      const build = await runRepositoryProcess({
        executable: input.codexPath,
        args: repositorySandboxArguments(input.repositoryRoot, [
          "npm",
          "run",
          "build",
        ]),
        cwd: input.repositoryRoot,
        log: join(evidence, "rollout.log"),
      });
      return { postmergeVerified: true, rolledOut: build.code === 0 };
    },
  };
  return ports;
}
