#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { cheatsheetCoverageHeader } from "./coverage.js";
import { loadCheatsheetEvidence } from "./evidence.js";
import { planCheatsheetFit } from "./fit.js";
import { verifyPortableCheatsheetRelease } from "./portable-release.js";
import { createCheatsheetReviewPackage } from "./review-package.js";
import { cheatsheetAuthorities, type CheatsheetMeasurements } from "./types.js";

const usage = `Usage:
  cheatsheet-tool schema
  cheatsheet-tool audit --module-root <absolute-path> --manifest <module-relative-path>
  cheatsheet-tool fit --module-root <absolute-path> --manifest <module-relative-path> --measurements <json-path>
  cheatsheet-tool verify --module-root <absolute-path> --manifest <module-relative-path>
  cheatsheet-tool package-review --module-root <absolute-path> --manifest <module-relative-path> --destination <absolute-path>`;

const inputSchema = {
  runtime: {
    requiredExecutables: [
      "latexmk",
      "pdfinfo",
      "pdffonts",
      "pdftotext",
      "pdftoppm",
      "pdftohtml",
    ],
  },
  commands: {
    audit: ["--module-root", "--manifest"],
    fit: ["--module-root", "--manifest", "--measurements"],
    verify: ["--module-root", "--manifest"],
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
  },
  coverage: {
    format: "CSV",
    exactHeader: cheatsheetCoverageHeader,
  },
  measurements: {
    format: "JSON",
    requiredNumbers: [
      "pages",
      "bodyPt",
      "overfullBoxes",
      "missingGlyphs",
      "unidentifiedContinuations",
      "internalVoidBaselines",
      "finalColumnUnusedMm",
    ],
  },
} as const;

function flags(arguments_: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error(usage);
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function requiredFlag(parsed: Map<string, string>, name: string): string {
  const value = parsed.get(name);
  if (value === undefined) throw new Error(`Missing ${name}.\n${usage}`);
  return value;
}

function measurementAt(value: unknown, name: string): number {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[name]
      : undefined;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate < 0
  ) {
    throw new Error(`measurements.${name} must be a nonnegative number.`);
  }
  return candidate;
}

async function readMeasurements(path: string): Promise<CheatsheetMeasurements> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return {
    pages: measurementAt(value, "pages"),
    bodyPt: measurementAt(value, "bodyPt"),
    overfullBoxes: measurementAt(value, "overfullBoxes"),
    missingGlyphs: measurementAt(value, "missingGlyphs"),
    unidentifiedContinuations: measurementAt(
      value,
      "unidentifiedContinuations",
    ),
    internalVoidBaselines: measurementAt(value, "internalVoidBaselines"),
    finalColumnUnusedMm: measurementAt(value, "finalColumnUnusedMm"),
  };
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  if (operation === "schema" && rest.length === 0) {
    process.stdout.write(`${JSON.stringify(inputSchema, null, 2)}\n`);
    return;
  }
  if (
    operation !== "audit" &&
    operation !== "fit" &&
    operation !== "verify" &&
    operation !== "package-review"
  ) {
    throw new Error(usage);
  }
  const parsed = flags(rest);
  const moduleRoot = requiredFlag(parsed, "--module-root");
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
  const evidence = await loadCheatsheetEvidence({ moduleRoot, manifestPath });
  if (operation === "audit") {
    process.stdout.write(
      `${JSON.stringify(
        {
          artifact: evidence.manifest.artifact.id,
          coverageItems: evidence.coverage.length,
          texSha256: evidence.manifest.release.texSha256,
          pdfSha256: evidence.manifest.release.pdfSha256,
          review: evidence.manifest.release.review,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (operation === "fit") {
    const result = planCheatsheetFit({
      constraints: evidence.manifest.constraints,
      coverage: evidence.coverage,
      measurements: await readMeasurements(
        requiredFlag(parsed, "--measurements"),
      ),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const result = await verifyPortableCheatsheetRelease({
    source: evidence.releaseSource,
    releasedPdf: evidence.releasedPdf,
    filename: evidence.manifest.artifact.releaseTex,
    constraints: evidence.manifest.constraints,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
