import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { codexSearchDirectories } from "./codex-search-path.js";
import {
  repositoryFixtureRoot,
  runRepositoryProcess,
} from "./repository-repair-process.js";
import type {
  RepositoryCandidate,
  RepositoryReview,
} from "./repository-repair-types.js";

const MODEL = "gpt-6.1-sol",
  EFFORT = "medium";
const isolatedFeatures = [
  "plugins",
  "apps",
  "remote_plugin",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
] as const;
export async function repositoryModelIsolationArguments(
  list: (overrides: string[]) => Promise<{ name: string; enabled: boolean }[]>,
  features: (overrides: string[]) => Promise<Record<string, boolean>>,
): Promise<string[]> {
  const base = [...isolatedFeatures, "codex_hooks"].flatMap((name) => [
    "-c",
    `features.${name}=false`,
  ]);
  async function verify(overrides: string[]) {
    const state = await features(overrides);
    if (isolatedFeatures.some((name) => state[name] !== false))
      throw new Error("External capability isolation unavailable.");
  }
  await verify(base);
  const discovered = await list(base);
  if (discovered.some((s) => !/^[A-Za-z0-9_-]+$/u.test(s.name)))
    throw new Error("Unsupported MCP identifier.");
  const flags = [
    ...base,
    ...discovered.flatMap((s) => ["-c", `mcp_servers.${s.name}.enabled=false`]),
  ];
  const verified = await list(flags);
  if (
    verified.some(
      (s) => s.enabled || !discovered.some((d) => d.name === s.name),
    ) ||
    verified.length !== discovered.length
  )
    throw new Error("MCP isolation unverified.");
  await verify(flags);
  return flags;
}

export async function inspectRepositoryModelIsolation(input: {
  codexPath: string;
  cwd: string;
}): Promise<string[]> {
  return await repositoryModelIsolationArguments(
    async (overrides) => {
      const r = await runRepositoryProcess({
        executable: input.codexPath,
        args: ["mcp", "list", "--json", ...overrides],
        cwd: input.cwd,
        timeoutMs: 30_000,
      });
      if (r.code !== 0 || r.outputTruncated)
        throw new Error("MCP isolation unavailable.");
      const values: unknown = JSON.parse(r.output);
      if (
        !Array.isArray(values) ||
        values.some(
          (v) =>
            typeof v !== "object" ||
            v === null ||
            typeof v.name !== "string" ||
            typeof v.enabled !== "boolean",
        )
      )
        throw new Error("MCP enumeration invalid.");
      return values as { name: string; enabled: boolean }[];
    },
    async (overrides) => {
      const r = await runRepositoryProcess({
        executable: input.codexPath,
        args: ["features", "list", ...overrides],
        cwd: input.cwd,
        timeoutMs: 30_000,
      });
      if (r.code !== 0 || r.outputTruncated)
        throw new Error("Feature isolation unavailable.");
      const state: Record<string, boolean> = {};
      for (const line of r.output.split("\n")) {
        const m = /^([A-Za-z0-9_-]+)\s+\S+\s+(true|false)\s*$/u.exec(line);
        if (m?.[1]) state[m[1]] = m[2] === "true";
      }
      return state;
    },
  );
}

