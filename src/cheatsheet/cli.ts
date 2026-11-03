#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sha256Bytes } from "../checksum.js";
import {
  checkCheatsheetRegenerationCandidate,
  parseCheatsheetConstruction,
} from "./construction.js";
import {
  formatCheatsheetReferences,
  parseCheatsheetReferences,
} from "./references.js";
import { parseCheatsheetManifest } from "./manifest.js";
import { readCheatsheetModuleText } from "./exact-text.js";
import { assertCheatsheetMathematicsPreserved } from "./revision.js";
import { cheatsheetCoverageHeader } from "./coverage.js";
import {
  assertCheatsheetReleaseReady,
  loadCheatsheetEvidence,
} from "./evidence.js";
import { cheatsheetMeasurementSchema } from "./measurement-schema.js";
import {
  fitCheatsheetRelease,
  rebaseCheatsheetBuildEvidence,
} from "./measurements.js";
import { resolveNewModuleDirectory } from "./module-path.js";
import { prepareCheatsheet } from "./prepare.js";
import { verifyPortableCheatsheetRelease } from "./portable-release.js";
import { createCheatsheetReviewPackage } from "./review-package.js";
import {
  cheatsheetExecutablePath,
  cheatsheetExecutables,
  findCheatsheetExecutable,
} from "./toolchain.js";
import { cheatsheetAuthorities } from "./types.js";

const usage = `Usage:
  cheatsheet-tool schema
  cheatsheet-tool doctor
  cheatsheet-tool prepare --module-root <absolute-path> --module-code <code> --assessment <name>
  cheatsheet-tool audit --module-root <absolute-path> --manifest <module-relative-path>
  cheatsheet-tool fit --module-root <absolute-path> --manifest <module-relative-path> --measurements <json-path>
  cheatsheet-tool verify --module-root <absolute-path> --manifest <module-relative-path> [--evidence-directory <new-module-relative-support-directory>]
  cheatsheet-tool present-references --module-root <absolute-path> --source <module-relative-tex> --references <module-relative-json>
  cheatsheet-tool preservation --module-root <absolute-path> --manifest <module-relative-path> --baseline-tex <module-relative-path> --baseline-sha256 <digest> [--policy exact|preserve-existing]
  cheatsheet-tool regeneration-check --module-root <absolute-path> --manifest <module-relative-path> --candidate <scratch-module-relative-path> --construction <module-relative-json-path>
  cheatsheet-tool package-review --module-root <absolute-path> --manifest <module-relative-path> --destination <absolute-path>`;

const inputSchema = {
  runtime: {
    minimumNodeMajor: 24,
    requiredExecutables: cheatsheetExecutables,
    discovery:
      "PATH plus conventional bundled locations; ACADEMIC_OS_TOOL_PATH overrides discovery",
  },
  commands: {
    doctor: [],
    prepare: ["--module-root", "--module-code", "--assessment"],
    audit: ["--module-root", "--manifest"],
    fit: ["--module-root", "--manifest", "--measurements"],
    verify: ["--module-root", "--manifest", "--evidence-directory"],
    "present-references": ["--module-root", "--source", "--references"],
    preservation: [
      "--module-root",
      "--manifest",
      "--baseline-tex",
      "--baseline-sha256",
      "--policy",
    ],
    "regeneration-check": [
      "--module-root",
      "--manifest",
      "--candidate",
      "--construction",
    ],
    "package-review": ["--module-root", "--manifest", "--destination"],
  },
  manifest: {
    format: "YAML",
    schemaVersion: 1,
    requiredTopLevel: [
      "schema_version",
      "artifact",
      "authoring",
      "constraints",
      "sources",
      "coverage",
      "release",
    ],
    sourceAuthorities: cheatsheetAuthorities,
    releaseReview: {
      status: ["unreviewed", "pending", "passed"],
      passedReviewDigestKey: "reviewed_pdf_sha256",
    },
  },
  coverage: {
    format: "CSV",
    exactHeader: cheatsheetCoverageHeader,
  },
  measurements: cheatsheetMeasurementSchema,
} as const;

