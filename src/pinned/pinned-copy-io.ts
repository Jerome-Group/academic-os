import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { sha256, sha256Bytes } from "../checksum.js";
import { isContainedBy } from "../mounted/is-contained-by.js";
import {
  createMountedFile,
  replaceMountedFile,
} from "../mounted/replace-mounted-file.js";
import type { PinnedCopyState } from "./types.js";

export interface PinnedCopyBytes {
  state: Exclude<PinnedCopyState, "current">;
  observedSha256: string | null;
  expected: string;
}

export interface ProvenPinnedCopyTarget {
  path: string;
  root: string;
  resolvedRoot: string;
  driveMount: string;
  relativePath: string;
  label: string;
}

export async function provePinnedCopyTarget(input: {
  rewrite: PinnedCopyBytes;
  root: string;
  driveMount: string;
  relativePath: string;
  label: string;
  missingParentEvidence: string;
}): Promise<
  | { target: ProvenPinnedCopyTarget; original?: Uint8Array }
  | { refusal: string }
> {
  const target = join(input.root, input.relativePath);
  if (!isContainedBy(input.root, target)) {
    return { refusal: `${input.label}: the path escapes its configured root.` };
  }
  const resolvedRoot = await realpath(input.root).catch(() => undefined);
  if (
    resolvedRoot === undefined ||
    !(await isOrdinaryDirectory(input.root)) ||
    !isContainedBy(input.driveMount, resolvedRoot)
  ) {
    return { refusal: `${input.label}: the configured root is not safe.` };
  }
  const proof: ProvenPinnedCopyTarget = {
    path: target,
    root: input.root,
    resolvedRoot,
    driveMount: input.driveMount,
    relativePath: input.relativePath,
    label: input.label,
  };
  let original: Uint8Array | undefined;
  try {
    original = await readProvedBytes(proof);
  } catch (error) {
    if (
      input.rewrite.state === "missing" &&
      error instanceof MissingPinnedAncestorError
    ) {
      return { refusal: `${input.label}: ${input.missingParentEvidence}` };
    }
    return {
      refusal: `${input.label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (input.rewrite.state === "missing") {
    if (original !== undefined) {
      return { refusal: `${input.label}: the name is already taken.` };
    }
    if (!(await isOrdinaryDirectory(dirname(target)))) {
      return { refusal: `${input.label}: ${input.missingParentEvidence}` };
    }
    return { target: proof };
  }
  if (original === undefined) {
    return {
      refusal: `${input.label}: the copy disappeared after it was read.`,
    };
  }
  try {
    decodeUtf8(original);
  } catch {
    return { refusal: `${input.label}: the copy is not valid UTF-8.` };
  }
  if (sha256Bytes(original) !== input.rewrite.observedSha256) {
    return {
      refusal: `${input.label}: the copy changed after it was read for this run.`,
    };
  }
  return { target: proof, original };
}

export async function writePinnedCopy(
  rewrite: PinnedCopyBytes,
  target: ProvenPinnedCopyTarget,
): Promise<string | undefined> {
  const expectedSha256 = sha256(rewrite.expected);
  try {
    if (rewrite.observedSha256 === null) {
      if ((await readProvedText(target)) !== undefined) {
        return "the name was taken before this run could write it.";
      }
      await createMountedFile({
        path: target.path,
        contents: rewrite.expected,
      });
    } else {
      await replaceMountedFile({
        path: target.path,
        contents: rewrite.expected,
        expectedSha256: rewrite.observedSha256,
        readContents: async () => await readProvedText(target),
      });
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const written = await readProvedText(target).catch(() => undefined);
  return written !== undefined && sha256(written) === expectedSha256
    ? undefined
    : "the copy did not arrive intact.";
}

async function readProvedText(
  target: ProvenPinnedCopyTarget,
): Promise<string | undefined> {
  const bytes = await readProvedBytes(target);
  return bytes === undefined ? undefined : decodeUtf8(bytes);
}

async function readProvedBytes(
  target: ProvenPinnedCopyTarget,
): Promise<Uint8Array | undefined> {
  await proveOrdinaryAncestors(target);
  if (!(await proveOrdinaryTarget(target))) return undefined;
  const bytes = await readFile(target.path);
  await proveOrdinaryAncestors(target);
  if (!(await proveOrdinaryTarget(target))) {
    throw new Error("the target disappeared while it was read.");
  }
  return bytes;
}

async function proveOrdinaryTarget(
  target: ProvenPinnedCopyTarget,
): Promise<boolean> {
  const metadata = await lstat(target.path).catch((error) => {
    if (isErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (metadata === undefined) return false;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("the target is not an ordinary file.");
  }
  const resolved = await realpath(target.path);
  if (!isContainedBy(target.resolvedRoot, resolved)) {
    throw new Error("the target resolves outside its configured root.");
  }
  return true;
}

async function proveOrdinaryAncestors(
  target: ProvenPinnedCopyTarget,
): Promise<void> {
  const currentRoot = await realpath(target.root).catch(() => undefined);
  if (
    currentRoot !== target.resolvedRoot ||
    !(await isOrdinaryDirectory(target.root)) ||
    !isContainedBy(target.driveMount, target.resolvedRoot)
  ) {
    throw new Error(
      "the configured root changed or is not an ordinary directory.",
    );
  }
  const parentRelative = relative(target.root, dirname(target.path));
  let current = target.root;
  for (const part of parentRelative === "" ? [] : parentRelative.split(sep)) {
    current = join(current, part);
    const metadata = await lstat(current).catch((error) => {
      if (isErrorWithCode(error, "ENOENT")) return undefined;
      throw error;
    });
    if (metadata === undefined) {
      throw new MissingPinnedAncestorError(part);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`ancestor ${part} is not an ordinary directory.`);
    }
  }
  const resolvedParent = await realpath(dirname(target.path)).catch(
    () => undefined,
  );
  if (
    resolvedParent === undefined ||
    !isContainedBy(target.resolvedRoot, resolvedParent)
  ) {
    throw new Error("the target parent resolves outside its configured root.");
  }
}

class MissingPinnedAncestorError extends Error {
  constructor(name: string) {
    super(`ancestor ${name} is missing.`);
  }
}

async function isOrdinaryDirectory(path: string): Promise<boolean> {
  const metadata = await lstat(path).catch(() => undefined);
  return (
    metadata !== undefined &&
    !metadata.isSymbolicLink() &&
    metadata.isDirectory()
  );
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}
