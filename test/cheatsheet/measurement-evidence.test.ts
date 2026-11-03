import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";

import { sha256Bytes } from "../../src/checksum.js";
import {
  cheatsheetBuildEvidenceId,
  fitCheatsheetRelease,
} from "../../src/cheatsheet/measurements.js";
import type {
  CheatsheetArtifactEvidence,
  CheatsheetBuildEvidence,
  CheatsheetMeasurementEvidence,
  CheatsheetObservation,
} from "../../src/cheatsheet/types.js";

const support = "10 Learning Materials/30 Personal Notes/support/fixture";
const personal = "10 Learning Materials/30 Personal Notes";
const known = <T>(
  value: T,
  evidence: CheatsheetArtifactEvidence[],
  kind: "manual" | "measured" = "measured",
): CheatsheetObservation<T> => ({
  kind,
  value,
  method: "explicit synthetic fixture observation",
  evidence,
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "cheatsheet-fit-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hash = (text: string) => sha256Bytes(Buffer.from(text, "utf8"));
  const file = async (
    path: string,
    text: string,
  ): Promise<CheatsheetArtifactEvidence> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    return { path, sha256: hash(text) };
  };
  const tex =
    "\\documentclass{article}\\begin{document}\\label{Q1}Synthetic fixture\\end{document}";
  const pdf =
    "%PDF-1.4\nSynthetic bytes: fixture verifies identity, not PDF rendering.\n";
  await file(`${personal}/Fixture.tex`, tex);
  await file(`${personal}/Fixture.pdf`, pdf);
  await file("NTULearn/source.md", "Synthetic source");
  await file(
    `${support}/coverage.csv`,
    "item_id,source_id,locator,topic_id,priority,disposition,artifact_locator,note\nq1,source,Q1,topic,required,condensed,Q1,\noptional,source,Q2,topic,high,pending,,\n",
  );
  const manifestText = `schema_version: 1
artifact:
  id: fixture
  title: Synthetic fitting fixture
  scope: Synthetic sources
  release_tex: ${personal}/Fixture.tex
  release_pdf: ${personal}/Fixture.pdf
  support: ${support}
authoring:
  kind: self-contained
  path: ${personal}/Fixture.tex
  sha256: ${hash(tex)}
constraints:
  paper: A4
  pages: {maximum: 1}
  color: monochrome
  columns: 2
  body_pt: {preferred: 10, floor: 10}
sources:
  - id: source
    path: NTULearn/source.md
    sha256: ${hash("Synthetic source")}
    authority: issued-current
    locators: [Q1, Q2]
coverage: ${support}/coverage.csv
release:
  tex_sha256: ${hash(tex)}
  pdf_sha256: ${hash(pdf)}
  review: {status: unreviewed}
`;
  const manifestPath = `${support}/manifest.yaml`;
  await file(manifestPath, manifestText);
  const source = await file(`${support}/build/source.tex`, tex);
  const builtPdf = await file(`${support}/build/built.pdf`, pdf);
  const releasedPdf = await file(`${support}/build/released.pdf`, pdf);
  const aux = await file(
    `${support}/build/build.aux`,
    "\\relax\n\\newlabel{Q1}{{1}{1}}\n",
  );
  const log = await file(
    `${support}/build/build.log`,
    "Synthetic log; no warnings.\n",
  );
  const pdfInfo = await file(`${support}/build/pdfinfo.txt`, "Pages: 1\n");
  const fontXml = await file(
    `${support}/build/full.xml`,
    '<pdf2xml><page><fontspec id="0" size="30"/><text font="0">Synthetic body text</text></page></pdf2xml>',
  );
  const render = await file(
    `${support}/build/built-page-1.png`,
    "Synthetic render identity",
  );
  const releasedRender = await file(
    `${support}/build/released-page-1.png`,
    "Synthetic render identity",
  );
  const partialBuild = {
    source,
    pdf: builtPdf,
    releasedPdf,
    aux,
    log,
    pdfInfo,
    fontXml,
    fullXml: fontXml,
    renders: [{ ...render, page: 1 }],
    releasedRenders: [{ ...releasedRender, page: 1 }],
  };
  const build: CheatsheetBuildEvidence = {
    ...partialBuild,
    id: cheatsheetBuildEvidenceId(partialBuild),
  };
  const measurement: CheatsheetMeasurementEvidence = {
    schemaVersion: 2,
    release: {
      artifactId: "fixture",
      manifestSha256: hash(manifestText),
      texSha256: hash(tex),
      pdfSha256: hash(pdf),
    },
    build,
    metrics: {
      pages: known(1, [pdfInfo]),
      bodyPt: known(10, [fontXml]),
      overfullBoxes: known(0, [log]),
      missingGlyphs: known(0, [log]),
    },
    columns: [1, 2].map((column) => ({
      page: 1,
      column,
      geometry: known(
        {
          topMm: 15,
          bottomMm: 282,
          contentTopMm: 15,
          contentBottomMm: 277,
          largestInternalGapBaselines: 0,
        },
        [releasedRender],
        column === 2 ? "manual" : "measured",
      ),
      continuation: known({ status: "none" }, [releasedRender], "manual"),
    })),
  };
  const measurementPath = join(root, "measurements.json");
  const save = async () =>
    writeFile(measurementPath, JSON.stringify(measurement));
  const fit = async () => {
    await save();
    return fitCheatsheetRelease({
      moduleRoot: root,
      manifestPath,
      measurementsPath: measurementPath,
    });
  };
  return { root, measurement, measurementPath, manifestPath, file, fit, save };
}

