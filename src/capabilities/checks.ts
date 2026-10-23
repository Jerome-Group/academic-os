import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const checkProfiles = {
  fast: ["format:check", "lint", "build", "cheatsheet-runtime:check"],
  tests: ["test"],
  privacy: ["privacy:check"],
  templates: ["templates:check"],
  coverage: ["rule-coverage:check"],
  formal: ["seed-ownership:check"],
  full: [
    "format:check",
    "lint",
    "build",
    "cheatsheet-runtime:check",
    "rule-coverage:check",
    "templates:check",
    "seed-ownership:check",
  ],
} as const;
export type CheckProfile = keyof typeof checkProfiles;

export interface ProcessEvidence {
  action: string;
  outcome: "passed" | "failed" | "timed-out" | "unavailable";
  exitCode: number | null;
  durationMs: number;
  outputBytes: number;
  outputSha256: string;
}

const diagnostics = new WeakMap<
  object,
  { stdout: string; stderr: string; truncated: boolean }
>();
export function privateProcessDiagnostics(value: unknown): object | undefined {
  return typeof value === "object" && value !== null
    ? diagnostics.get(value)
    : undefined;
}

export async function observeProcess(input: {
  action: string;
  executable: string;
  arguments: string[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<ProcessEvidence> {
  const started = performance.now();
  return await new Promise((resolve) => {
    const child = spawn(input.executable, input.arguments, {
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    const hash = createHash("sha256");
    let outputBytes = 0;
    let timedOut = false;
    let unavailable = false;
    const captured = { stdout: "", stderr: "", truncated: false };
    for (const [name, stream] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ] as const)
      stream.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        outputBytes += chunk.length;
        const text = captured[name] + chunk.toString("utf8");
        if (Buffer.byteLength(text) > 16_384) captured.truncated = true;
        captured[name] = text.slice(-16_384);
      });
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    }, input.timeoutMs ?? 480_000);
    child.on("error", () => {
      unavailable = true;
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const evidence: ProcessEvidence = {
        action: input.action,
        outcome: unavailable
          ? "unavailable"
          : timedOut
            ? "timed-out"
            : exitCode === 0
              ? "passed"
              : "failed",
        exitCode,
        durationMs: Math.round(performance.now() - started),
        outputBytes,
        outputSha256: hash.digest("hex"),
      };
      diagnostics.set(evidence, captured);
      resolve(evidence);
    });
  });
}

export async function runChecks(
  profile: CheckProfile,
  root: string,
): Promise<ProcessEvidence[]> {
  const results: ProcessEvidence[] = [];
  const started = performance.now();
  for (const script of checkProfiles[profile])
    results.push(
      await observeProcess({
        action: `npm run ${script}`,
        executable: "npm",
        arguments: ["run", script],
        cwd: root,
        timeoutMs: Math.max(1, 540_000 - (performance.now() - started)),
      }),
    );
  if (profile === "templates" || profile === "full")
    results.push(
      await observeProcess({
        action: "synthetic cheatsheet journey",
        executable: process.execPath,
        arguments: ["scripts/synthetic-cheatsheet-journey.mjs"],
        cwd: root,
        timeoutMs: Math.max(1, 540_000 - (performance.now() - started)),
      }),
    );
  return results;
}

const workflowTests = {
  discovery: {
    areas: ["capabilities"],
    cli: /^(argument-safety|offering-readiness-cli)\.test\.js$/u,
  },
  imports: {
    areas: ["imports"],
    cli: /^imports-(status|preflight)-cli\.test\.js$/u,
  },
  recovery: {
    areas: ["repair", "seed", "pinned"],
    cli: /^(audit|cohort-audit|research-project|pinned-refresh|repair|seed)-cli\.test\.js$/u,
  },
  services: {
    areas: ["calendar", "tasks", "operations", "launchd"],
    cli: /^(calendar-.+|tasks-.+|research-tasks)-cli\.test\.js$/u,
  },
  teaching: {
    areas: ["learning-materials", "skills", "cheatsheet", "conformance"],
    cli: /^learning-materials-cli\.test\.js$/u,
  },
  maintenance: {
    areas: ["routine", "observation", "textbooks", "curation"],
    cli: /^(routine-.+|textbooks-.+|curation-.+)-cli\.test\.js$/u,
  },
};

export const verificationWorkflows = Object.keys(workflowTests);

export async function workflowTestFiles(
  root: string,
  workflow: string,
): Promise<string[]> {
  const selected = Object.entries(workflowTests).find(
    ([name]) => name === workflow,
  )?.[1];
  if (selected === undefined) throw new Error("Unknown verification workflow.");
  const files: string[] = [];
  for (const area of selected.areas) {
    const path = join(root, "dist/test", area);
    for (const file of await readdir(path, { recursive: true }))
      if (file.endsWith(".test.js")) files.push(join(path, file));
  }
  for (const file of await readdir(join(root, "dist/test/cli")))
    if (selected.cli.test(file)) files.push(join(root, "dist/test/cli", file));
  return [...new Set(files)].sort();
}

export async function runWorkflowChecks(
  root: string,
  workflow: string,
): Promise<ProcessEvidence[]> {
  const files = await workflowTestFiles(root, workflow);
  const results = [
    await observeProcess({
      action: `synthetic workflow ${workflow}`,
      executable: process.execPath,
      arguments: ["--test", "--test-concurrency=4", ...files],
      cwd: root,
    }),
  ];
  if (workflow === "teaching")
    results.push(
      await observeProcess({
        action: "synthetic cheatsheet journey",
        executable: process.execPath,
        arguments: ["scripts/synthetic-cheatsheet-journey.mjs"],
        cwd: root,
      }),
    );
  return results;
}
