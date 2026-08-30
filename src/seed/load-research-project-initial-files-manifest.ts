import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, dirname, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { sha256Bytes } from "../checksum.js";
import { ensureMaterialized } from "../mounted/ensure-materialized.js";
import { OperationalError } from "../operational-error.js";
import type { ResearchProjectInitialFile } from "./types.js";

const sha256Pattern = /^[0-9a-f]{64}$/u;

interface ManifestEntry {
  destination: string;
  source: string;
  sha256: string;
  encoding: "utf8" | "binary";
}

export async function loadResearchProjectInitialFilesManifest(
  manifestPath: string,
): Promise<ResearchProjectInitialFile[]> {
  const absoluteManifestPath = resolve(manifestPath);
  const manifestBytes = await readOrdinaryMaterializedFile(
    absoluteManifestPath,
    "manifest",
  );
  const source = strictUtf8(manifestBytes, "Initial-files manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw invalidManifest("Initial-files manifest is not valid JSON.");
  }
  const entries = parseManifest(parsed);
  const destinations = new Set<string>();
  const initialFiles: ResearchProjectInitialFile[] = [];
  for (const entry of entries) {
    if (destinations.has(entry.destination)) {
      throw invalidManifest(
        `Initial-files manifest has duplicate destination ${entry.destination}.`,
      );
    }
    destinations.add(entry.destination);
    const sourcePath = resolve(dirname(absoluteManifestPath), entry.source);
    const bytes = await readOrdinaryMaterializedFile(sourcePath, "source");
    if (sha256Bytes(bytes) !== entry.sha256) {
      throw invalidManifest(
        `Initial file ${entry.destination} sha-256 does not match its manifest.`,
      );
    }
    initialFiles.push(
      entry.encoding === "utf8"
        ? {
            destination: entry.destination,
            encoding: "utf8",
            contents: strictUtf8(bytes, `Initial file ${entry.destination}`),
          }
        : {
            destination: entry.destination,
            encoding: "binary",
            contentsBase64: bytes.toString("base64"),
          },
    );
  }
  return initialFiles;
}

function parseManifest(value: unknown): ManifestEntry[] {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "files"])) {
    throw invalidManifest(
      "Initial-files manifest must use the closed schema v1.",
    );
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.files)) {
    throw invalidManifest(
      "Initial-files manifest must use the closed schema v1.",
    );
  }
  return value.files.map((entry, index) => parseManifestEntry(entry, index));
}

function parseManifestEntry(value: unknown, index: number): ManifestEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["destination", "source", "sha256", "encoding"]) ||
    typeof value.destination !== "string" ||
    value.destination.length === 0 ||
    typeof value.source !== "string" ||
    value.source.length === 0 ||
    isAbsolute(value.source) ||
    value.source.includes("\0") ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256) ||
    !["utf8", "binary"].includes(String(value.encoding))
  ) {
    throw invalidManifest(
      `Initial-files manifest entry ${index + 1} does not match the closed schema v1.`,
    );
  }
  return {
    destination: value.destination,
    source: value.source,
    sha256: value.sha256,
    encoding: value.encoding as "utf8" | "binary",
  };
}

async function readOrdinaryMaterializedFile(
  path: string,
  role: "manifest" | "source",
): Promise<Buffer> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch {
    throw invalidManifest(
      `Initial-files ${role} is not an ordinary file: ${path}.`,
    );
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidManifest(
      `Initial-files ${role} is not an ordinary file: ${path}.`,
    );
  }
  try {
    await ensureMaterialized(path);
  } catch {
    throw invalidManifest(
      `Initial-files ${role} is not fully materialized: ${path}.`,
    );
  }
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fresh = await file.stat();
    if (!fresh.isFile()) {
      throw new Error("source changed type");
    }
    return await file.readFile();
  } catch {
    throw invalidManifest(
      `Initial-files ${role} is not an ordinary file: ${path}.`,
    );
  } finally {
    await file?.close();
  }
}

function strictUtf8(bytes: Uint8Array, label: string): string {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidManifest(`${label} is not strict UTF-8.`);
  }
  return Buffer.from(bytes).toString("utf8");
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidManifest(message: string): OperationalError {
  return new OperationalError("invalid-config", message);
}
