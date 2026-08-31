import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadResearchProjectInitialFilesManifest } from "../../src/seed/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("research-project initial-files manifest", () => {
  it("loads verified UTF-8 and binary bytes relative to the manifest", async () => {
    const root = await temporaryRoot();
    const text = Buffer.from("sources: []\n", "utf8");
    const binary = Buffer.from([0, 255, 10, 128, 65]);
    await writeFile(join(root, "sources.yaml"), text);
    await writeFile(join(root, "paper.pdf"), binary);
    const manifest = join(root, "initial-files.json");
    await writeFile(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        files: [
          {
            destination: "00 Project Admin/20 Source Register.yaml",
            source: "sources.yaml",
            sha256: digest(text),
            encoding: "utf8",
          },
          {
            destination: "10 Source Materials/20 Core Sources/paper.pdf",
            source: "paper.pdf",
            sha256: digest(binary),
            encoding: "binary",
          },
        ],
      }),
    );

    const loaded = await loadResearchProjectInitialFilesManifest(manifest);

    assert.deepEqual(loaded, [
      {
        destination: "00 Project Admin/20 Source Register.yaml",
        encoding: "utf8",
        contents: "sources: []\n",
      },
      {
        destination: "10 Source Materials/20 Core Sources/paper.pdf",
        encoding: "binary",
        contentsBase64: "AP8KgEE=",
      },
    ]);
  });

  it("rejects an open schema, a hash mismatch, invalid UTF-8, and a non-ordinary source", async () => {
    const root = await temporaryRoot();
    const bytes = Buffer.from("valid\n", "utf8");
    await writeFile(join(root, "source.txt"), bytes);
    const manifest = join(root, "initial-files.json");

    await writeFile(
      manifest,
      JSON.stringify({ schemaVersion: 1, files: [], extra: true }),
    );
    await assert.rejects(
      loadResearchProjectInitialFilesManifest(manifest),
      /closed schema/u,
    );

    await writeFile(
      manifest,
      manifestBody({ sha256: "0".repeat(64), source: "source.txt" }),
    );
    await assert.rejects(
      loadResearchProjectInitialFilesManifest(manifest),
      /sha-256 does not match/u,
    );

    const invalid = Buffer.from([0xc3, 0x28]);
    await writeFile(join(root, "source.txt"), invalid);
    await writeFile(
      manifest,
      manifestBody({ sha256: digest(invalid), source: "source.txt" }),
    );
    await assert.rejects(
      loadResearchProjectInitialFilesManifest(manifest),
      /not strict UTF-8/u,
    );

    await writeFile(join(root, "ordinary.txt"), bytes);
    await symlink("ordinary.txt", join(root, "linked.txt"));
    await writeFile(
      manifest,
      manifestBody({ sha256: digest(bytes), source: "linked.txt" }),
    );
    await assert.rejects(
      loadResearchProjectInitialFilesManifest(manifest),
      /ordinary file/u,
    );

    await writeFile(
      manifest,
      manifestBody({
        sha256: digest(bytes),
        source: join(root, "ordinary.txt"),
      }),
    );
    await assert.rejects(
      loadResearchProjectInitialFilesManifest(manifest),
      /closed schema v1/u,
    );
  });
});

function manifestBody(input: { sha256: string; source: string }): string {
  return JSON.stringify({
    schemaVersion: 1,
    files: [
      {
        destination: "10 Source Materials/20 Core Sources/source.txt",
        source: input.source,
        sha256: input.sha256,
        encoding: "utf8",
      },
    ],
  });
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "academic-os-initial-files-"));
  temporaryRoots.push(root);
  return root;
}
