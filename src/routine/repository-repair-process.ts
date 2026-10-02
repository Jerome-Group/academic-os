import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";

export async function repositoryFixtureRoot(
  cwd: string,
  fixtureRoot: string | undefined,
): Promise<string> {
  if (!fixtureRoot)
    throw new Error("Owned fixture temporary root unavailable.");
  const metadata = await lstat(fixtureRoot);
  const root = await realpath(fixtureRoot),
    checkout = await realpath(cwd);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    metadata.uid !== process.getuid?.() ||
    dirname(root) !== dirname(checkout) ||
    root === checkout
  )
    throw new Error("Unsafe fixture temporary root.");
  return root;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function repositoryDiagnosticSignature(
  output: string,
  cwd: string,
  fixtureRoot?: string,
): string {
  const replaceRoot = (value: string, root: string, marker: string) =>
    value.replace(
      new RegExp(
        `${root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=[/\\s:'"]|$)`,
        "gu",
      ),
      marker,
    );
  const normalized =
    fixtureRoot === undefined
      ? output
      : replaceRoot(output, fixtureRoot, "<fixture>")
          // Node mkdtemp appends six random characters; only the owned temp's first component changes.
          .replace(
            /(<fixture>\/[A-Za-z0-9_-]+-)[A-Za-z0-9]{6}(?=[/\s:'"]|$)/gu,
            "$1<temporary>",
          );
  return sha(
    replaceRoot(normalized, cwd, "<checkout>")
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, "<run>")
      .replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z\b/gu, "<time>")
      .replace(
        /(?:duration|durationMs|wallTime|elapsed)[^,\n}]*/giu,
        "<duration>",
      )
      .replace(/\b\d+(?:\.\d+)?\s*(?:ms|seconds)\b/giu, "<duration>"),
  );
}

export function repositorySandboxArguments(
  cwd: string,
  command: string[],
  fixtureRoot?: string,
): string[] {
  return [
    "sandbox",
    "-P",
    ":workspace",
    "--include-managed-config",
    "-C",
    cwd,
    "-c",
    'sandbox_mode="workspace-write"',
    "-c",
    "sandbox_workspace_write.network_access=false",
    "-c",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c",
    "sandbox_workspace_write.exclude_slash_tmp=true",
    ...(fixtureRoot === undefined
      ? []
      : [
          "-c",
          `sandbox_workspace_write.writable_roots=${JSON.stringify([fixtureRoot])}`,
          "--allow-unix-socket",
          fixtureRoot,
        ]),
    "--",
    ...command,
  ];
}

export async function runRepositoryProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  temporaryRoot?: string;
  fixtureUnixTransport?: boolean;
  log?: string;
  timeoutMs?: number;
  cleanEnvironment?: boolean;
}): Promise<{
  code: number | null;
  output: string;
  digest: string;
  outputBytes: number;
  outputTruncated: boolean;
}> {
  return await new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (
        /TOKEN|SECRET|PASSWORD|PRIVATE_KEY|GOOGLE|OPENAI_API_KEY|GH_|GITHUB_|AWS_|AZURE_/iu.test(
          key,
        )
      )
        delete env[key];
    delete env.ACADEMIC_OS_REPOSITORY_FIXTURE_TRANSPORT;
    if (input.fixtureUnixTransport)
      env.ACADEMIC_OS_REPOSITORY_FIXTURE_TRANSPORT = "unix";
    env.NODE_OPTIONS = "";
    env.NODE_DISABLE_COMPILE_CACHE = "1";
    delete env.NODE_COMPILE_CACHE;
    env.TMPDIR = input.temporaryRoot ?? input.cwd;
    env.TMP = input.temporaryRoot ?? input.cwd;
    env.TEMP = input.temporaryRoot ?? input.cwd;
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: input.cleanEnvironment === false ? process.env : env,
      detached: true,
    });
    const hash = createHash("sha256");
    let output = "";
    let outputBytes = 0;
    let outputTruncated = false;
    const log =
      input.log === undefined
        ? undefined
        : createWriteStream(input.log, { flags: "wx", mode: 0o600 });
    log?.on("error", reject);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        outputBytes += chunk.length;
        if (outputBytes > 1_048_576) outputTruncated = true;
        output = (output + chunk.toString()).slice(-1_048_576);
        if (outputBytes <= 16_777_216) log?.write(chunk);
        else if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      });
    const timeout = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, input.timeoutMs ?? 480_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      log?.end();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      log?.end();
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Process group already completed. */
        }
      }
      resolve({
        code,
        output,
        digest: hash.digest("hex"),
        outputBytes,
        outputTruncated,
      });
    });
  });
}