test("fitting retains honest manual and measured observations at the actual CLI", async (t) => {
  const f = await fixture(t);
  await f.save();
  const result = spawnSync(
    process.execPath,
    [
      "dist/src/cheatsheet/cli.js",
      "fit",
      "--module-root",
      f.root,
      "--manifest",
      f.manifestPath,
      "--measurements",
      f.measurementPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output: unknown = JSON.parse(result.stdout);
  assert.ok(
    typeof output === "object" &&
      output !== null &&
      "kind" in output &&
      output.kind === "accept",
  );
  assert.match(result.stdout, /"kind": "manual"/u);
  assert.match(result.stdout, /explicit synthetic fixture observation/u);
  assert.match(result.stdout, /do not establish machine measurement/u);
});

test("numeric-only and unknown-zero CLI measurements cannot be accepted", async (t) => {
  const f = await fixture(t);
  for (const invalid of [
    {
      pages: 1,
      bodyPt: 10,
      overfullBoxes: 0,
      missingGlyphs: 0,
      unidentifiedContinuations: 0,
      internalVoidBaselines: 0,
      finalColumnUnusedMm: 0,
    },
    {
      ...f.measurement,
      metrics: {
        ...f.measurement.metrics,
        overfullBoxes: { kind: "unknown", reason: "not measured", value: 0 },
      },
    },
  ]) {
    await writeFile(f.measurementPath, JSON.stringify(invalid));
    const result = spawnSync(
      process.execPath,
      [
        "dist/src/cheatsheet/cli.js",
        "fit",
        "--module-root",
        f.root,
        "--manifest",
        f.manifestPath,
        "--measurements",
        f.measurementPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stdout,
      /unsupported numeric-only|unknown observations cannot carry/u,
    );
  }
  f.measurement.metrics.overfullBoxes = {
    kind: "unknown",
    reason: "not measured",
  };
  const blocked = await f.fit();
  assert.equal(blocked.kind, "blocked");
  if (blocked.kind === "blocked")
    assert.match(blocked.reasons.join(" "), /unknown: not measured/u);
  assert.equal(
    blocked.measurementEvidence.metrics.overfullBoxes.kind,
    "unknown",
  );
});

test("measurements reject stale release identity and changed build files", async (t) => {
  const f = await fixture(t);
  const digest = f.measurement.release.manifestSha256;
  f.measurement.release.manifestSha256 = "a".repeat(64);
  await assert.rejects(f.fit(), /different manifest\/release/u);
  f.measurement.release.manifestSha256 = digest;
  await writeFile(
    join(f.root, f.measurement.build.aux.path),
    "Changed auxiliary evidence",
  );
  await assert.rejects(f.fit(), /stale or has the wrong SHA-256/u);
});

test("numeric zero cannot contradict a warning in the retained build log", async (t) => {
  const f = await fixture(t);
  const updated = await f.file(
    f.measurement.build.log.path,
    "Overfull \\hbox (3pt too wide)\n",
  );
  f.measurement.build.log = updated;
  f.measurement.build.id = cheatsheetBuildEvidenceId(f.measurement.build);
  f.measurement.metrics.overfullBoxes = known(0, [updated]);
  f.measurement.metrics.missingGlyphs = known(0, [updated]);
  await assert.rejects(f.fit(), /contradict the retained compiled/u);
  f.measurement.metrics.overfullBoxes = known(1, [updated]);
  const blocked = await f.fit();
  assert.equal(blocked.kind, "blocked");
});

test("every column gap and continuation participates in fitting", async (t) => {
  const f = await fixture(t);
  const first = f.measurement.columns[0];
  assert.ok(first);
  const render = f.measurement.build.releasedRenders[0];
  assert.ok(render);
  first.geometry = known(
    {
      topMm: 15,
      bottomMm: 282,
      contentTopMm: 15,
      contentBottomMm: 240,
      largestInternalGapBaselines: 0,
    },
    [render],
    "manual",
  );
  assert.equal((await f.fit()).kind, "expand");
  first.continuation = known({ status: "unidentified" }, [render], "manual");
  assert.equal((await f.fit()).kind, "blocked");
  first.continuation = known(
    { status: "identified", label: "Q1" },
    [render, f.measurement.build.aux],
    "manual",
  );
  assert.equal((await f.fit()).kind, "expand");
  first.continuation = known(
    { status: "identified", label: "not-compiled" },
    [render, f.measurement.build.aux],
    "manual",
  );
  await assert.rejects(f.fit(), /absent from compiled AUX/u);
});

test("missing columns, unknown geometry and wrong page evidence never become clearances", async (t) => {
  const f = await fixture(t);
  const first = f.measurement.columns[0];
  assert.ok(first);
  first.geometry = { kind: "unknown", reason: "uninspected column" };
  assert.equal((await f.fit()).kind, "blocked");
  first.geometry = known(
    {
      topMm: 15,
      bottomMm: 282,
      contentTopMm: 15,
      contentBottomMm: 277,
      largestInternalGapBaselines: 0,
    },
    [f.measurement.build.aux],
    "manual",
  );
  await assert.rejects(
    f.fit(),
    /Geometry for page 1, column 1 must reference/u,
  );
  f.measurement.columns.pop();
  await assert.rejects(f.fit(), /every compiled page and column/u);
});

test("build IDs bind all retained artifact hashes and ignore relocatable paths", async (t) => {
  const f = await fixture(t);
  const original = f.measurement.build.id;
  f.measurement.build.source = {
    ...f.measurement.build.source,
    path: "elsewhere/source.tex",
  };
  assert.equal(cheatsheetBuildEvidenceId(f.measurement.build), original);
  f.measurement.build.source.sha256 = "b".repeat(64);
  assert.notEqual(cheatsheetBuildEvidenceId(f.measurement.build), original);
  await assert.rejects(f.fit(), /Build evidence identity is stale/u);
  assert.ok(
    (await readFile(f.measurementPath, "utf8")).includes("schemaVersion"),
  );
});

test("fit CLI rereads actual released bytes and refuses a stale PDF", async (t) => {
  const f = await fixture(t);
  await f.save();
  await writeFile(
    join(f.root, personal, "Fixture.pdf"),
    "%PDF changed since measurement",
  );
  const result = spawnSync(
    process.execPath,
    [
      "dist/src/cheatsheet/cli.js",
      "fit",
      "--module-root",
      f.root,
      "--manifest",
      f.manifestPath,
      "--measurements",
      f.measurementPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stdout);
  assert.match(
    result.stdout,
    /Release PDF digest does not describe the current PDF/u,
  );
});

test("doctor names missing executables under an explicit toolchain path", async (t) => {
  const f = await fixture(t);
  const result = spawnSync(
    process.execPath,
    ["dist/src/cheatsheet/cli.js", "doctor"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ACADEMIC_OS_TOOL_PATH: join(f.root, "missing-toolchain"),
      },
    },
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /"status": "incomplete"/u);
  for (const name of [
    "latexmk",
    "kpsewhich",
    "pdfinfo",
    "pdffonts",
    "pdftotext",
    "pdftoppm",
    "pdftohtml",
  ]) {
    assert.ok(result.stdout.includes(`"name": "${name}"`));
  }
});

test("schema names evidence retention and the actual YAML review digest key", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/src/cheatsheet/cli.js", "schema"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /--evidence-directory/u);
  assert.match(result.stdout, /reviewed_pdf_sha256/u);
  assert.match(result.stdout, /"schemaVersion": 2/u);
});
