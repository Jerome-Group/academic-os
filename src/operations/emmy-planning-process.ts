import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { isJsonObject } from "./json-object.js";

export type EmmyPlanningRequest =
  | { schemaVersion: 1; stage: "publish" | "validate"; catalog: unknown }
  | { schemaVersion: 1; stage: "discover"; catalog: unknown; selector: unknown }
  | {
      schemaVersion: 1;
      stage: "acquire";
      catalog: unknown;
      request: unknown;
      observation: unknown;
    }
  | {
      schemaVersion: 1;
      stage: "revalidate";
      catalog: unknown;
      prepared: unknown;
      observation: unknown;
    }
  | {
      schemaVersion: 1;
      stage: "prepare";
      intent: unknown;
      observation: unknown;
    }
  | { schemaVersion: 1; stage: "receipt"; prepared: unknown; receipt: unknown };

/** Trusted service configuration, never populated from an Operations tool request. */
export interface EmmyPlanningProcessConfig {
  releaseRoot: string;
  manifestSha256: string;
  sourceCommit: string;
  privateRoot: string;
}

export type EmmyPlanningProcessResult =
  | { kind: "reported"; data: Record<string, unknown> }
  | {
      kind: "refused";
      code:
        | "producer-rejected"
        | "producer-unavailable"
        | "producer-protocol-invalid"
        | "producer-cleanup-failed";
    };

const entrypoint = "scripts/academic-os-planning.mjs";
const manifestName = "planning-source-manifest.json";
const maxRequest = 32 * 1024 * 1024;
const maxOutput = 32 * 1024 * 1024;
const maxFile = 2 * 1024 * 1024;
const timeoutMs = 10_000;
const statuses = {
  publish: ["planning-catalog-ready"],
  validate: ["planning-catalog-valid"],
  discover: ["planning-authorizations-discovered"],
  acquire: ["api-plan-ready-reported", "return-to-cloud"],
  revalidate: ["api-plan-current-reported", "return-to-cloud"],
  prepare: ["api-plan-ready-reported", "return-to-cloud"],
  receipt: [
    "api-applied-reported",
    "return-to-cloud",
    "reconcile-original-operation",
  ],
};
const readyStatuses = new Set([
  "planning-catalog-ready",
  "planning-catalog-valid",
  "planning-authorizations-discovered",
  "api-plan-ready-reported",
  "api-plan-current-reported",
  "api-applied-reported",
]);
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("Untrusted producer configuration or file.");
}

async function ownedPath(
  path: string,
  directory: boolean,
  privateMode = false,
) {
  const info = await lstat(path);
  requireValue(
    !info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()),
  );
  requireValue(
    info.uid === process.getuid?.() &&
      (info.mode & (privateMode ? 0o077 : 0o022)) === 0,
  );
  return info;
}

async function boundedFile(path: string, limit: number) {
  const info = await ownedPath(path, false);
  requireValue(info.size <= limit);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireValue(
      stat.ino === info.ino && stat.dev === info.dev && stat.size <= limit,
    );
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    requireValue(bytesRead <= limit && bytesRead === stat.size);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function verifyRelease(config: EmmyPlanningProcessConfig) {
  requireValue(
    isAbsolute(config.releaseRoot) && isAbsolute(config.privateRoot),
  );
  requireValue(
    /^[a-f0-9]{64}$/u.test(config.manifestSha256) &&
      /^[a-f0-9]{40}$/u.test(config.sourceCommit),
  );
  // Canonical roots exclude symlink aliases. Ancestors may include the OS temporary directory.
  requireValue((await realpath(config.releaseRoot)) === config.releaseRoot);
  requireValue((await realpath(config.privateRoot)) === config.privateRoot);
  await ownedPath(config.releaseRoot, true);
  await ownedPath(config.privateRoot, true, true);
  const manifestBytes = await boundedFile(
    join(config.releaseRoot, manifestName),
    maxFile,
  );
  requireValue(hash(manifestBytes) === config.manifestSha256);
  const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
  requireValue(
    isJsonObject(manifest) &&
      manifest.schemaVersion === 1 &&
      manifest.kind === "emmy-academic-planning-compact-runtime" &&
      manifest.sourceCommit === config.sourceCommit &&
      manifest.entrypoint === entrypoint &&
      isJsonObject(manifest.files),
  );
  const files = manifest.files;
  const names = Object.keys(files);
  requireValue(
    names.length > 0 && names.length <= 64 && names.includes(entrypoint),
  );
  const verified = new Map<string, Buffer>();
  for (const name of names) {
    requireValue(
      !isAbsolute(name) &&
        name
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== "..") &&
        !name.includes("\\"),
    );
    const file = join(config.releaseRoot, name);
    requireValue(!relative(config.releaseRoot, file).startsWith(`..${sep}`));
    requireValue((await realpath(file)) === file);
    const pin = files[name];
    requireValue(
      isJsonObject(pin) &&
        Number.isSafeInteger(pin.bytes) &&
        typeof pin.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(pin.sha256),
    );
    const contents = await boundedFile(file, maxFile);
    requireValue(
      contents.length === pin.bytes && hash(contents) === pin.sha256,
    );
    verified.set(name, contents);
  }
  // Unlisted package.json/import overrides or extra executable sources cannot join the bundle.
  async function visit(directory: string): Promise<void> {
    await ownedPath(directory, true);
    for (const row of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, row.name);
      if (row.isDirectory()) await visit(path);
      else
        requireValue(
          row.isFile() &&
            (relative(config.releaseRoot, path) === manifestName ||
              names.includes(relative(config.releaseRoot, path))),
        );
    }
  }
  await visit(config.releaseRoot);
  return verified;
}

