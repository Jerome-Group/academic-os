import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../src/cli.js", import.meta.url));

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(...arguments_: string[]): Promise<CliRun> {
  return runCliWithEnvironment({}, ...arguments_);
}

export async function runCliWithEnvironment(
  environment: NodeJS.ProcessEnv,
  ...arguments_: string[]
): Promise<CliRun> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], {
      env: { ...process.env, ...environment },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}