export async function runRepositoryRepairSession(input: {
  codexPath: string;
  candidate: RepositoryCandidate;
  evidence: string;
  reviewHead?: string;
  git: (args: string[], cwd: string) => Promise<string>;
}): Promise<RepositoryReview | undefined> {
  const { candidate, evidence, reviewHead, git } = input;
  const temporaryRoot = await repositoryFixtureRoot(
    candidate.root,
    candidate.fixtureRoot,
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const schema = join(evidence, `${id}-schema.json`),
    result = join(evidence, `${id}-result.json`);
  const schemaObject =
    reviewHead === undefined
      ? {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: { summary: { type: "string" } },
        }
      : {
          type: "object",
          additionalProperties: false,
          required: ["approved", "findings"],
          properties: {
            approved: { type: "boolean" },
            findings: { type: "array", items: { type: "string" } },
          },
        };
  await writeFile(schema, JSON.stringify(schemaObject), {
    flag: "wx",
    mode: 0o600,
  });
  const prompt =
    reviewHead === undefined
      ? `Read the retained concrete failure diagnostics in ${join(dirname(evidence), "baseline")}. Fix the reproduced public repository failure and add a meaningful synthetic regression. Read repository instructions; eligibleRepositoryRepairPaths in src/routine/repository-repair.ts owns the permitted edit scope. Preserve that controller and all excluded guards. Use public code and synthetic data only; no academic content, credentials, global settings, GitHub publication, commits or external writes. Your shell commands run in the enforced workspace sandbox with network disabled. Explain the repair in the structured result.`
      : `Independent read-only review of exact head ${reviewHead}. Read repository instructions and git diff ${candidate.base}..${reviewHead}, review synthetic regression and behavior/security. No edits, commits, publication, credentials or external access. Report approved only if no material findings; otherwise provide findings. Do not trust implementer claims.`;
  const isolation = await inspectRepositoryModelIsolation({
    codexPath: input.codexPath,
    cwd: candidate.root,
  });
  await writeFile(
    join(evidence, `${id}-isolation.json`),
    JSON.stringify({
      schemaVersion: 1,
      metadataVerified: true,
      servingExposure: "untested",
      flags: isolation,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const args = [
    ...isolation,
    "exec",
    "--model",
    MODEL,
    "-c",
    `model_reasoning_effort="${EFFORT}"`,
    "-c",
    'approval_policy="never"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "-c",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c",
    "sandbox_workspace_write.exclude_slash_tmp=true",
    "-c",
    'shell_environment_policy.inherit="none"',
    ...Object.entries({
      PATH: [
        ...codexSearchDirectories(input.codexPath),
        dirname(process.execPath),
        process.env.PATH,
      ]
        .filter(Boolean)
        .join(delimiter),
      TMPDIR: temporaryRoot,
      TMP: temporaryRoot,
      TEMP: temporaryRoot,
      NODE_DISABLE_COMPILE_CACHE: "1",
    }).flatMap(([name, value]) => [
      "-c",
      `shell_environment_policy.set.${name}=${JSON.stringify(value)}`,
    ]),
    ...(reviewHead === undefined
      ? [
          "-c",
          `sandbox_workspace_write.writable_roots=${JSON.stringify([temporaryRoot])}`,
        ]
      : []),
    "--sandbox",
    reviewHead === undefined ? "workspace-write" : "read-only",
    "--ephemeral",
    "--json",
    "--output-schema",
    schema,
    "--output-last-message",
    result,
    prompt,
  ];
  const r = await runRepositoryProcess({
    executable: input.codexPath,
    args,
    cwd: candidate.root,
    temporaryRoot,
    log: join(evidence, `${id}-session.jsonl`),
    timeoutMs: 20 * 60_000,
  });
  if (r.code !== 0 || r.outputTruncated)
    throw new Error("Repository model session failed or evidence truncated.");
  const value: unknown = JSON.parse(await readFile(result, "utf8"));
  if (reviewHead === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    !("approved" in value) ||
    typeof value.approved !== "boolean" ||
    !("findings" in value) ||
    !Array.isArray(value.findings) ||
    value.findings.some((x) => typeof x !== "string")
  )
    throw new Error("Invalid independent review result.");
  if (
    (await git(["rev-parse", "HEAD"], candidate.root)) !== reviewHead ||
    (await git(["status", "--porcelain"], candidate.root)) !== ""
  )
    throw new Error("Review changed immutable head.");
  return {
    head: reviewHead,
    reviewer: id,
    approved: value.approved,
    findings: value.findings,
  };
}
