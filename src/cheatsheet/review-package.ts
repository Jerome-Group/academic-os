import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { sha256Bytes } from "../checksum.js";
import {
  assertCheatsheetReleaseReady,
  loadCheatsheetEvidence,
} from "./evidence.js";
import { publishCheatsheetPackage } from "./package-publication.js";
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
  assertCheatsheetReleaseReady(evidence);
  try {
    await lstat(input.destination);
    throw new Error("Review package destination already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
    const sourceFiles: string[] = [];
    const sourceProvenance = [];
    for (const [index, source] of evidence.manifest.sources.entries()) {
      const bytes = await readFile(
        await resolveModuleFile(input.moduleRoot, source.path),
      );
      if (sha256Bytes(bytes) !== source.sha256)
        throw new Error(`${source.path} changed before packaging.`);
      const packagedPath = `evidence/sources/${String(index + 1).padStart(4, "0")}/${basename(source.path)}`;
      await addFile({ root: staging, path: packagedPath, bytes, checksums });
      sourceFiles.push(packagedPath);
      sourceProvenance.push({ ...source, packagedPath });
    }
    await addFile({
      root: staging,
      path: "evidence/source-provenance.json",
      bytes: `${JSON.stringify(sourceProvenance, null, 2)}\n`,
      checksums,
    });
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
      requiredLabels: evidence.coverage.flatMap(({ artifactLocator }) =>
        artifactLocator === undefined ? [] : [artifactLocator],
      ),
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
      `# Cheatsheet review package\n\nThis exact package passed isolated compilation and release comparison. Recompile its single dependency-free top-level release source from this directory:\n\n\`\`\`sh\nlatexmk -pdf -interaction=nonstopmode -halt-on-error ./*.tex\n\`\`\`\n\nExact cited source bytes and module-relative locators are packaged under \`evidence/sources/\` with \`evidence/source-provenance.json\`. Coverage completeness and mathematical correctness require semantic review. Review state is recorded in \`evidence/manifest.yaml\`; package verification is in \`${verificationPath}\`. A passed review names this package's exact PDF digest.\n`,
      "utf8",
    );
    await publishCheatsheetPackage(staging, input.destination);
    await verifyChecksums(input.destination, checksums);
    await rm(staging, { recursive: true, force: true });
    return {
      files: [
        texName,
        pdfName,
        "evidence/manifest.yaml",
        "evidence/coverage.csv",
        ...sourceFiles,
        "evidence/source-provenance.json",
        ...authoringFiles,
        verificationPath,
        "SHA256SUMS",
        "README.md",
        ".package-publication.json",
      ],
      checksums,
      verification,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
