import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { it } from "node:test";

import {
  buildCheatsheetReleaseSource,
  createCheatsheetReviewPackage,
} from "../../src/cheatsheet/index.js";
import { sha256, sha256Bytes } from "../../src/checksum.js";
import { recordBehaviorEvidence } from "../support/rule-evidence.js";

const run = promisify(execFile);
let latexAvailable = true;
try {
  await run("latexmk", ["-version"]);
  await run("pdftoppm", ["-v"]);
} catch {
  latexAvailable = false;
}

it("rejects symbolic links in module-relative evidence paths", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "cheatsheet-symlink-source-"));
  try {
    const moduleRoot = join(fixture, "module");
    const outside = join(fixture, "outside");
    await Promise.all([mkdir(moduleRoot), mkdir(outside)]);
    await writeFile(join(outside, "source.tex"), "outside");
    await symlink(join(outside, "source.tex"), join(moduleRoot, "source.tex"));
    await symlink(outside, join(moduleRoot, "linked-directory"));
    await assert.rejects(
      buildCheatsheetReleaseSource({
        moduleRoot,
        authoring: {
          kind: "self-contained",
          path: "source.tex",
          sha256: sha256("outside"),
        },
      }),
      /symbolic link/u,
    );
    await assert.rejects(
      buildCheatsheetReleaseSource({
        moduleRoot,
        authoring: {
          kind: "self-contained",
          path: "linked-directory/source.tex",
          sha256: sha256("outside"),
        },
      }),
      /symbolic link/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

it("validates coupled evidence and packages exact independently compiled bytes", {
  skip: !latexAvailable,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-package-test-"));
  try {
    const personal = join(root, "10 Learning Materials/30 Personal Notes");
    const support = join(personal, "support/final-aid");
    const sourceDirectory = join(root, "NTULearn");
    await Promise.all([
      mkdir(join(support, "content"), { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
    ]);
    const first = String.raw`\documentclass[a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\pagestyle{empty}
\begin{document}
\typeout{CHEATSHEET-BODY-PT=10}`;
    const second = String.raw`Reviewed body: $a^2+b^2=c^2$.
\end{document}`;
    const release = `${first}\n\n${second}\n`;
    const sourceBytes = Buffer.from("synthetic issued source");
    await Promise.all([
      writeFile(join(support, "content/00.tex"), first),
      writeFile(join(support, "content/10.tex"), second),
      writeFile(join(personal, "Final Aid.tex"), release),
      writeFile(join(sourceDirectory, "assessment.pdf"), sourceBytes),
    ]);
    await run(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "Final Aid.tex"],
      { cwd: personal },
    );
    const pdf = await readFile(join(personal, "Final Aid.pdf"));
    const manifestPath =
      "10 Learning Materials/30 Personal Notes/support/final-aid/manifest.yaml";
    const manifest = `schema_version: 1
artifact:
  id: final-aid
  title: Final aid
  scope: Synthetic
  release_tex: 10 Learning Materials/30 Personal Notes/Final Aid.tex
  release_pdf: 10 Learning Materials/30 Personal Notes/Final Aid.pdf
  support: 10 Learning Materials/30 Personal Notes/support/final-aid
authoring:
  kind: fragments
  fragments:
    - path: 10 Learning Materials/30 Personal Notes/support/final-aid/content/00.tex
      sha256: ${sha256(first)}
    - path: 10 Learning Materials/30 Personal Notes/support/final-aid/content/10.tex
      sha256: ${sha256(second)}
constraints:
  paper: A4
  pages: {maximum: 1}
  color: monochrome
  columns: 1
  body_pt: {preferred: 10, floor: 9}
sources:
  - id: issued-1
    path: NTULearn/assessment.pdf
    sha256: ${sha256Bytes(sourceBytes)}
    authority: issued-current
    locators: [question 1]
coverage: 10 Learning Materials/30 Personal Notes/support/final-aid/coverage.csv
release:
  tex_sha256: ${sha256(release)}
  pdf_sha256: ${sha256Bytes(pdf)}
  review: {status: passed, reviewed_pdf_sha256: ${sha256Bytes(pdf)}}
`;
    const coverage = `item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note
q1,issued-1,question 1,TOP-A,required,condensed,Q1,
`;
    await Promise.all([
      writeFile(join(support, "manifest.yaml"), manifest),
      writeFile(join(support, "coverage.csv"), coverage),
    ]);
    const runtime = resolve("skills/cheatsheet/scripts/cheatsheet-tool.mjs");
    const audit = await run(runtime, [
      "audit",
      "--module-root",
      root,
      "--manifest",
      manifestPath,
    ]);
    assert.equal(JSON.parse(audit.stdout).coverageItems, 1);
    const built = await buildCheatsheetReleaseSource({
      moduleRoot: root,
      authoring: {
        kind: "fragments",
        fragments: [
          {
            path: `${manifestPath.slice(0, -13)}content/00.tex`,
            sha256: sha256(first),
          },
          {
            path: `${manifestPath.slice(0, -13)}content/10.tex`,
            sha256: sha256(second),
          },
        ],
      },
    });
    assert.equal(built.source, release);
    const destination = join(root, "review");
    const packaged = await createCheatsheetReviewPackage({
      moduleRoot: root,
      manifestPath,
      destination,
    });
    assert.equal(packaged.verification.isolatedBuild, true);
    assert.ok(packaged.files.includes("Final Aid.tex"));
    assert.ok(packaged.files.includes("authoring/content/00.tex"));
    assert.ok(packaged.files.includes("evidence/package-verification.json"));
    const sums = await readFile(join(destination, "SHA256SUMS"), "utf8");
    assert.match(sums, /Final Aid\.pdf/u);
    assert.match(sums, /evidence\/manifest\.yaml/u);
    assert.equal(
      await readFile(join(destination, "evidence/manifest.yaml"), "utf8"),
      manifest,
    );
    const readme = await readFile(join(destination, "README.md"), "utf8");
    const documentedCommand = /```sh\n([^\n]+)\n```/u.exec(readme)?.[1];
    assert.notEqual(documentedCommand, undefined);
    await run("sh", ["-c", documentedCommand as string], {
      cwd: destination,
    });
    recordBehaviorEvidence("MF-CHEATSHEET-005", () => {
      assert.equal(packaged.verification.rendersMatch, true);
    });
    recordBehaviorEvidence("MF-CHEATSHEET-001", () => {
      assert.deepEqual(packaged.files.slice(0, 2), [
        "Final Aid.tex",
        "Final Aid.pdf",
      ]);
    });

    await writeFile(join(support, "other.yaml"), manifest);
    await assert.rejects(
      createCheatsheetReviewPackage({
        moduleRoot: root,
        manifestPath:
          "10 Learning Materials/30 Personal Notes/support/final-aid/other.yaml",
        destination: join(root, "invalid-review"),
      }),
      /Manifest path must be/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
