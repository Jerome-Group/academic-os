import { execFile, spawn } from "node:child_process";
import { chmod, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { shelfName, type ShelfIdentity } from "./shelf-file-observation.js";
import { shelfNativeSource } from "./shelf-native-source.js";

const executeFile = promisify(execFile);

export type ShelfNativeOperation = "exclusive" | "exchange";
export type ShelfNativeResult =
  | { kind: "moved" | "refused" | "partial"; phase: string; errno: number }
  | { kind: "unknown"; evidence: string };

export async function compileShelfNative(directory: string): Promise<string> {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error(
      "Shelf apply requires verified Darwin/Linux native rename operations.",
    );
  const source = join(directory, "shelf-native.c");
  const binary = join(directory, "shelf-native");
  await writeFile(source, shelfNativeSource, { flag: "wx", mode: 0o600 });
  try {
    await executeFile(
      "cc",
      ["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", source, "-o", binary],
      {
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    );
  } catch (error) {
    throw new Error(
      `Shelf apply needs a working C compiler: ${error instanceof Error ? error.message : "compilation failed"}`,
    );
  }
  await chmod(binary, 0o700);
  const stat = await lstat(binary);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.())
    throw new Error("Shelf native executable is not an owned ordinary file.");
  return binary;
}

export async function runShelfNative(input: {
  binary: string;
  rootFd: number;
  root: ShelfIdentity;
  operation: ShelfNativeOperation;
  source: string;
  target: string;
  sourceIdentity: ShelfIdentity;
  targetIdentity: ShelfIdentity | null;
}): Promise<ShelfNativeResult> {
  const args = [
    input.operation,
    shelfName(input.source),
    shelfName(input.target),
    input.root.dev,
    input.root.ino,
    input.sourceIdentity.dev,
    input.sourceIdentity.ino,
    input.targetIdentity?.dev ?? "0",
    input.targetIdentity?.ino ?? "0",
  ];
  if (input.source === input.target)
    throw new Error("Native Shelf names must differ.");
  return await new Promise((resolve) => {
    const child = spawn(input.binary, args, {
      stdio: ["ignore", "pipe", "pipe", input.rootFd],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout?.on("data", (data: Buffer) => {
      outputBytes += data.byteLength;
      if (outputBytes > 4096) {
        overflow = true;
        child.kill("SIGKILL");
      } else stdout.push(data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
      if (Buffer.byteLength(stderr) > 4096) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        kind: "unknown",
        evidence: `Native dispatch error: ${error.message}`,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (overflow || signal !== null || stderr !== "") {
        resolve({
          kind: "unknown",
          evidence: `Native receipt unavailable (${signal ?? code}, ${stderr.slice(0, 256)}).`,
        });
        return;
      }
      try {
        const receipt: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(stdout),
          ),
        );
        if (
          !isReceipt(receipt, input.operation) ||
          code !==
            (receipt.kind === "moved"
              ? 0
              : receipt.kind === "refused"
                ? 10
                : 20)
        )
          throw new Error("Unsupported receipt or status.");
        resolve({
          kind: receipt.kind,
          phase: receipt.phase,
          errno: receipt.errno,
        });
      } catch {
        resolve({
          kind: "unknown",
          evidence:
            "Native receipt malformed, missing, duplicated or inconsistent.",
        });
      }
    });
  });
}

function isReceipt(
  value: unknown,
  operation: ShelfNativeOperation,
): value is {
  version: 1;
  operation: ShelfNativeOperation;
  kind: "moved" | "refused" | "partial";
  phase: string;
  errno: number;
} {
  if (
    !(
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).sort().join(",") ===
        "errno,kind,operation,phase,version" &&
      "version" in value &&
      value.version === 1 &&
      "operation" in value &&
      value.operation === operation &&
      "kind" in value &&
      typeof value.kind === "string" &&
      ["moved", "refused", "partial"].includes(String(value.kind)) &&
      "phase" in value &&
      typeof value.phase === "string" &&
      value.phase.length <= 64 &&
      "errno" in value &&
      typeof value.errno === "number" &&
      Number.isSafeInteger(value.errno) &&
      value.errno >= 0
    )
  )
    return false;
  return value.kind === "moved"
    ? value.phase === "synced" && value.errno === 0
    : value.kind === "partial"
      ? value.phase === "directory-sync" && value.errno > 0
      : ["arguments", "root", "source", "target", "syscall"].includes(
          value.phase,
        );
}
