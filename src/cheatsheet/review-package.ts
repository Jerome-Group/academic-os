import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { sha256Bytes } from "../checksum.js";
import { loadCheatsheetEvidence } from "./evidence.js";
import { resolveModuleFile } from "./module-path.js";
import { verifyPortableCheatsheetRelease } from "./portable-release.js";
import type { CheatsheetReleaseVerification } from "./types.js";

async function addFile(input: {
  root: string;
  path: string;
  bytes: Uint8Array | string;
  checksums: string[];
}): Promise<void> {
  const destination = join(input.root, input.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, input.bytes);
  input.checksums.push(
    `${sha256Bytes(await readFile(destination))}  ${input.path}`,
  );
}

async function verifyChecksums(
  root: string,
  checksums: string[],
): Promise<void> {
  for (const line of checksums) {
    const separator = line.indexOf("  ");
    const expected = line.slice(0, separator);
    const path = line.slice(separator + 2);
    if (sha256Bytes(await readFile(join(root, path))) !== expected) {
      throw new Error(`Packaged checksum failed for ${path}.`);
    }
  }
}

export async function createCheatsheetReviewPackage(input: {
  moduleRoot: string;
  manifestPath: string;
  destination: string;
}): Promise<{
  files: string[];
  checksums: string[];
  verification: CheatsheetReleaseVerification;
}> {
  const evidence = await loadCheatsheetEvidence(input);
  const parent = dirname(input.destination);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.cheatsheet-review-${randomUUID()}`);
  await mkdir(staging);
  try {
    const checksums: string[] = [];
    const texName = basename(evidence.manifest.artifact.releaseTex);
    const pdfName = basename(evidence.manifest.artifact.releasePdf);
    await addFile({
      root: staging,
      path: texName,
      bytes: evidence.releaseSource,
      checksums,
    });
    await addFile({
      root: staging,
      path: pdfName,
      bytes: evidence.releasedPdf,
      checksums,
    });
    await addFile({
      root: staging,
      path: "evidence/manifest.yaml",
      bytes: evidence.manifestText,
      checksums,
    });
    await addFile({
      root: staging,
      path: "evidence/coverage.csv",
      bytes: evidence.coverageText,
      checksums,
    });
    const authoringFiles: string[] = [];
    if (evidence.manifest.authoring.kind === "fragments") {
      for (const fragment of evidence.manifest.authoring.fragments) {
        const relativeFragment = fragment.path.slice(
          evidence.manifest.artifact.support.length + 1,
        );
        const bundlePath = `authoring/${relativeFragment}`;
        const bytes = await readFile(
          await resolveModuleFile(input.moduleRoot, fragment.path),
        );
        if (sha256Bytes(bytes) !== fragment.sha256) {
          throw new Error(
            `${fragment.path} no longer matches its declared SHA-256.`,
          );
        }
        await addFile({
          root: staging,
          path: bundlePath,
          bytes,
          checksums,
        });
        authoringFiles.push(bundlePath);
      }
    }
    const verification = await verifyPortableCheatsheetRelease({
      source: await readFile(join(staging, texName), "utf8"),
      releasedPdf: await readFile(join(staging, pdfName)),
      filename: texName,
      constraints: evidence.manifest.constraints,
    });
    const verificationPath = "evidence/package-verification.json";
    await addFile({
      root: staging,
      path: verificationPath,
      bytes: `${JSON.stringify(verification, null, 2)}\n`,
      checksums,
    });
    checksums.sort();
    await writeFile(
      join(staging, "SHA256SUMS"),
      `${checksums.join("\n")}\n`,
      "utf8",
    );
    await verifyChecksums(staging, checksums);
    await writeFile(
      join(staging, "README.md"),
      `# Cheatsheet review package\n\nThis exact package passed isolated compilation and release comparison. Recompile its single dependency-free top-level release source from this directory:\n\n\`\`\`sh\nlatexmk -pdf -interaction=nonstopmode -halt-on-error ./*.tex\n\`\`\`\n\nReview state is recorded in \`evidence/manifest.yaml\`; package verification is in \`${verificationPath}\`. A passed review names this package's exact PDF digest.\n`,
      "utf8",
    );
    await rename(staging, input.destination);
    return {
      files: [
        texName,
        pdfName,
        "evidence/manifest.yaml",
        "evidence/coverage.csv",
        ...authoringFiles,
        verificationPath,
        "SHA256SUMS",
        "README.md",
      ],
      checksums,
      verification,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
