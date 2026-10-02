import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function repositoryDiagnosticSignature(
  output: string,
  cwd: string,
): string {
  return sha(
    output
      .replaceAll(cwd, "<checkout>")
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
    "--",
    ...command,
  ];
}

export async function runRepositoryProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
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
    env.NODE_OPTIONS = "";
    env.TMPDIR = input.cwd;
    env.TMP = input.cwd;
    env.TEMP = input.cwd;
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