function invoke(
  script: string,
  envelope: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [script, "calendar-register", "--file", envelope],
      {
        cwd,
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let size = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    const abort = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(abort, timeoutMs);
    const collect = (chunk: Buffer, stdout: boolean) => {
      size += chunk.length;
      if (size > maxOutput) abort();
      else if (stdout) chunks.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Producer unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) reject(new Error("Producer exceeded execution bound."));
      else resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** Runs the pinned producer only; reported plans confer no catalog trust or task-write authority. */
export function createEmmyPlanningProcess(
  configuration: EmmyPlanningProcessConfig,
) {
  const config = Object.freeze({ ...configuration });
  return {
    async run(
      request: EmmyPlanningRequest,
    ): Promise<EmmyPlanningProcessResult> {
      let directory: string | undefined;
      const runStage = async (): Promise<EmmyPlanningProcessResult> => {
        try {
          const verified = await verifyRelease(config);
          requireValue(Object.hasOwn(statuses, request.stage));
          const serialized = JSON.stringify(request);
          requireValue(Buffer.byteLength(serialized) <= maxRequest);
          directory = await mkdtemp(join(config.privateRoot, "emmy-planning-"));
          await ownedPath(directory, true, true);
          const runtime = join(directory, "runtime");
          for (const [name, contents] of verified) {
            const destination = join(runtime, name);
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            await writeFile(destination, contents, { flag: "wx", mode: 0o600 });
          }
          const requestFile = join(directory, "request.json");
          const envelopeFile = join(directory, "envelope.json");
          await writeFile(requestFile, serialized, { flag: "wx", mode: 0o600 });
          await writeFile(
            envelopeFile,
            JSON.stringify({
              schemaVersion: 1,
              action: "academic-os",
              requestFile,
            }),
            { flag: "wx", mode: 0o600 },
          );
          const result = await invoke(
            join(runtime, entrypoint),
            envelopeFile,
            directory,
          );
          let parsed: unknown;
          try {
            parsed = JSON.parse(result.stdout);
          } catch {
            return { kind: "refused", code: "producer-protocol-invalid" };
          }
          if (!isJsonObject(parsed) || parsed.command !== "calendar-register")
            return { kind: "refused", code: "producer-protocol-invalid" };
          if (parsed.ok === false && result.code === 2)
            return { kind: "refused", code: "producer-rejected" };
          if (parsed.ok !== true || !isJsonObject(parsed.data))
            return { kind: "refused", code: "producer-protocol-invalid" };
          const data = parsed.data;
          if (
            data.schemaVersion !== 1 ||
            data.execution !== "none" ||
            typeof data.status !== "string" ||
            !statuses[request.stage].includes(data.status) ||
            result.code !== (readyStatuses.has(data.status) ? 0 : 3)
          )
            return { kind: "refused", code: "producer-protocol-invalid" };
          return { kind: "reported", data };
        } catch {
          return { kind: "refused", code: "producer-unavailable" };
        }
      };
      const result = await runStage();
      if (directory !== undefined) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch {
          return { kind: "refused", code: "producer-cleanup-failed" };
        }
      }
      return result;
    },
  };
}