async function doctor(): Promise<void> {
  const run = promisify(execFile);
  const executables = await Promise.all(
    cheatsheetExecutables.map(async (name) => {
      const path = findCheatsheetExecutable(name);
      if (path === undefined) return { name, status: "missing" };
      try {
        const arguments_ =
          name === "latexmk"
            ? ["-norc", "-version"]
            : name === "kpsewhich"
              ? ["--version"]
              : ["-v"];
        const result = await run(path, arguments_, {
          encoding: "utf8",
          timeout: 15_000,
          env: { ...process.env, PATH: cheatsheetExecutablePath() },
        });
        return {
          name,
          path,
          status: "available",
          version: `${result.stdout}${result.stderr}`.trim().slice(0, 4096),
        };
      } catch (error) {
        return {
          name,
          path,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const nodeReady =
    Number(process.versions.node.split(".")[0]) >=
    inputSchema.runtime.minimumNodeMajor;
  const node = {
    executable: process.execPath,
    version: process.version,
    minimumMajor: inputSchema.runtime.minimumNodeMajor,
    status: nodeReady ? "available" : "unsupported",
  };
  const ready =
    nodeReady && executables.every(({ status }) => status === "available");
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, status: ready ? "ready" : "incomplete", entrypointSha256: sha256Bytes(await readFile(fileURLToPath(import.meta.url))), node, executables }, null, 2)}\n`,
  );
  if (!ready) process.exitCode = 2;
}

function flags(arguments_: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }
    if (parsed.has(flag)) throw new Error(`Duplicate ${flag}.`);
    parsed.set(flag, value);
  }
  return parsed;
}

function requiredFlag(parsed: Map<string, string>, name: string): string {
  const value = parsed.get(name);
  if (value === undefined) throw new Error(`Missing ${name}.\n${usage}`);
  return value;
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  if (operation === "schema" && rest.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ ...inputSchema, entrypointSha256: sha256Bytes(await readFile(fileURLToPath(import.meta.url))) }, null, 2)}\n`,
    );
    return;
  }
  if (operation === "doctor" && rest.length === 0) {
    await doctor();
    return;
  }
  if (
    operation !== "prepare" &&
    operation !== "audit" &&
    operation !== "fit" &&
    operation !== "verify" &&
    operation !== "present-references" &&
    operation !== "preservation" &&
    operation !== "regeneration-check" &&
    operation !== "package-review"
  ) {
    throw new Error(usage);
  }
  const parsed = flags(rest);
  const allowed = inputSchema.commands[operation];
  for (const flag of parsed.keys()) {
    if (!(allowed as readonly string[]).includes(flag))
      throw new Error(`Unknown ${flag}.`);
  }
  const moduleRoot = requiredFlag(parsed, "--module-root");
  if (operation === "prepare") {
    const result = await prepareCheatsheet({
      moduleRoot,
      moduleCode: requiredFlag(parsed, "--module-code"),
      assessment: requiredFlag(parsed, "--assessment"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "needs-choice") process.exitCode = 2;
    return;
  }
  if (operation === "present-references") {
    const source = await readCheatsheetModuleText(
      moduleRoot,
      requiredFlag(parsed, "--source"),
    );
    const references = await readCheatsheetModuleText(
      moduleRoot,
      requiredFlag(parsed, "--references"),
    );
    const result = formatCheatsheetReferences({
      source: source.text,
      references: parseCheatsheetReferences(JSON.parse(references.text)),
    });
    process.stdout.write(
      `${JSON.stringify({ ...result, sourceSha256: source.sha256, referencesSha256: references.sha256, candidateSha256: sha256Bytes(Buffer.from(result.source, "utf8")), published: false }, null, 2)}\n`,
    );
    return;
  }
  const manifestPath = requiredFlag(parsed, "--manifest");
  if (operation === "package-review") {
    const result = await createCheatsheetReviewPackage({
      moduleRoot,
      manifestPath,
      destination: requiredFlag(parsed, "--destination"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (operation === "fit") {
    const result = await fitCheatsheetRelease({
      moduleRoot,
      manifestPath,
      measurementsPath: requiredFlag(parsed, "--measurements"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.kind === "blocked" || result.kind === "user-choice")
      process.exitCode = 2;
    return;
  }
  if (operation === "regeneration-check") {
    const manifestDocument = await readCheatsheetModuleText(
      moduleRoot,
      manifestPath,
    );
    const manifest = parseCheatsheetManifest(manifestDocument.text);
    if (manifestPath !== `${manifest.artifact.support}/manifest.yaml`)
      throw new Error(
        "Regeneration manifest must be the selected artifact support manifest.",
      );
    if (manifest.authoring.kind !== "self-contained")
      throw new Error(
        "Staged transformed regeneration applies to self-contained authority.",
      );
    if (manifest.release.texSha256 !== manifest.authoring.sha256)
      throw new Error(
        "Regeneration base TeX digest disagrees with its authoring authority.",
      );
    const receipt = await readCheatsheetModuleText(
      moduleRoot,
      requiredFlag(parsed, "--construction"),
    );
    const result = await checkCheatsheetRegenerationCandidate({
      moduleRoot,
      authoring: manifest.authoring,
      candidatePath: requiredFlag(parsed, "--candidate"),
      construction: parseCheatsheetConstruction(JSON.parse(receipt.text)),
    });
    process.stdout.write(
      `${JSON.stringify({ ...result, scope: "Staged candidate and current authoritative TeX only; full audit and verification are required after promotion." }, null, 2)}\n`,
    );
    return;
  }
  const evidence = await loadCheatsheetEvidence({ moduleRoot, manifestPath });
  if (operation === "preservation") {
    const baseline = await readCheatsheetModuleText(
      moduleRoot,
      requiredFlag(parsed, "--baseline-tex"),
    );
    if (baseline.sha256 !== requiredFlag(parsed, "--baseline-sha256"))
      throw new Error(
        "Typography baseline no longer matches its frozen SHA-256.",
      );
    const policy = parsed.get("--policy") ?? "exact";
    if (policy !== "exact" && policy !== "preserve-existing")
      throw new Error(
        "Preservation policy must be exact or preserve-existing.",
      );
    const result = assertCheatsheetMathematicsPreserved({
      baseline: baseline.text,
      candidate: evidence.releaseSource,
      policy,
    });
    process.stdout.write(
      `${JSON.stringify({ ...result, baselineTexSha256: baseline.sha256, candidateTexSha256: sha256Bytes(evidence.releaseBytes), pdfSha256: evidence.manifest.release.pdfSha256 }, null, 2)}\n`,
    );
    return;
  }
  if (operation === "audit") {
    process.stdout.write(
      `${JSON.stringify(
        {
          artifact: evidence.manifest.artifact.id,
          coverageItems: evidence.coverage.length,
          texSha256: evidence.manifest.release.texSha256,
          pdfSha256: evidence.manifest.release.pdfSha256,
          review: evidence.manifest.release.review,
          completenessInventory: {
            status: evidence.manifest.sources.every(
              (source) => source.requiredLocators !== undefined,
            )
              ? "declared-bounded"
              : evidence.manifest.sources.some(
                    (source) => source.requiredLocators !== undefined,
                  )
                ? "partly-declared"
                : "undeclared",
            sourceIds: evidence.manifest.sources
              .filter((source) => source.requiredLocators !== undefined)
              .map(({ id }) => id),
            scope:
              "Declared inventory only; original-source completeness requires independent review.",
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  assertCheatsheetReleaseReady(evidence);
  const evidenceDirectory = parsed.get("--evidence-directory");
  if (
    evidenceDirectory !== undefined &&
    (!evidenceDirectory.startsWith(`${evidence.manifest.artifact.support}/`) ||
      evidenceDirectory.includes("\\") ||
      evidenceDirectory
        .split("/")
        .some((part) => ["", ".", ".."].includes(part)))
  ) {
    throw new Error(
      "--evidence-directory must be a normalized new directory beneath artifact.support.",
    );
  }
  const result = await verifyPortableCheatsheetRelease({
    source: evidence.releaseSource,
    releasedPdf: evidence.releasedPdf,
    filename: evidence.manifest.artifact.releaseTex,
    constraints: evidence.manifest.constraints,
    requiredLabels: evidence.coverage.flatMap(({ artifactLocator }) =>
      artifactLocator === undefined ? [] : [artifactLocator],
    ),
    ...(evidenceDirectory === undefined
      ? {}
      : {
          evidenceDestination: await resolveNewModuleDirectory(
            moduleRoot,
            evidenceDirectory,
          ),
        }),
  });
  if (evidenceDirectory !== undefined && result.buildEvidence !== undefined) {
    result.buildEvidence = rebaseCheatsheetBuildEvidence(
      result.buildEvidence,
      evidenceDirectory,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, status: "failed", error: { code: "cheatsheet-operation-failed", message } })}\n`,
  );
  process.exitCode = 1;
}
