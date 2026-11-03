import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { buildCheatsheetReleaseSource } from "../../src/cheatsheet/authoring.js";
import {
  checkCheatsheetRegenerationCandidate,
  constructionFor,
} from "../../src/cheatsheet/construction.js";
import { loadCheatsheetEvidence } from "../../src/cheatsheet/evidence.js";
import { parseCheatsheetManifest } from "../../src/cheatsheet/manifest.js";
import { createCheatsheetReviewPackage } from "../../src/cheatsheet/review-package.js";
import { sha256Bytes } from "../../src/checksum.js";
const run = promisify(execFile);
const personal = "10 Learning Materials/30 Personal Notes";
const support = `${personal}/support/final-aid`;
const tex = String.raw`\documentclass[a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\pagestyle{empty}
\begin{document}
\typeout{CHEATSHEET-BODY-PT=10}
\label{Q1}Body: $a+b=b+a$.
\end{document}
`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-evidence-"));
  await mkdir(join(root, support, "content"), { recursive: true });
  await writeFile(
    join(root, support, "content/source.txt"),
    "Question and part a.",
  );
  await writeFile(join(root, support, "assemble.py"), "# recipe bytes\r\n");
  await writeFile(join(root, personal, "Final.tex"), tex);
  await writeFile(join(root, personal, "Final.pdf"), "synthetic-pdf");
  const sources = [
    {
      id: "issued",
      path: `${support}/content/source.txt`,
      sha256: sha256Bytes(
        await readFile(join(root, support, "content/source.txt")),
      ),
      authority: "issued-current",
      locators: ["Q1", "Q1(a)", "style-only"],
      required_locators: ["Q1", "Q1(a)"],
    },
  ];
  const construction = {
    recipe: {
      path: `${support}/assemble.py`,
      sha256: sha256Bytes(await readFile(join(root, support, "assemble.py"))),
    },
    inputs: [
      { path: `${support}/content/source.txt`, sha256: sources[0]?.sha256 },
    ],
    base_tex_sha256: sha256Bytes(Buffer.from("prior release")),
    output_tex_sha256: sha256Bytes(Buffer.from(tex)),
  };
  const manifest = {
    schema_version: 1,
    artifact: {
      id: "final-aid",
      title: "Final aid",
      scope: "Synthetic",
      release_tex: `${personal}/Final.tex`,
      release_pdf: `${personal}/Final.pdf`,
      support,
    },
    authoring: {
      kind: "self-contained",
      path: `${personal}/Final.tex`,
      sha256: sha256Bytes(Buffer.from(tex)),
      construction,
    },
    constraints: {
      paper: "A4",
      pages: { maximum: 1 },
      color: "monochrome",
      columns: 1,
      body_pt: { preferred: 10, floor: 9 },
    },
    sources,
    coverage: `${support}/coverage.csv`,
    release: {
      tex_sha256: sha256Bytes(Buffer.from(tex)),
      pdf_sha256: sha256Bytes(Buffer.from("synthetic-pdf")),
      review: { status: "unreviewed" },
    },
  };
  const coverage =
    "item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note\r\nq1,issued,Q1,A,required,condensed,Q1,\r\nq1a,issued,Q1(a),A,required,condensed,Q1,\r\n";
  await writeFile(
    join(root, support, "manifest.yaml"),
    JSON.stringify(manifest),
  );
  await writeFile(join(root, support, "coverage.csv"), coverage);
  return {
    moduleRoot: root,
    root,
    manifest,
    coverage,
    manifestPath: `${support}/manifest.yaml`,
  };
}
it("audits digested construction without executing it and blocks stale recipe/input bytes", async () => {
  const f = await fixture();
  try {
    const evidence = await loadCheatsheetEvidence(f);
    assert.equal(evidence.releaseSource, tex);
    await writeFile(
      join(f.root, support, "content/source.txt"),
      "changed source",
    );
    await assert.rejects(loadCheatsheetEvidence(f), /declared SHA-256/u);
    await writeFile(
      join(f.root, support, "content/source.txt"),
      "Question and part a.",
    );
    await writeFile(
      join(f.root, support, "assemble.py"),
      "raise SystemExit('must never execute')",
    );
    await assert.rejects(loadCheatsheetEvidence(f), /Construction input/u);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("checks a staged candidate, refuses an edited authority and never publishes", async () => {
  const f = await fixture();
  try {
    const evidence = await loadCheatsheetEvidence(f);
    assert.equal(evidence.manifest.authoring.kind, "self-contained");
    if (evidence.manifest.authoring.kind !== "self-contained")
      throw new Error("fixture authority");
    const construction = constructionFor(evidence.manifest.authoring);
    assert.ok(construction);
    const candidate = ".scratch/cheatsheets/final-aid/run/candidate.tex";
    await mkdir(join(f.root, ".scratch/cheatsheets/final-aid/run"), {
      recursive: true,
    });
    await writeFile(join(f.root, candidate), `${tex}% candidate\n`);
    const proposed = {
      ...construction,
      baseTexSha256: evidence.manifest.authoring.sha256,
      outputTexSha256: sha256Bytes(await readFile(join(f.root, candidate))),
    };
    const args = {
      moduleRoot: f.root,
      authoring: evidence.manifest.authoring,
      candidatePath: candidate,
      construction: proposed,
    };
    assert.equal(
      (await checkCheatsheetRegenerationCandidate(args)).published,
      false,
    );
    assert.equal(
      await readFile(join(f.root, personal, "Final.tex"), "utf8"),
      tex,
    );
    await writeFile(
      join(f.root, personal, "Final.tex"),
      `${tex}% owner edit\n`,
    );
    await assert.rejects(
      checkCheatsheetRegenerationCandidate(args),
      /Authoritative release changed/u,
    );
    await assert.rejects(
      checkCheatsheetRegenerationCandidate({
        ...args,
        candidatePath:
          ".scratch/cheatsheets/../../10 Learning Materials/30 Personal Notes/Final.tex",
      }),
      /staged/u,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("requires enumerated item and subpart coverage but accepts provenance-only locators", async () => {
  const f = await fixture();
  try {
    await loadCheatsheetEvidence(f);
    await writeFile(
      join(f.root, support, "coverage.csv"),
      f.coverage
        .split("\r\n")
        .filter((line) => !line.startsWith("q1a,"))
        .join("\r\n"),
    );
    await assert.rejects(loadCheatsheetEvidence(f), /Q1\(a\).*absent/u);
    await writeFile(
      join(f.root, support, "coverage.csv"),
      f.coverage.replace("Q1(a)", "phantom-part"),
    );
    await assert.rejects(loadCheatsheetEvidence(f), /absent/u);
    const duplicate = structuredClone(f.manifest);
    duplicate.sources[0]?.locators.push("Q1");
    assert.throws(
      () => parseCheatsheetManifest(JSON.stringify(duplicate)),
      /unique/u,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("rejects malformed UTF-8 in manifest, coverage and authoring without replacement hashes", async () => {
  const f = await fixture();
  try {
    for (const path of [
      `${support}/manifest.yaml`,
      `${support}/coverage.csv`,
      `${personal}/Final.tex`,
    ]) {
      const original = await readFile(join(f.root, path));
      await writeFile(
        join(f.root, path),
        Buffer.concat([original, Buffer.from([255])]),
      );
      await assert.rejects(loadCheatsheetEvidence(f), /valid UTF-8/u);
      await writeFile(join(f.root, path), original);
    }
    const path = `${support}/content/invalid.tex`;
    await writeFile(join(f.root, path), Buffer.from([255]));
    await assert.rejects(
      buildCheatsheetReleaseSource({
        moduleRoot: f.root,
        authoring: {
          kind: "fragments",
          fragments: [{ path, sha256: sha256Bytes(Buffer.from("�")) }],
        },
      }),
      /valid UTF-8/u,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("packages exact BOM/CRLF evidence and recipe/input bytes with construction provenance", async () => {
  const f = await fixture();
  try {
    await run(
      "latexmk",
      [
        "-norc",
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "Final.tex",
      ],
      { cwd: join(f.root, personal) },
    );
    f.manifest.release.pdf_sha256 = sha256Bytes(
      await readFile(join(f.root, personal, "Final.pdf")),
    );
    const manifestBytes = Buffer.from(
      "\uFEFF" +
        JSON.stringify(f.manifest, null, 2).replaceAll("\n", "\r\n") +
        "\r\n",
    );
    const coverageBytes = Buffer.from(`\uFEFF${f.coverage}`);
    await writeFile(join(f.root, support, "manifest.yaml"), manifestBytes);
    await writeFile(join(f.root, support, "coverage.csv"), coverageBytes);
    const evidence = await loadCheatsheetEvidence(f);
    assert.equal(evidence.manifestSha256, sha256Bytes(manifestBytes));
    assert.equal(evidence.coverageSha256, sha256Bytes(coverageBytes));
    const destination = join(f.root, "review");
    await createCheatsheetReviewPackage({ ...f, destination });
    assert.deepEqual(
      await readFile(join(destination, "evidence/manifest.yaml")),
      manifestBytes,
    );
    assert.deepEqual(
      await readFile(join(destination, "evidence/coverage.csv")),
      coverageBytes,
    );
    assert.deepEqual(
      await readFile(join(destination, "construction/0000/assemble.py")),
      await readFile(join(f.root, support, "assemble.py")),
    );
    const provenance = JSON.parse(
      await readFile(
        join(destination, "evidence/construction-provenance.json"),
        "utf8",
      ),
    );
    assert.equal(provenance.packagedInputs[0].role, "recipe");
    assert.equal(provenance.outputTexSha256, f.manifest.release.tex_sha256);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
it("validates optional A4 body/furniture geometry", async () => {
  const f = await fixture();
  try {
    const valid = {
      ...f.manifest,
      constraints: {
        ...f.manifest.constraints,
        layout: {
          margins_mm: { left: 2, right: 2, top: 5, bottom: 4 },
          header_bottom_mm: 4,
          footer_top_mm: 294,
        },
      },
    };
    assert.ok(
      "layout" in parseCheatsheetManifest(JSON.stringify(valid)).constraints,
    );
    for (const layout of [
      { ...valid.constraints.layout, header_bottom_mm: 6 },
      { ...valid.constraints.layout, footer_top_mm: 292 },
      {
        ...valid.constraints.layout,
        margins_mm: { ...valid.constraints.layout.margins_mm, left: 209 },
      },
      {
        ...valid.constraints.layout,
        margins_mm: { ...valid.constraints.layout.margins_mm, top: -1 },
      },
    ])
      assert.throws(
        () =>
          parseCheatsheetManifest(
            JSON.stringify({
              ...valid,
              constraints: { ...valid.constraints, layout },
            }),
          ),
        /overlap|nonnegative/u,
      );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
