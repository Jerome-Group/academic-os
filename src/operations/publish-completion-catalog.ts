import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes } from "../checksum.js";
import { loadCohortTasksConfig } from "../commands/load-cohort-tasks-config.js";
import { resolveTaskPlanningConfig } from "../config/resolve-tasks-config.js";
import { createPrivateCompletionCatalogStore } from "../tasks/private-completion-catalog-store.js";
import { createEmmyPlanningProcess } from "./emmy-planning-process.js";
import { isJsonObject } from "./json-object.js";
import { safeCompletionCode } from "./configured-completion-planning.js";
import {
  standingCompletionSource,
  validateStandingCompletionSource,
} from "./completion-attestation.js";

/** Explicit local installation step. Configured file attribution does not prove cloud authorship. */
export async function publishConfiguredCompletionCatalog(configPath: string) {
  try {
    const { config } = await loadCohortTasksConfig(configPath);
    const planning = resolveTaskPlanningConfig(config);
    if (planning?.catalogSourcePath === undefined)
      throw new Error("completion-publication-source-unconfigured");
    const excludedRoots = [
      config.driveMount,
      fileURLToPath(new URL("../../../", import.meta.url)),
    ];
    const store = createPrivateCompletionCatalogStore({
      stateRoot: planning.privateRoot,
      excludedRoots,
    });
    const producer = createEmmyPlanningProcess(planning);
    const owned = await store.withOwner(async (owner) => {
      const originalSource = await readSource(
        planning.catalogSourcePath ?? "",
        excludedRoots,
      );
      const raw = originalSource.bytes;
      const staged: unknown = JSON.parse(raw.toString("utf8"));
      if (
        !isJsonObject(staged) ||
        staged.schemaVersion !== 1 ||
        Object.keys(staged).length !== 4 ||
        Object.keys(staged).some(
          (key) =>
            ![
              "schemaVersion",
              "expectedPriorDigest",
              "catalog",
              "acquisitionEvidence",
            ].includes(key),
        ) ||
        !(
          staged.expectedPriorDigest === null ||
          (typeof staged.expectedPriorDigest === "string" &&
            /^[a-f0-9]{64}$/u.test(staged.expectedPriorDigest))
        ) ||
        !isJsonObject(staged.acquisitionEvidence) ||
        Object.keys(staged.acquisitionEvidence).length === 0
      )
        throw new Error("completion-publication-stage-invalid");
      const source: unknown = staged.catalog;
      const standing = standingCompletionSource(source);
      if (standing) validateStandingCompletionSource(source);
      const hasVersion =
        isJsonObject(source) && typeof source.policyVersion === "string";
      const result = standing
        ? {
            kind: "reported" as const,
            data: { status: "standing-source-staged", catalog: source },
          }
        : await producer.run({
            schemaVersion: 1,
            stage: hasVersion ? "validate" : "publish",
            catalog: source,
          });
      if (result.kind !== "reported") throw new Error(result.code);
      if (
        result.data.status !==
        (standing
          ? "standing-source-staged"
          : hasVersion
            ? "planning-catalog-valid"
            : "planning-catalog-ready")
      )
        throw new Error("completion-publication-producer-refused");
      const catalog = hasVersion ? source : result.data.catalog;
      if (
        !isJsonObject(catalog) ||
        !isJsonObject(catalog.scope) ||
        catalog.sourceRef !== planning.sourceIdentity ||
        catalog.scope.environment !== planning.environment ||
        catalog.scope.accountId !== planning.accountId ||
        (!standing && typeof catalog.policyVersion !== "string")
      )
        throw new Error("completion-source-mismatch");
      if (!standing) {
        const validated = await producer.run({
          schemaVersion: 1,
          stage: "validate",
          catalog,
        });
        if (
          validated.kind !== "reported" ||
          validated.data.status !== "planning-catalog-valid"
        )
          throw new Error("completion-publication-producer-refused");
      }
      const bytes = Buffer.from(JSON.stringify(catalog));
      await owner.publish(
        {
          rawJson: bytes,
          sourceIdentity: planning.sourceIdentity,
          acquisitionJson: Buffer.from(
            JSON.stringify({
              schemaVersion: 1,
              kind: "configured-local-source",
              sourceIdentity: planning.sourceIdentity,
              sourceSha256: sha256Bytes(raw),
              rawSourceBase64: raw.toString("base64"),
              acquiredAt: new Date().toISOString(),
              sourcePath: planning.catalogSourcePath,
              acquisitionEvidence: staged.acquisitionEvidence,
              expectedPriorDigest: staged.expectedPriorDigest,
              assurance:
                "configured-local-file; cloud authorship not authenticated",
            }),
          ),
        },
        async (_candidate, current) => {
          const latestSource = await readSource(
            planning.catalogSourcePath ?? "",
            excludedRoots,
          );
          if (
            latestSource.dev !== originalSource.dev ||
            latestSource.ino !== originalSource.ino ||
            !latestSource.bytes.equals(raw)
          )
            throw new Error("completion-publication-source-changed");
          const priorDigest =
            current === undefined ? null : sha256Bytes(current.rawJson);
          if (staged.expectedPriorDigest !== priorDigest)
            throw new Error("completion-publication-prior-conflict");
          if (current === undefined) return;
          const previous: unknown = JSON.parse(
            current.rawJson.toString("utf8"),
          );
          if (
            current.sourceIdentity !== planning.sourceIdentity ||
            !isJsonObject(previous) ||
            typeof previous.issuedAt !== "string" ||
            typeof catalog.issuedAt !== "string" ||
            (!current.rawJson.equals(bytes) &&
              Date.parse(previous.issuedAt) >= Date.parse(catalog.issuedAt))
          )
            throw new Error("completion-publication-revision-conflict");
        },
      );
      return {
        schemaVersion: 1,
        status: standing ? "standing-source-installed" : "published",
        sourceIdentity: planning.sourceIdentity,
        policyVersion: catalog.policyVersion,
        catalogDigest: sha256Bytes(bytes),
        assurance: standing
          ? "non-executable source projection; full producer validation required for every particular completion"
          : "configured-local-file; cloud authorship not authenticated",
      };
    });
    if (owned.kind !== "owned")
      throw new Error("completion-catalog-unavailable");
    return { failed: false, report: owned.value };
  } catch (error) {
    return {
      failed: true,
      report: {
        schemaVersion: 1,
        status: "refused",
        code: safeCompletionCode(error),
      },
    };
  }
}

async function readSource(
  path: string,
  excludedRoots: readonly string[],
): Promise<{ bytes: Buffer; dev: number; ino: number }> {
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    throw new Error("completion-publication-source-unsafe");
  for (const excluded of excludedRoots) {
    const boundary = await realpath(excluded);
    const rel = relative(boundary, path);
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    )
      throw new Error("completion-publication-source-unsafe");
  }
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o7777) !== 0o700
  )
    throw new Error("completion-publication-source-unsafe");
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o7777) !== 0o600 ||
      before.size > 4 * 1024 * 1024
    )
      throw new Error("completion-publication-source-unsafe");
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    if (
      length !== before.size ||
      length > 4 * 1024 * 1024 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.isSymbolicLink()
    )
      throw new Error("completion-publication-source-changed");
    const bytes = buffer.subarray(0, length);
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { bytes, dev: before.dev, ino: before.ino };
  } finally {
    await handle.close();
  }
}
